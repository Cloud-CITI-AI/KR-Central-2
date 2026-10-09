import { PROBLEM_TYPES, jobCapabilitiesFor } from "@kr/contracts";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { handlerFor, mockApi, mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/render";
import { JobNotes } from "./JobNotes";
import { syntheticNote } from "./test-fixtures";

const JOB = "3f1c7a4e-8d52-4b8e-9d1f-0a6c2e5b7d11";
const STAFF = jobCapabilitiesFor("staff", null);
const list = (...items: ReturnType<typeof syntheticNote>[]) => mockApi("listNotes", { items, nextCursor: null });

describe("JobNotes", () => {
  it("shows the heading, the description and the empty text", async () => {
    server.use(list());
    const { container } = renderWithProviders(<JobNotes jobId={JOB} capabilities={STAFF} />);
    expect(screen.getByRole("heading", { name: "Job notes" })).toBeInTheDocument();
    expect(screen.getByText("Any notes relevant to the subdivision. Any party can post a note.")).toBeInTheDocument();
    expect(await screen.findByText("No notes on this job yet.")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
  it("lists notes in the API's newest-first order with Perth time, audience label and author, filtering none", async () => {
    server.use(
      list(
        syntheticNote({ body: "Mine", isOwn: true, audience: "client", createdAt: "2026-09-28T07:50:00.000Z" }),
        syntheticNote({
          body: "Theirs",
          audience: "surveyor",
          author: { id: "9b0f5a8e-2b1c-4a47-8f0a-6d3e1c9a5b22", displayName: "Sam Surveyor" },
          createdAt: "2026-09-27T01:05:00.000Z",
        }),
        syntheticNote({ body: "Nobody", author: null }),
      ),
    );
    const { container } = renderWithProviders(<JobNotes jobId={JOB} capabilities={STAFF} />);
    const rows = await screen.findAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "28 Sep 2026, 3:50 pmFor clientby youMine",
      "27 Sep 2026, 9:05 amFor surveyorby Sam SurveyorTheirs",
      "28 Sep 2026, 3:50 pmFor everyoneNobody",
    ]);
    await expectNoAxeViolations(container);
  });
  it("explains when the notes cannot be loaded", async () => {
    server.use(mockProblem("listNotes", 500, PROBLEM_TYPES.internal, { requestId: "req-note-2" }));
    renderWithProviders(<JobNotes jobId={JOB} capabilities={STAFF} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The notes failed to load. Reload the page and try again. (Request ID: req-note-2)",
    );
  });
  it("loads the next page on request, 50 at a time", async () => {
    const limits: (string | null)[] = [];
    server.use(
      handlerFor("listNotes", ({ request }) => {
        const url = new URL(request.url);
        limits.push(url.searchParams.get("limit"));
        return HttpResponse.json(
          url.searchParams.get("cursor")
            ? { items: [syntheticNote({ body: "Older" })], nextCursor: null }
            : { items: [syntheticNote({ body: "Newer" })], nextCursor: "c1" },
        );
      }),
    );
    renderWithProviders(<JobNotes jobId={JOB} capabilities={STAFF} />);
    await screen.findByText("Newer");
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Older")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    expect(limits).toEqual(["50", "50"]);
  });
});
