/**
 * StampReader on the Anthropic Messages API (ADR-0010): ONE base64 PNG of page 1 and a short instruction, structured output
 * through `messages.parse` with a zod schema, no file name, job or user data. A refusal, a timeout, invalid output or any API
 * error is a typed StampReaderError. A date is accepted only when it is a real calendar date.
 * A circuit breaker (BE-10) opens after ANTHROPIC_FAILURE_THRESHOLD failures of the service itself (connection, timeout, 5xx,
 * 429) in a row: reads then fail at once with a StampReaderError("error") and the caller falls through to the text rule, until
 * a trial call after the cool-down succeeds. Refusals and unparseable answers mean the service is up and do not count.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { isIsoDate } from "@kr/workflow";
import { z } from "zod";
import { CircuitOpenError, createCircuitBreaker, type BreakerTuning } from "./circuit-breaker.js";
import { StampReaderError, type StampReader, type StampReading } from "./stamp-reader.js";

const MAX_STAMP_TEXT = 200;

const Reading = z.object({
  found: z.boolean().describe("True only when the stamp box with a DATE was found"),
  date: z.string().nullable().describe("The stamp's DATE as yyyy-mm-dd, or null"),
  stampText: z.string().nullable().describe('The stamp text as printed, e.g. "DATE 16-Mar-2026 FILE 123-26", or null'),
});

/** The prototype's instruction (ported), plus what to answer when there is no stamp. */
export const STAMP_PROMPT =
  "This image is page 1 of a Western Australian Planning Commission (WAPC) Conformance Notification for a subdivision application. " +
  'Find the stamp box that reads "DEPARTMENT OF PLANNING, LANDS AND HERITAGE" with a DATE and a FILE number (e.g. "DATE 16-Mar-2026  FILE 123-26"). ' +
  "The conformed date is the DATE in that box – not the letter date or any other date on the page. Read the day digits carefully. " +
  "Dates are Australian (day/month/year). If there is no stamped date, answer found false with a null date and null stampText.";

/** Consecutive failures of the service that open the circuit, and how long it stays open before a trial call. */
export const ANTHROPIC_FAILURE_THRESHOLD = 3;
export const ANTHROPIC_COOL_DOWN_MS = 60_000;

export interface AnthropicStampReaderOptions {
  readonly apiKey: string;
  readonly model: string;
  /** Limit for the whole call, retries included (ANTHROPIC_TIMEOUT_MS). */
  readonly timeoutMs: number;
  /** Test seam; production uses the SDK's default host. */
  readonly baseURL?: string;
  /** Test seam: the SDK's own retries per call (default: the SDK's). */
  readonly maxRetries?: number;
  /** Overrides of the circuit breaker (defaults above); tests inject a clock, main a state-change logger. */
  readonly breaker?: BreakerTuning | undefined;
}

/** Connection errors, timeouts, rate limits and server errors: the service is not usable right now. */
const isServiceDown = (error: unknown): boolean =>
  error instanceof Anthropic.APIConnectionError ||
  (error instanceof Anthropic.APIError && (error.status === 429 || (error.status ?? 0) >= 500));

export function createAnthropicStampReader(options: AnthropicStampReaderOptions): StampReader {
  const client = new Anthropic({
    apiKey: options.apiKey,
    timeout: options.timeoutMs,
    ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
  });

  const breaker = createCircuitBreaker({
    name: "anthropic",
    failureThreshold: ANTHROPIC_FAILURE_THRESHOLD,
    coolDownMs: ANTHROPIC_COOL_DOWN_MS,
    ...options.breaker,
    isFailure: (error) => error instanceof StampReaderError && error.unavailable,
    // the caller's own abort is not a typed StampReaderError and says nothing about the service
    isCancel: (error) => !(error instanceof StampReaderError),
  });

  return {
    async read(png, signal): Promise<StampReading> {
      const deadline = AbortSignal.timeout(options.timeoutMs);
      const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
      let message;
      try {
        message = await breaker.run(async () => {
          try {
            return await client.messages.parse(
              {
                model: options.model,
                max_tokens: 1024,
                output_config: { effort: "low", format: zodOutputFormat(Reading) },
                messages: [
                  {
                    role: "user",
                    content: [
                      {
                        type: "image",
                        source: { type: "base64", media_type: "image/png", data: Buffer.from(png).toString("base64") },
                      },
                      { type: "text", text: STAMP_PROMPT },
                    ],
                  },
                ],
              },
              { signal: combined },
            );
          } catch (error) {
            if (signal?.aborted) throw error;
            if (deadline.aborted || error instanceof Anthropic.APIConnectionTimeoutError)
              throw new StampReaderError("timeout", { cause: error, unavailable: true });
            const apiError = error instanceof Anthropic.APIError;
            throw new StampReaderError(apiError ? "error" : "unparseable", {
              cause: error,
              unavailable: isServiceDown(error),
            });
          }
        });
      } catch (error) {
        if (error instanceof CircuitOpenError) throw new StampReaderError("error", { cause: error, unavailable: true });
        throw error;
      }
      if (message.stop_reason === "refusal") throw new StampReaderError("refused");
      const parsed = message.parsed_output;
      if (!parsed) throw new StampReaderError("unparseable");
      if (!parsed.found) return { found: false, date: null, stampText: null };
      const date = parsed.date;
      if (date === null || !isIsoDate(date)) throw new StampReaderError("unparseable");
      return { found: true, date, stampText: parsed.stampText?.slice(0, MAX_STAMP_TEXT) ?? null };
    },
  };
}
