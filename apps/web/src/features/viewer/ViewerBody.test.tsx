import { HttpResponse } from "msw";
import type { FileMeta } from "@kr/contracts";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { navigation } from "@/lib/navigation";
import { expectNoAxeViolations } from "@/test/axe";
import { handlerFor } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { syntheticFile } from "./test-fixtures";
import { renderViewer } from "./test-utils";
import { ViewerBody } from "./ViewerBody";

const text = (body: string) => handlerFor("getFileContent", () => HttpResponse.text(body));

describe("ViewerBody", () => {
  it("shows an image with the file name as its alt text", () => {
    const file = syntheticFile({ name: "plan.png", kind: "image", contentType: "image/png" });
    renderViewer(<ViewerBody file={file} />);
    const image = screen.getByRole("img", { name: "plan.png" });
    expect(image).toHaveAttribute("src", `/api/v1/files/${file.id}/content`);
  });

  it("plays a video from the content URL, which the server answers with Range", () => {
    const file = syntheticFile({ name: "site.mp4", kind: "video", contentType: "video/mp4" });
    const { container } = renderViewer(<ViewerBody file={file} />);
    const video = container.querySelector("video");
    expect(video).toHaveAttribute("src", `/api/v1/files/${file.id}/content`);
    expect(video).toHaveAttribute("controls");
  });

  it("shows text in a <pre> after loading it", async () => {
    server.use(text("line one\nline two"));
    const file = syntheticFile({ name: "notes.txt", kind: "text", contentType: "text/plain" });
    const { container } = renderViewer(<ViewerBody file={file} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    expect(await screen.findByText(/line one/)).toBeInTheDocument();
    expect(container.querySelector("pre")).toHaveTextContent("line one line two");
    await expectNoAxeViolations(container);
  });

  it("says so when the text cannot be loaded", async () => {
    server.use(handlerFor("getFileContent", () => new HttpResponse(null, { status: 404 })));
    const file = syntheticFile({ kind: "text", contentType: "text/plain" });
    renderViewer(<ViewerBody file={file} />);
    expect(await screen.findByText("Couldn’t load this file. Use “Open in new tab”.")).toBeInTheDocument();
  });

  it("sends a signed-out viewer to sign-in when the text answers 401, and says it could not load", async () => {
    const assign = vi.spyOn(navigation, "assign").mockImplementation(() => undefined);
    server.use(handlerFor("getFileContent", () => new HttpResponse(null, { status: 401 })));
    renderViewer(<ViewerBody file={syntheticFile({ kind: "text", contentType: "text/plain" })} />);
    expect(await screen.findByText("Couldn’t load this file. Use “Open in new tab”.")).toBeInTheDocument();
    expect(assign).toHaveBeenCalledWith("/sign-in");
    assign.mockRestore();
  });

  describe("emails (PRODUCT_SPEC 10.3: Subject/From/To/Cc/Date, a rule, body)", () => {
    const email = (over: Partial<NonNullable<FileMeta["email"]>> = {}): NonNullable<FileMeta["email"]> => ({
      parseStatus: "parsed",
      subject: "Query about lot 4",
      from: "planner@example.test",
      to: "office@example.test",
      cc: null,
      sentAt: "2026-09-28T07:50:00.000Z",
      isPasted: false,
      bodyText: "Plain version café continued",
      ...over,
    });

    it("shows the parsed body of an .eml under its header block and a rule, not the raw MIME source", async () => {
      // No content handler: the parsed body is on the file, so nothing may be fetched.
      const file = syntheticFile({ name: "Query.eml", kind: "email", contentType: "message/rfc822", email: email() });
      const { container } = renderViewer(<ViewerBody file={file} />);
      const terms = [...container.querySelectorAll("dt")].map((dt) => dt.textContent);
      expect(terms).toEqual(["Subject", "From", "To", "Date"]);
      expect(screen.getByText("Query about lot 4")).toBeInTheDocument();
      expect(screen.getByText("28 Sep 2026, 3:50 pm")).toBeInTheDocument();
      expect(screen.getByRole("separator")).toBeInTheDocument();
      expect(container.querySelector("pre")).toHaveTextContent("Plain version café continued");
      expect(container).not.toHaveTextContent("Content-Type");
      expect(screen.queryByText(/can't be previewed/)).toBeNull();
      await expectNoAxeViolations(container);
    });

    it("shows the parsed body of an Outlook .msg the same way", () => {
      const file = syntheticFile({
        name: "Query.msg",
        kind: "email",
        contentType: "application/vnd.ms-outlook",
        email: email({ cc: "records@example.test" }),
      });
      const { container } = renderViewer(<ViewerBody file={file} />);
      expect([...container.querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual([
        "Subject",
        "From",
        "To",
        "Cc",
        "Date",
      ]);
      expect(container.querySelector("pre")).toHaveTextContent("Plain version café continued");
      expect(screen.queryByText(/can't be previewed/)).toBeNull();
    });

    it("shows a pasted email, stored as text, from its parsed body too", () => {
      const file = syntheticFile({
        name: "Query about lot 12.txt",
        kind: "text",
        contentType: "text/plain",
        email: email({ isPasted: true, from: "Pasted text", to: null, bodyText: "Please confirm the setback." }),
      });
      const { container } = renderViewer(<ViewerBody file={file} />);
      expect(container.querySelector("pre")).toHaveTextContent("Please confirm the setback.");
      expect(screen.getByText("Pasted text")).toBeInTheDocument();
    });

    it("says there is no message text when the message was parsed and has none", () => {
      const file = syntheticFile({ kind: "email", contentType: "message/rfc822", email: email({ bodyText: null }) });
      const { container } = renderViewer(<ViewerBody file={file} />);
      expect(screen.getByText("(no message text)")).toBeInTheDocument();
      expect(container.querySelector("pre")).toBeNull();
    });

    it("falls back to the raw text of an .eml that could not be parsed", async () => {
      server.use(text("Subject: raw\r\n\r\nraw body"));
      const file = syntheticFile({
        kind: "email",
        contentType: "message/rfc822",
        email: email({ parseStatus: "failed", subject: null, from: null, to: null, sentAt: null, bodyText: null }),
      });
      const { container } = renderViewer(<ViewerBody file={file} />);
      expect(await screen.findByText(/raw body/)).toBeInTheDocument();
      expect(container.querySelector("pre")).toBeInTheDocument();
    });

    it("explains that an unparsed Outlook .msg cannot be previewed, without fetching its bytes", () => {
      const file = syntheticFile({
        kind: "email",
        contentType: "application/vnd.ms-outlook",
        email: email({ parseStatus: "pending", bodyText: null }),
      });
      renderViewer(<ViewerBody file={file} />);
      expect(screen.getByText(/can't be previewed in the browser/)).toBeInTheDocument();
    });
  });

  it("explains a DWG and offers a direct .dwg download", async () => {
    const file = syntheticFile({ name: "survey.dwg", kind: "dwg", contentType: "image/vnd.dwg" });
    const { container } = renderViewer(<ViewerBody file={file} />);
    expect(screen.getByText("DWG drawings can't be previewed in the browser")).toBeInTheDocument();
    expect(screen.getByText("Download it and open it in your CAD software.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download survey.dwg" })).toHaveAttribute(
      "href",
      `/api/v1/files/${file.id}/content?disposition=attachment`,
    );
    await expectNoAxeViolations(container);
  });

  it.each([
    ["pending", "This file is still being checked for viruses."],
    ["infected", "Blocked – failed the virus scan"],
    ["error", "Couldn't be checked for viruses – remove it and upload it again"],
  ] as const)("shows the %s message instead of the content", (scanStatus, message) => {
    renderViewer(<ViewerBody file={syntheticFile({ scanStatus, scanRetriesExhausted: scanStatus === "error" })} />);
    expect(screen.getByRole("status")).toHaveTextContent(message);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says a failed scan that will be retried is still being checked", () => {
    renderViewer(<ViewerBody file={syntheticFile({ scanStatus: "error", scanRetriesExhausted: false })} />);
    expect(screen.getByRole("status")).toHaveTextContent("This file is still being checked for viruses.");
  });
});
