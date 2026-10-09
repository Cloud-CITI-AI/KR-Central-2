import { buildPath, getRoute } from "@kr/contracts";
import { API_BASE, redirectToSignIn } from "./client";
import { networkProblem, problemFromResponse } from "./problem";

/**
 * The bytes of a text-like file (text, CSV, Markdown, email) as a string, through the BFF (ADR-0005). `getFileContent`
 * answers raw bytes, not JSON, so it cannot go through `api()`; failures are handled the same way: problem+json
 * becomes `ApiProblem`, no response is a network problem, 401 redirects to sign-in, an abort is rethrown as is.
 */
export async function fetchFileText(fileId: string, signal?: AbortSignal): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${buildPath(getRoute("getFileContent").path, { fileId })}`, {
      credentials: "same-origin",
      signal: signal ?? null,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw networkProblem();
  }
  if (!response.ok) {
    const problem = await problemFromResponse(response);
    if (problem.status === 401) redirectToSignIn();
    throw problem;
  }
  return response.text();
}
