import { setupServer } from "msw/node";

/** The shared MSW server (FE-14): component and client tests never reach a real API. Add handlers per test. */
export const server = setupServer();
