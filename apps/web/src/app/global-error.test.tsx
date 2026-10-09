// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GlobalError from "./global-error";

describe("global error page", () => {
  it("brings its own html and body, the hero header and the request id", () => {
    const html = renderToStaticMarkup(
      <GlobalError error={Object.assign(new Error("x"), { digest: "dg-9" })} reset={() => undefined} />,
    );
    expect(html).toMatch(/^<html lang="en-AU"><head><\/head><body>/);
    expect(html).toContain("KR Surveys Subdivision Tracker");
    expect(html).toContain("Something went wrong");
    expect(html).toContain("Request ID: dg-9");
    expect(html).not.toContain("x</");
  });
});
