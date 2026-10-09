import { HttpResponse } from "msw";
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

  it("puts the email header block above the message text, in Perth time", async () => {
    server.use(text("Hello,\nplease see attached."));
    const file = syntheticFile({
      name: "Query.eml",
      kind: "email",
      contentType: "message/rfc822",
      email: {
        parseStatus: "parsed",
        subject: "Query about lot 4",
        from: "planner@example.test",
        to: "office@example.test",
        cc: null,
        sentAt: "2026-09-28T07:50:00.000Z",
        isPasted: false,
      },
    });
    const { container } = renderViewer(<ViewerBody file={file} />);
    expect(await screen.findByText(/please see attached/)).toBeInTheDocument();
    const terms = [...container.querySelectorAll("dt")].map((dt) => dt.textContent);
    expect(terms).toEqual(["Subject", "From", "To", "Sent"]);
    expect(screen.getByText("Query about lot 4")).toBeInTheDocument();
    expect(screen.getByText("28 Sep 2026, 3:50 pm")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("shows only the header block for an Outlook .msg, without fetching its bytes", () => {
    const file = syntheticFile({
      name: "Query.msg",
      kind: "email",
      contentType: "application/vnd.ms-outlook",
      email: { parseStatus: "parsed", subject: "Query", from: null, to: null, cc: null, sentAt: null, isPasted: false },
    });
    renderViewer(<ViewerBody file={file} />);
    expect(screen.getByText("Query")).toBeInTheDocument();
    expect(screen.getByText(/can't be previewed in the browser/)).toBeInTheDocument();
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
    renderViewer(<ViewerBody file={syntheticFile({ scanStatus })} />);
    expect(screen.getByRole("status")).toHaveTextContent(message);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
