import type { Metadata } from "next";
import { AdminHeader, AuditPage, requireCapability } from "@/features/admin";

export const metadata: Metadata = { title: "Audit trail" };

/** `/admin/audit` (§9.2): only for `audit.read` (admin and kr_admin); everyone else gets the not-found page. */
export default async function AdminAuditPage() {
  await requireCapability("audit.read");
  return (
    <>
      <AdminHeader current="audit" />
      <AuditPage />
    </>
  );
}
