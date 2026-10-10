"use client";
import type { GlobalRole, User } from "@kr/contracts";
import { GLOBAL_ROLES } from "@kr/contracts/capabilities";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { api, ApiProblem, queryKeys } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast/ToastProvider";
import styles from "./Admin.module.css";
import { ROLE_LABELS } from "./format";
import { ProblemNotice } from "./ProblemNotice";
import { useDebouncedValue } from "./useDebouncedValue";
import { UsersTable } from "./UsersTable";

interface Change {
  readonly user: User;
  readonly body: { role: GlobalRole } | { status: User["status"] };
}

/** The question put to the admin before a change (every change signs the person out, §9.1). */
export function confirmation({ user, body }: Change): { title: string; text: string; label: string } {
  const name = user.displayName;
  if ("role" in body) {
    return {
      title: "Change role",
      text: `Change ${name} from ${ROLE_LABELS[user.role]} to ${ROLE_LABELS[body.role]}? They are signed out and sign in again with the new role.`,
      label: "Change role",
    };
  }
  return body.status === "disabled"
    ? {
        title: "Disable user",
        text: `Disable ${name}? They are signed out now and cannot sign in until you enable them again.`,
        label: "Disable",
      }
    : { title: "Enable user", text: `Enable ${name}? They can sign in again.`, label: "Enable" };
}

/** `/admin/users` (§9.1): search, role filter, role change and disable/enable, each after a confirmation. */
export function UsersPage() {
  const me = useSession();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<GlobalRole | "">("");
  const [pending, setPending] = useState<Change | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
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

  const change = useMutation({
    mutationFn: ({ user, body }: Change) => api("updateUser", { params: { userId: user.id }, body }),
    onMutate: () => {
      setProblem(null);
    },
    onSuccess: (updated) => {
      toast(`${updated.displayName} updated.`);
    },
    onError: (error) => {
      setProblem(error);
    },
    onSettled: async (_data, error) => {
      setPending(null);
      // A 412 means the list is stale: reload it so the next change starts from what is stored (§14).
      if (!error || (error instanceof ApiProblem && error.isStale)) {
        await queryClient.invalidateQueries({ queryKey: ["users"] });
      }
    },
  });

  const rows = users.data?.pages.flatMap((page) => page.items) ?? [];
  const asked = pending ? confirmation(pending) : null;

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
      {problem !== null && <ProblemNotice error={problem} />}
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
          <p className={styles.summary} role="status">
            {rows.length === 0
              ? "No users match."
              : `${rows.length} ${rows.length === 1 ? "user" : "users"}${users.hasNextPage ? " so far" : ""}`}
          </p>
          {rows.length === 0 ? (
            <EmptyState>Try a different search or role.</EmptyState>
          ) : (
            <UsersTable
              users={rows}
              currentUserId={me.user.id}
              onChangeRole={(user, next) => {
                if (next !== user.role) setPending({ user, body: { role: next } });
              }}
              onToggleStatus={(user) => {
                setPending({ user, body: { status: user.status === "active" ? "disabled" : "active" } });
              }}
            />
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
      <ConfirmDialog
        open={asked !== null}
        title={asked?.title ?? ""}
        confirmLabel={asked?.label ?? ""}
        busy={change.isPending}
        onConfirm={() => {
          if (pending) change.mutate(pending);
        }}
        onCancel={() => {
          setPending(null);
        }}
      >
        {asked?.text}
      </ConfirmDialog>
    </section>
  );
}
