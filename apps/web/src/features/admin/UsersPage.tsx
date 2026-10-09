"use client";
import { GLOBAL_ROLES, type GlobalRole } from "@kr/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { api, queryKeys } from "@/lib/api";
import { useSession } from "@/lib/session";
import styles from "./Admin.module.css";
import { ROLE_LABELS } from "./format";
import { ProblemNotice } from "./ProblemNotice";
import { useDebouncedValue } from "./useDebouncedValue";
import { UsersTable } from "./UsersTable";

/** `/admin/users` (§9.1): the users table with search by name or email and a role filter, 50 at a time. */
export function UsersPage() {
  const me = useSession();
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<GlobalRole | "">("");
  const q = useDebouncedValue(search.trim());

  const users = useInfiniteQuery({
    queryKey: queryKeys.users({ q, role }),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api("listUsers", {
        query: {
          limit: 50,
          ...(q ? { q } : {}),
          ...(role ? { role } : {}),
          ...(pageParam ? { cursor: pageParam } : {}),
        },
        signal,
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = users.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className={styles.panel} aria-label="Users">
      <div className={styles.filters}>
        <Input
          type="search"
          aria-label="Search users"
          placeholder="Search by name or email"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
        <Select
          aria-label="Filter by role"
          value={role}
          onChange={(event) => {
            setRole(event.target.value as GlobalRole | "");
          }}
        >
          <option value="">All roles</option>
          {GLOBAL_ROLES.map((value) => (
            <option key={value} value={value}>
              {ROLE_LABELS[value]}
            </option>
          ))}
        </Select>
      </div>
      {users.isPending && <Spinner label="Loading users…" />}
      {users.isError && (
        <ProblemNotice
          error={users.error}
          onRetry={() => {
            void users.refetch();
          }}
        />
      )}
      {users.isSuccess && (
        <>
          {rows.length === 0 ? (
            <EmptyState>No users match. Try a different search or role.</EmptyState>
          ) : (
            <>
              <p className={styles.summary} role="status">
                {rows.length} {rows.length === 1 ? "user" : "users"}
                {users.hasNextPage ? " so far" : ""}
              </p>
              <UsersTable users={rows} currentUserId={me.user.id} />
            </>
          )}
          {users.hasNextPage && (
            <Button
              className={styles.more}
              disabled={users.isFetchingNextPage}
              onClick={() => void users.fetchNextPage()}
            >
              Load more
            </Button>
          )}
        </>
      )}
    </section>
  );
}
