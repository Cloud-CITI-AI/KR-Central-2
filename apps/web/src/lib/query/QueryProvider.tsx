"use client";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { createQueryClient } from "./client";

export interface QueryProviderProps {
  readonly children: ReactNode;
}

/** One QueryClient per browser tab (created once, never shared between requests on the server). */
export function QueryProvider({ children }: QueryProviderProps) {
  const [client] = useState(createQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
