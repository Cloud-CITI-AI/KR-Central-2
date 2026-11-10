import type { Metadata } from "next";
import { Suspense } from "react";
import { Home } from "@/features/home";

export const metadata: Metadata = { title: "Home" };

/** KR Central home: the first page after sign-in. Modules and what needs the person (§4). */
export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <Home />
    </Suspense>
  );
}
