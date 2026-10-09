import { PROBLEM_TYPES, jobCapabilitiesFor } from "@kr/contracts";
import { screen, waitFor, within } from "@testing-library/react";
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
const READER = ["job.read"] as const;
const list = (...items: ReturnType<typeof syntheticNote>[]) => mockApi("listNotes", { items, nextCursor: null });
const textbox = () => screen.getByRole("textbox", { name: "New job note" });

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

  it("hides the form without notes.create", async () => {
    server.use(list());
    renderWithProviders(<JobNotes jobId={JOB} capabilities={READER} />);
    await screen.findByText("No notes on this job yet.");
    expect(screen.queryByRole("textbox", { name: "New job note" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add note" })).not.toBeInTheDocument();
  });

  it("asks for text when the note is empty, and focuses the box", async () => {
    server.use(list());
    renderWithProviders(<JobNotes jobId={JOB} capabilities={STAFF} />);
    await userEvent.type(textbox(), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Add note" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Type a note first.");
    expect(textbox()).toHaveFocus();
  });

  it("adds a note with the chosen audience label, clears the box and reloads the list", async () => {
    let body: unknown;
    let key: string | null = null;
    let added = false;
    server.use(
      handlerFor("listNotes", () =>
        HttpResponse.json({ items: added ? [syntheticNote({ body: "Fresh", isOwn: true })] : [], nextCursor: null }),
      ),
      handlerFor("createNote", async ({ request }) => {
        body = await request.json();
        key = request.headers.get("idempotency-key");
        added = true;
        return HttpResponse.json(syntheticNote({ body: "Fresh", audience: "client", isOwn: true }), { status: 201 });
      }),
    );
    renderWithProviders(<JobNotes jobId={JOB} capabilities={STAFF} />);
    await screen.findByText("No notes on this job yet.");
    await userEvent.type(textbox(), "Fresh");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Note is for" }), "client");
    await userEvent.click(screen.getByRole("button", { name: "Add note" }));
    expect(await screen.findByText("Fresh")).toBeInTheDocument();
    expect(body).toEqual({ body: "Fresh", audience: "client" });
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(textbox()).toHaveValue("");
    expect(textbox()).toHaveFocus();
  });
  it("limits the box to what the contract allows and sends the note as the contract trims it", async () => {
    let body: unknown;
    server.use(
      list(),
      handlerFor("createNote", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(syntheticNote({ body: "Padded", isOwn: true }), { status: 201 });
      }),
    );
    renderWithProviders(<JobNotes jobId={JOB} capabilities={STAFF} />);
    expect(textbox()).toHaveAttribute("maxlength", "5000");
    await userEvent.type(textbox(), "  Padded  ");
    await userEvent.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() => {
      expect(body).toEqual({ body: "Padded", audience: "all" });
    });
  });

  it("keeps the text and shows the request id when saving fails", async () => {
    server.use(list(), mockProblem("createNote", 500, PROBLEM_TYPES.internal, { requestId: "req-note-1" }));
    renderWithProviders(<JobNotes jobId={JOB} capabilities={STAFF} />);
    await userEvent.type(textbox(), "Keep me");
    await userEvent.click(screen.getByRole("button", { name: "Add note" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That note couldn't be saved. Try again. (Request ID: req-note-1)",
    );
    expect(textbox()).toHaveValue("Keep me");
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

  describe("delete", () => {
    const mine = syntheticNote({ body: "Mine", isOwn: true, canDelete: true });
    const other = syntheticNote({ body: "Other", canDelete: false });

    it("offers × only where the API says the note can be deleted", async () => {
      server.use(list(mine, other));
      renderWithProviders(<JobNotes jobId={JOB} capabilities={STAFF} />);
      await screen.findByText("Other");
      expect(screen.getAllByRole("button", { name: "Delete note" })).toHaveLength(1);
    });

    it("asks 'Delete?', puts focus on No, and No keeps the note and returns focus to ×", async () => {
      server.use(list(mine));
      renderWithProviders(<JobNotes jobId={JOB} capabilities={STAFF} />);
      await userEvent.click(await screen.findByRole("button", { name: "Delete note" }));
      expect(screen.getByRole("button", { name: "No" })).toHaveFocus();
      await userEvent.click(screen.getByRole("button", { name: "No" }));
      expect(screen.getByRole("button", { name: "Delete note" })).toHaveFocus();
      expect(screen.getByText("Mine")).toBeInTheDocument();
    });

    it("Yes deletes the note", async () => {
      let notes = [mine, other];
      let deleted: string | undefined;
      server.use(
        handlerFor("listNotes", () => HttpResponse.json({ items: notes, nextCursor: null })),
        handlerFor("deleteNote", ({ params }) => {
          deleted = String(params.noteId);
          notes = notes.filter((note) => note.id !== deleted);
          return new HttpResponse(null, { status: 204 });
        }),
      );
      renderWithProviders(<JobNotes jobId={JOB} capabilities={STAFF} />);
      await userEvent.click(await screen.findByRole("button", { name: "Delete note" }));
      await userEvent.click(screen.getByRole("button", { name: "Yes" }));
      await waitFor(() => {
        expect(screen.queryByText("Mine")).not.toBeInTheDocument();
      });
      expect(deleted).toBe(mine.id);
      expect(screen.getByText("Other")).toBeInTheDocument();
    });

    it("puts the note back and says so when the API refuses", async () => {
      server.use(list(mine), mockProblem("deleteNote", 403, PROBLEM_TYPES.forbidden));
      renderWithProviders(<JobNotes jobId={JOB} capabilities={STAFF} />);
      await userEvent.click(await screen.findByRole("button", { name: "Delete note" }));
      await userEvent.click(screen.getByRole("button", { name: "Yes" }));
      const row = (await screen.findByText("Mine")).closest("li");
      expect(await within(row as HTMLElement).findByRole("alert")).toHaveTextContent(
        "That note couldn't be deleted. Try again.",
      );
    });
  });
});
