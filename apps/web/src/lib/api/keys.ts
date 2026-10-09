/** TanStack Query keys, one place so invalidation and optimistic updates agree. Prefix order: invalidate by `all`. */
type Query = Record<string, unknown>;

export const queryKeys = {
  me: ["me"] as const,
  jobs: {
    all: ["jobs"] as const,
    list: (query: Query = {}) => ["jobs", "list", query] as const,
    facets: (query: Query = {}) => ["jobs", "facets", query] as const,
    detail: (jobId: string) => ["jobs", "detail", jobId] as const,
    notes: (jobId: string) => ["jobs", "notes", jobId] as const,
  },
  grants: (query: Query = {}) => ["grants", query] as const,
  audit: (query: Query = {}) => ["audit", query] as const,
  users: (query: Query = {}) => ["users", query] as const,
  operation: (operationId: string) => ["operations", operationId] as const,
};
