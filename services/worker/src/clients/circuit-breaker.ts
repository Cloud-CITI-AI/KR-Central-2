/**
 * In-process circuit breaker for the worker's outbound dependencies (BE-10: clamd, Anthropic). After `failureThreshold` failures in
 * a row the circuit opens and calls fail fast with CircuitOpenError instead of waiting for a socket or API timeout again. After
 * `coolDownMs` it is half-open: exactly one trial call goes through; its success closes the circuit, its failure opens it again for
 * another cool-down. Only failures the caller classifies as the dependency being down count (`isFailure`); any other error means the
 * dependency answered, and a cancelled call (`isCancel`) is neutral: it neither counts nor closes the circuit.
 */
import { systemClock, type Clock } from "../clock.js";

export type CircuitState = "closed" | "open" | "half_open";

/** The circuit is open: the call was not tried. */
export class CircuitOpenError extends Error {
  readonly dependency: string;

  constructor(dependency: string) {
    super(`The ${dependency} circuit is open; the call was not tried.`);
    this.name = "CircuitOpenError";
    this.dependency = dependency;
  }
}

export interface CircuitBreakerOptions {
  /** For messages and logs: "clamd", "anthropic". */
  readonly name: string;
  /** Consecutive failures that open the circuit. */
  readonly failureThreshold: number;
  /** How long the circuit stays open before one trial call is allowed. */
  readonly coolDownMs: number;
  /** True when this error means the dependency is down or unreachable (connection error, timeout, 5xx). */
  readonly isFailure: (error: unknown) => boolean;
  /** True when the call was cancelled by the caller: neutral for the circuit. */
  readonly isCancel?: (error: unknown) => boolean;
  readonly clock?: Clock;
  /** Called on every state change, for logging. */
  readonly onStateChange?: (change: { readonly from: CircuitState; readonly to: CircuitState }) => void;
}

/** What a client lets its owner tune; the rest of the options are the client's own. */
export type BreakerTuning = Partial<
  Pick<CircuitBreakerOptions, "failureThreshold" | "coolDownMs" | "clock" | "onStateChange">
>;

export interface CircuitBreaker {
  /** Runs `call`, or rejects with CircuitOpenError without calling it while the circuit is open (or a trial call is running). */
  run<T>(call: () => Promise<T>): Promise<T>;
  readonly state: CircuitState;
}

export function createCircuitBreaker(options: CircuitBreakerOptions): CircuitBreaker {
  const clock = options.clock ?? systemClock;
  let state: CircuitState = "closed";
  let failures = 0;
  let openedAt = 0;
  let trialRunning = false;

  const moveTo = (to: CircuitState): void => {
    if (to === state) return;
    const from = state;
    state = to;
    options.onStateChange?.({ from, to });
  };
  const open = (): void => {
    openedAt = clock.now().getTime();
    moveTo("open");
  };
  const succeeded = (): void => {
    failures = 0;
    moveTo("closed");
  };
  const failed = (): void => {
    failures += 1;
    if (state === "half_open" || failures >= options.failureThreshold) open();
  };

  return {
    get state() {
      return state;
    },
    async run(call) {
      if (state === "open" && clock.now().getTime() - openedAt >= options.coolDownMs) moveTo("half_open");
      if (state === "open" || (state === "half_open" && trialRunning)) throw new CircuitOpenError(options.name);
      const trial = state === "half_open";
      trialRunning = trial;
      try {
        const value = await call();
        succeeded();
        return value;
      } catch (error) {
        // a cancelled trial gives no verdict: the circuit stays half-open and the next call is the trial
        if (options.isCancel?.(error)) throw error;
        if (options.isFailure(error)) failed();
        else succeeded();
        throw error;
      } finally {
        if (trial) trialRunning = false;
      }
    },
  };
}
