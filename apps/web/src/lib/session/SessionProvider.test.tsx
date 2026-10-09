import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getCsrfToken } from "@/lib/api";
import { syntheticMe } from "@/test/fixtures";
import { mockApi } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { SessionProvider, useOptionalSession, useSession } from "./SessionProvider";

function Who() {
  return <p>{useSession().user.displayName}</p>;
}

const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {ui}
  </QueryClientProvider>
);

describe("SessionProvider", () => {
  it("exposes Me to descendants and publishes its CSRF token to the API client", () => {
    const me = syntheticMe("staff");
    render(
      wrap(
        <SessionProvider me={me}>
          <Who />
        </SessionProvider>,
      ),
    );
    expect(screen.getByText(me.user.displayName)).toBeInTheDocument();
    expect(getCsrfToken()).toBe(me.csrfToken);
  });

  it("picks up a refetched Me (e.g. a changed role) after the 15 s refresh", async () => {
    const me = syntheticMe("staff");
    const updated = syntheticMe("admin", { user: { ...me.user, displayName: "Renamed Person" } });
    server.use(mockApi("getMe", updated));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
    render(
      <QueryClientProvider client={client}>
        <SessionProvider me={me}>
          <Who />
        </SessionProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Renamed Person")).toBeInTheDocument();
    expect(getCsrfToken()).toBe(updated.csrfToken);
  });

  it("useSession fails loudly outside the provider while useOptionalSession is null", () => {
    function Probe() {
      return <p>{useOptionalSession() === null ? "null" : "session"}</p>;
    }
    render(<Probe />);
    expect(screen.getByText("null")).toBeInTheDocument();
    expect(() => render(<Who />)).toThrow(/SessionProvider/);
  });
});
