"use client";
import type { Me } from "@kr/contracts";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useInsertionEffect, type ReactNode } from "react";
import { api, queryKeys, setCsrfToken } from "@/lib/api";

const SessionContext = createContext<Me | null>(null);

export interface SessionProviderProps {
  /** The `Me` fetched on the server by `getMe()`; kept fresh with the app's 15 s refetch (role changes, expiry). */
  readonly me: Me;
  readonly children: ReactNode;
}

export function SessionProvider({ me, children }: SessionProviderProps) {
  const { data } = useQuery({ queryKey: queryKeys.me, queryFn: () => api("getMe"), initialData: me });
  // Insertion effects run before any child effect, so the CSRF token is set before the first write can happen.
  useInsertionEffect(() => {
    setCsrfToken(data.csrfToken);
  }, [data.csrfToken]);
  return <SessionContext value={data}>{children}</SessionContext>;
}

/** The signed-in user, role, capabilities, CSRF token and feature flags. Only inside the authenticated layout. */
export function useSession(): Me {
  const me = useContext(SessionContext);
  if (!me) throw new Error("useSession must be used inside <SessionProvider>");
  return me;
}

/** Like `useSession` but `null` on public pages (the hero header renders with or without a user). */
export function useOptionalSession(): Me | null {
  return useContext(SessionContext);
}
