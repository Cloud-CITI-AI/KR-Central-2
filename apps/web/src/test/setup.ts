// Vitest setup: jest-dom, RTL cleanup, MSW for browser-like tests (unhandled requests fail, FE-14).
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./msw/server";

const browserLike = typeof window !== "undefined";
beforeAll(() => {
  if (browserLike) server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => {
  if (browserLike) server.close();
});
