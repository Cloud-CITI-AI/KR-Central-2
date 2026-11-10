import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Home } from "@/features/home";
import { getMe } from "@/lib/session/get-me";

export const metadata: Metadata = { title: "Home" };

/**
 * KR Central home: the first page after sign-in for KR people. Modules and what needs the person (§4). Clients and
 * architects have one module and nothing to choose between, so they go straight to their jobs.
 */
export default async function HomePage() {
  const me = await getMe();
  if (me.user.role === "external") redirect("/subdivisions");
  return (
    <Suspense fallback={null}>
      <Home />
    </Suspense>
  );
}
