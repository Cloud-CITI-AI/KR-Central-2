import type { JobDetail } from "@kr/contracts";
import { screen } from "@testing-library/react";
import { HttpResponse } from "msw";
import { handlerFor } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { conditionAfter, syntheticConditionJob, withCondition } from "./test-fixtures";

export interface UpdateCall {
  readonly conditionId: string | readonly string[] | undefined;
  readonly body: Record<string, unknown>;
  readonly ifMatch: string | null;
}

/** Answer every updateCondition the way the API does (the "server" job follows) and record what was sent. */
export function serveUpdates(served: { job: JobDetail }, delayMs = 0): UpdateCall[] {
  const calls: UpdateCall[] = [];
  server.use(
    handlerFor("updateCondition", async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      calls.push({ conditionId: params.conditionId, body, ifMatch: request.headers.get("if-match") });
      const current = served.job.conditions.find((c) => c.id === params.conditionId);
      if (!current) return new HttpResponse(null, { status: 404 });
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      const next = conditionAfter(current, body);
      served.job = withCondition(served.job, next.id, next);
      return HttpResponse.json(next);
    }),
  );
  return calls;
}

/** The checklist card of condition `number`. */
export const checklistCard = (number: number) => screen.getByRole("group", { name: `Condition ${number}` });

/** Three conditions for three agencies: the second is cleared, the third has a guessed agency; they came from a Decision Letter. */
export function threeConditions(options: Parameters<typeof syntheticConditionJob>[0] = {}) {
  return syntheticConditionJob({
    agencies: ["Western Power", "Water Corporation", "WAPC"],
    conditions: [{}, { isCleared: true }, { agencyGuessed: true }],
    fields: {
      conditionsSource: {
        fileId: "0c4e2a52-6a4b-4b8e-9d65-2f0a4f6f1b11",
        fileName: "Decision Letter.pdf",
        extractedAt: "2026-09-28T03:50:56.543Z",
      },
    },
    ...options,
  });
}
