/** The fields of the Job details form, in the order they are kept for a draft. */
export const JOB_DETAILS_FIELDS = ["jobNumber", "address", "clientName", "subdivisionType"] as const;
export type JobDetailsValues = Record<(typeof JOB_DETAILS_FIELDS)[number], string>;
