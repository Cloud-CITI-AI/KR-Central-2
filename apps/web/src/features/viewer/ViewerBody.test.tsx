import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { syntheticFile } from "./test-fixtures";
import { renderViewer } from "./test-utils";
import { ViewerBody } from "./ViewerBody";

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
