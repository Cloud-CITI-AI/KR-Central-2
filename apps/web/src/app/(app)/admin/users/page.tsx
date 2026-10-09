import type { Metadata } from "next";
import { AdminHeader, requireCapability, UsersPage } from "@/features/admin";

export const metadata: Metadata = { title: "Users" };

/** `/admin/users` (§9.1): only for `users.manage` (admin); everyone else gets the not-found page. */
export default async function AdminUsersPage() {
  await requireCapability("users.manage");
  return (
    <>
      <AdminHeader current="users" />
      <UsersPage />
    </>
  );
}
