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
  files: {
    /** The text of a text, CSV, Markdown or email file (what the document viewer shows). */
    text: (fileId: string) => ["files", "text", fileId] as const,
  },
  grants: (query: Query = {}) => ["grants", query] as const,
  audit: (query: Query = {}) => ["audit", query] as const,
  users: (query: Query = {}) => ["users", query] as const,
  operation: (operationId: string) => ["operations", operationId] as const,
  teamsSettings: ["teams", "settings"] as const,
  teamsLink: (jobId: string) => ["teams", "link", jobId] as const,
  teamsUnfiled: (jobId: string) => ["teams", "unfiled", jobId] as const,
  teamsChannels: ["teams", "channels"] as const,
};
