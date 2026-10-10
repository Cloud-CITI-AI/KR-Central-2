import { screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { syntheticJob } from "@/features/tracker/test-fixtures";
import { expectNoAxeViolations } from "@/test/axe";
import { handlerFor, mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { syntheticFile, uploadResult } from "./test-fixtures";
import { stubUploads } from "./test-upload";
import { checkpointOf, renderCard, withCheckpoint } from "./test-utils";

const viewer = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/features/viewer", () => ({ useViewer: () => viewer }));

afterEach(() => {
  vi.unstubAllGlobals();
  viewer.open.mockClear();
});

const SENT = "2026-09-28T07:50:00.000Z";
const email = (jobId: string, subject: string, overrides: Partial<Parameters<typeof syntheticFile>[1]> = {}) =>
  syntheticFile(jobId, {
    name: `${subject}.eml`,
    kind: "email",
    contentType: "message/rfc822",
    checkpointKey: "i4_3",
    slot: "email",
    email: {
      parseStatus: "parsed",
      subject,
      from: "Alex Planner",
      to: null,
      cc: null,
      sentAt: SENT,
      isPasted: false,
      bodyText: null,
    },
    ...overrides,
  });
const zone = () => screen.getByLabelText(/Drop a WAPC query email here/);
const dropOn = (data: { files?: File[]; text?: string }) => {
  fireEvent.drop(zone().closest("label") as HTMLElement, {
    dataTransfer: { files: data.files ?? [], getData: () => data.text ?? "" },
  });
};

function withEmails(files: ReturnType<typeof email>[], options: Parameters<typeof syntheticJob>[0] = {}) {
  const base = syntheticJob(options);
  return withCheckpoint(base, "i4_3", { files });
}

describe("emails panel", () => {
  it("shows the folder, 'none yet', the zone with its hint and takes .msg and .eml files", async () => {
    const { container } = renderCard(syntheticJob(), "i4_3");
    expect(screen.getByText("Query emails")).toBeInTheDocument();
    expect(screen.getByText("none yet")).toBeInTheDocument();
    expect(screen.getByText("Drag an email from Outlook, or click to choose a .msg / .eml file")).toBeInTheDocument();
    expect(zone()).toHaveAttribute("accept", ".msg,.eml");
    await expectNoAxeViolations(container);
  });

  it("lists the emails: count, subject as a button, 'From · date, time', pasted text and a fallback to the file name", async () => {
    const base = syntheticJob();
    const files = [
      email(base.id, "Query about lot 12"),
      email(base.id, "Pasted query", {
        email: {
          parseStatus: "parsed",
          subject: "Pasted query",
          from: null,
          to: null,
          cc: null,
          sentAt: null,
          isPasted: true,
          bodyText: null,
        },
        uploadedAt: "2026-09-29T01:05:00.000Z",
      }),
      email(base.id, "x", {
        name: "Unreadable.msg",
        email: {
          parseStatus: "parsed",
          subject: null,
          from: null,
          to: null,
          cc: null,
          sentAt: SENT,
          isPasted: false,
          bodyText: null,
        },
      }),
    ];
    const { container } = renderCard(withEmails(files), "i4_3");
    expect(screen.getByText("3 emails")).toBeInTheDocument();
    expect(screen.getByText("Alex Planner · 28 Sep 2026, 3:50 pm")).toBeInTheDocument();
    expect(screen.getByText("Pasted text · 29 Sep 2026, 9:05 am")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unreadable.msg" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Pasted query" }));
    expect(viewer.open).toHaveBeenCalledWith(files, 1);
    await expectNoAxeViolations(container);
  });

  it("says 1 email for one", () => {
    const base = syntheticJob();
    renderCard(withEmails([email(base.id, "Only one")]), "i4_3");
    expect(screen.getByText("1 email")).toBeInTheDocument();
  });

  it("shows the scan and read states and does not let a blocked email be opened", () => {
    const base = syntheticJob();
    renderCard(
      withEmails([
        email(base.id, "Fresh", { scanStatus: "pending" }),
        email(base.id, "Infected", { scanStatus: "infected" }),
        email(base.id, "Odd", { scanStatus: "error" }),
        email(base.id, "Slow", {
          email: {
            parseStatus: "pending",
            subject: null,
            from: null,
            to: null,
            cc: null,
            sentAt: null,
            isPasted: false,
            bodyText: null,
          },
        }),
      ]),
      "i4_3",
    );
    expect(screen.getByText("Scanning…")).toBeInTheDocument();
    expect(screen.getByText("Blocked – failed the virus scan")).toBeInTheDocument();
    expect(screen.getByText(/Couldn't be checked for viruses/)).toBeInTheDocument();
    expect(screen.getByText("Reading the email…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Infected" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fresh" })).toBeInTheDocument();
  });

  it("removes an email after Yes and keeps it after No", async () => {
    const base = syntheticJob();
    const files = [email(base.id, "Query about lot 12")];
    const job = withEmails(files);
    const { served } = renderCard(job, "i4_3");
    const gone: string[] = [];
    server.use(
      handlerFor("deleteFile", ({ params }) => {
        gone.push(String(params.fileId));
        served.job = withCheckpoint(job, "i4_3", { files: [] });
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove Query about lot 12" }));
    expect(screen.getByRole("button", { name: "No" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "No" }));
    expect(screen.getByRole("button", { name: "Remove Query about lot 12" })).toHaveFocus();
    expect(gone).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Remove Query about lot 12" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    await waitFor(() => {
      expect(screen.getByText("none yet")).toBeInTheDocument();
    });
    expect(gone).toEqual([files[0]?.id]);
  });

  it("uploads a chosen .eml into the email slot and lists it", async () => {
    const job = syntheticJob();
    const requests = stubUploads();
    const { served } = renderCard(job, "i4_3");
    await userEvent.upload(zone(), new File(["From: a@example.com"], "Query.eml", { type: "message/rfc822" }));
    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    expect(requests[0]?.fields).toEqual({ checkpointKey: "i4_3", slot: "email", file: "Query.eml" });
    expect(screen.getByText("Saving email…")).toBeInTheDocument();
    const stored = email(job.id, "Query");
    served.job = withCheckpoint(job, "i4_3", { files: [stored] });
    requests[0]?.finish(201, uploadResult(stored));
    expect(await screen.findByRole("button", { name: "Query" })).toBeInTheDocument();
  });

  it("refuses a dropped file that is not an email with the emails wording, and sends nothing", async () => {
    const requests = stubUploads();
    renderCard(syntheticJob(), "i4_3");
    dropOn({ files: [new File(["x"], "Plan.pdf", { type: "application/pdf" })] });
    expect(
      await screen.findByText(
        "Plan.pdf isn't an email – drop an Outlook message (.msg) or .eml file, or use Upload for other documents",
      ),
    ).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });

  it("refuses an email over the size limit before sending it", async () => {
    const requests = stubUploads();
    renderCard(syntheticJob(), "i4_3");
    dropOn({ files: [new File([new Uint8Array(52_428_801)], "Huge.msg")] });
    expect(await screen.findByText("Huge.msg is larger than 50 MB")).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });

  it("adds dropped plain text as a pasted email (pasteEmail with the text) and lists it", async () => {
    const job = syntheticJob();
    const { served } = renderCard(job, "i4_3");
    const bodies: unknown[] = [];
    server.use(
      handlerFor("pasteEmail", async ({ request }) => {
        bodies.push(await request.json());
        const file = email(job.id, "Query from the Shire", {
          email: {
            parseStatus: "parsed",
            subject: "Query from the Shire",
            from: null,
            to: null,
            cc: null,
            sentAt: null,
            isPasted: true,
            bodyText: null,
          },
        });
        served.job = withCheckpoint(job, "i4_3", { files: [file] });
        return HttpResponse.json(file, { status: 201 });
      }),
    );
    dropOn({ text: "  Query from the Shire\nPlease advise.  " });
    expect(await screen.findByRole("button", { name: "Query from the Shire" })).toBeInTheDocument();
    expect(bodies).toEqual([{ text: "Query from the Shire\nPlease advise." }]);
    expect(screen.getByText("1 email")).toBeInTheDocument();
    expect(checkpointOf(served.job, "i4_3").files).toHaveLength(1);
  });

  it("says nothing was added when the drop carries neither files nor text", async () => {
    renderCard(syntheticJob(), "i4_3");
    dropOn({});
    expect(await screen.findByText("Nothing to add – drop an email file or email text")).toBeInTheDocument();
  });

  it("shows the request id when pasting fails and leaves the list as it was", async () => {
    renderCard(syntheticJob(), "i4_3");
    server.use(mockProblem("pasteEmail", 500));
    dropOn({ text: "A query" });
    expect(await screen.findByText(/The pasted email couldn't be added \(Request ID: .+\)/)).toBeInTheDocument();
    expect(screen.getByText("none yet")).toBeInTheDocument();
  });

  it("is read-only for an architect: the list shows, but no zone and no ×", () => {
    const base = syntheticJob({ role: "external", grantRole: "architect" });
    const files = [email(base.id, "Query about lot 12", { canDelete: false })];
    renderCard(withEmails(files, { role: "external", grantRole: "architect" }), "i4_3");
    expect(screen.getByRole("button", { name: "Query about lot 12" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Drop a WAPC query email here/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Remove/ })).not.toBeInTheDocument();
  });
});
