import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminHeader } from "@/features/admin/AdminHeader";
import { requireCapability } from "@/features/admin/require-capability";
import { LazyTeamsSettingsPage } from "../LazyAdminPages";

export const metadata: Metadata = { title: "Teams" };

/** `/admin/teams` (§9.3): for `teams.settings.read` while the Teams integration exists in this deployment; else not found. */
export default async function AdminTeamsPage() {
  const me = await requireCapability("teams.settings.read");
  if (!me.features.teamsFileSync) notFound();
  return (
    <>
      <AdminHeader current="teams" />
      <LazyTeamsSettingsPage />
    </>
  );
}
