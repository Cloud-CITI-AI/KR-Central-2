import type { Metadata } from "next";
import { AdminHeader } from "@/features/admin/AdminHeader";
import { requireCapability } from "@/features/admin/require-capability";
import { LazyAuditPage } from "../LazyAdminPages";

export const metadata: Metadata = { title: "Audit trail" };

/** `/admin/audit` (§9.2): only for `audit.read` (admin and kr_admin); everyone else gets the not-found page. */
export default async function AdminAuditPage() {
  await requireCapability("audit.read");
  return (
    <>
      <AdminHeader current="audit" />
      <LazyAuditPage />
    </>
  );
}
