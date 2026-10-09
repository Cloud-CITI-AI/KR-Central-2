// Vitest setup: jest-dom, RTL cleanup, MSW for browser-like tests (unhandled requests fail, FE-14).
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./msw/server";

const browserLike = typeof window !== "undefined";

// jsdom has <dialog> but not showModal()/close(): a minimal stand-in (focus handling is the component's own).
if (browserLike && typeof HTMLDialogElement.prototype.showModal !== "function") {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}
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
