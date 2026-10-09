"use client";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ApiProblem } from "@/lib/api";
import { GrantRow } from "./GrantRow";
import { ACCESS_MESSAGES } from "./messages";
import { sortGrants, useGrants } from "./queries";
import styles from "./GrantList.module.css";

/** Everyone on the access list, by job then email, with "Load more" past the first page. */
export function GrantList() {
  const grants = useGrants();
  if (grants.isError && !grants.data) {
    const requestId = grants.error instanceof ApiProblem ? grants.error.requestId : "";
    return (
      <p role="alert" className={styles.error}>
        {ACCESS_MESSAGES.loadFailed}
        {requestId && ` (Request ID: ${requestId})`}
      </p>
    );
  }
  if (!grants.data) return null;
  const rows = sortGrants(grants.data.pages.flatMap((page) => page.items));
  if (rows.length === 0) return <EmptyState>{ACCESS_MESSAGES.empty}</EmptyState>;
  return (
    <>
      <ul className={styles.list}>
        {rows.map((grant) => (
          <GrantRow key={grant.id} grant={grant} />
        ))}
      </ul>
      {grants.hasNextPage && (
        <Button
          small
          disabled={grants.isFetchingNextPage}
          onClick={() => {
            void grants.fetchNextPage();
          }}
        >
          Load more
        </Button>
      )}
    </>
  );
}
