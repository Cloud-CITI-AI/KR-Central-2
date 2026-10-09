import type { ReactElement } from "react";
import { mockApi } from "@/test/msw/handlers";
import { syntheticMe } from "@/test/fixtures";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/render";

/** Render in the app providers; the session refresh gets its answer so no request goes unhandled. */
export function renderViewer(ui: ReactElement) {
  const me = syntheticMe();
  server.use(mockApi("getMe", me));
  return renderWithProviders(ui, { me });
}
