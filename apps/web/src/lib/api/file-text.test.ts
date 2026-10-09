import { PROBLEM_TYPES } from "@kr/contracts";
import { HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { navigation } from "@/lib/navigation";
import { handlerFor, mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { fetchFileText } from "./file-text";
import { ApiProblem } from "./problem";

const FILE_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("fetchFileText()", () => {
  it("returns the bytes as text from the same-origin content route", async () => {
    let url = "";
    server.use(
      handlerFor("getFileContent", ({ request }) => {
        url = request.url;
        return new HttpResponse("line one\nline two", { headers: { "content-type": "text/plain" } });
      }),
    );
    await expect(fetchFileText(FILE_ID)).resolves.toBe("line one\nline two");
    expect(new URL(url).pathname).toBe(`/api/v1/files/${FILE_ID}/content`);
  });

  it("throws an ApiProblem with the status and does not redirect for a 404", async () => {
    const assign = vi.spyOn(navigation, "assign").mockImplementation(() => undefined);
    server.use(handlerFor("getFileContent", () => new HttpResponse(null, { status: 404 })));
    const failure = await fetchFileText(FILE_ID).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiProblem);
    expect(failure).toMatchObject({ status: 404 });
    expect(assign).not.toHaveBeenCalled();
    assign.mockRestore();
  });

  it("redirects to sign-in on 401 and still throws", async () => {
    const assign = vi.spyOn(navigation, "assign").mockImplementation(() => undefined);
    server.use(mockProblem("getFileContent", 401, PROBLEM_TYPES.unauthenticated));
    await expect(fetchFileText(FILE_ID)).rejects.toMatchObject({ status: 401 });
    expect(assign).toHaveBeenCalledOnce();
    assign.mockRestore();
  });

  it("turns a dropped connection into a network problem", async () => {
    server.use(handlerFor("getFileContent", () => HttpResponse.error()));
    await expect(fetchFileText(FILE_ID)).rejects.toMatchObject({ status: 0, title: "Network error" });
  });

  it("rethrows an abort as it is, so a cancelled query is not reported as a failure", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(fetchFileText(FILE_ID, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
