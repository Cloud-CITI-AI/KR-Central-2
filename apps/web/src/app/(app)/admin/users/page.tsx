import type { Metadata } from "next";
import { AdminHeader } from "@/features/admin/AdminHeader";
import { requireCapability } from "@/features/admin/require-capability";
import { LazyUsersPage } from "../LazyAdminPages";

export const metadata: Metadata = { title: "Users" };

/** `/admin/users` (§9.1): only for `users.manage` (admin); everyone else gets the not-found page. */
export default async function AdminUsersPage() {
  await requireCapability("users.manage");
  return (
    <>
      <AdminHeader current="users" />
      <LazyUsersPage />
    </>
  );
}
