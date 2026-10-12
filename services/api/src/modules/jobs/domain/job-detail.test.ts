import { JobDetail, jobCapabilitiesFor } from "@kr/contracts";
import type { CheckpointStateRow, ConditionRow, FileRow, JobRow } from "@kr/db";
import { CHECKPOINTS } from "@kr/workflow";
import { describe, expect, it } from "vitest";
import { buildCheckpointState, buildJobDetail, type JobParts, type JobViewer } from "./job-detail.js";

const NOW = new Date("2026-03-02T01:00:00Z");
const T0 = new Date("2026-02-01T00:00:00Z");
const JOB_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ids = {
  staff: "11111111-1111-4111-8111-111111111111",
  client: "22222222-2222-4222-8222-222222222222",
  file1: "33333333-3333-4333-8333-333333333331",
  file2: "33333333-3333-4333-8333-333333333332",
  fee: "33333333-3333-4333-8333-333333333333",
  evidence: "33333333-3333-4333-8333-333333333334",
  cond: "44444444-4444-4444-8444-444444444441",
};

const job: JobRow = {
  id: JOB_ID,
  job_number: "S-0001",
  address: "1 Example Street, Testville",
  client_name: null,
  subdivision_type: "Freehold",
  approval_date: "2026-03-02",
  approval_expiry: "2029-03-02",
  conformed_date: "2026-02-10",
  conformed_method: "file_name",
  conformed_file_id: ids.file1,
  conformed_stamp_text: null,
  outcome_date: "2026-05-11",
  conditions_source_file_id: ids.file2,
  conditions_extracted_at: T0,
  created_by: ids.staff,
  created_at: T0,
  updated_at: T0,
  deleted_at: null,
  deleted_by: null,
  version: 7,
};

function state(key: string, o: Partial<CheckpointStateRow> = {}): CheckpointStateRow {
  return {
    job_id: JOB_ID,
    checkpoint_key: key,
    status: "not_completed",
    responsibility: null,
    kr_note: "",
    paid_at: null,
    paid_by: null,
    decision: null,
    decision_comment: "",
    decided_at: null,
    decided_by: null,
    updated_by: null,
    updated_at: T0,
    version: 1,
    ...o,
  };
}

function file(id: string, o: Partial<FileRow>): FileRow {
  return {
    id,
    job_id: JOB_ID,
    checkpoint_key: "i2_0",
    slot: "survey",
    condition_id: null,
    storage_key: `jobs/${JOB_ID}/${id}`,
    original_name: "plan.pdf",
    kind: "pdf",
    content_type: "application/pdf",
    size_bytes: "1000",
    sha256: Buffer.alloc(32),
    scan_status: "clean",
    scan_detail: null,
    scanned_at: null,
    scan_attempts: 0,
    scan_retries_exhausted: false,
    uploaded_by: ids.staff,
    uploaded_at: T0,
    deleted_at: null,
    deleted_by: null,
    purged_at: null,
    ...o,
  };
}

const condition: ConditionRow = {
  id: ids.cond,
  job_id: JOB_ID,
  condition_number: 1,
  text: "Condition text",
  agency: "Western Power",
  agency_guessed: false,
  is_cleared: false,
  cleared_at: null,
  cleared_by: null,
  responsibility: null,
  kr_comment: "",
  client_comment: "",
  extraction_id: null,
  superseded_at: null,
  created_at: T0,
  updated_at: T0,
  updated_by: null,
  version: 1,
};

function parts(o: Partial<JobParts> = {}): JobParts {
  return {
    job,
    states: CHECKPOINTS.map((c) =>
      state(c.key, {
        responsibility: c.defaultResponsibility,
        ...(c.key === "i1_0p"
          ? { decision: "declined", decision_comment: "No", decided_at: T0, decided_by: ids.client, kr_note: "private" }
          : {}),
      }),
    ),
    conditions: [condition],
    files: [
      file(ids.file1, { checkpoint_key: "i4_2", slot: "conformance", original_name: "conformed.pdf" }),
      file(ids.file2, { checkpoint_key: "i5_0", slot: "decision", original_name: "Decision Letter.pdf" }),
      file(ids.fee, { checkpoint_key: "i1_0p", slot: "documents", original_name: "fee.pdf", scan_status: "pending" }),
      file(ids.evidence, { checkpoint_key: null, slot: null, condition_id: ids.cond, uploaded_by: ids.client }),
    ],
    emails: [],
    users: [
      { id: ids.staff, display_name: "Sam Staff" },
      { id: ids.client, display_name: "Cleo Client" },
    ],
    fileNames: new Map([
      [ids.file1, "conformed.pdf"],
      [ids.file2, "Decision Letter.pdf"],
    ]),
    ...o,
  };
}

const viewer = (role: Parameters<typeof jobCapabilitiesFor>[0], grant: JobViewer["grantRole"] = null, id = ids.staff) =>
  ({ id, capabilities: jobCapabilitiesFor(role, grant), grantRole: grant }) satisfies JobViewer;

describe("buildJobDetail", () => {
  it("produces a contract-valid JobDetail with all 46 checkpoints in workflow order", () => {
    const detail = buildJobDetail(parts(), viewer("kr_admin"), NOW);
    expect(JobDetail.parse(detail)).toEqual(detail);
    expect(detail.checkpoints.map((c) => c.key)).toEqual(CHECKPOINTS.map((c) => c.key));
    expect(detail).toMatchObject({
      version: 7,
      conformedSource: { method: "file_name", fileName: "conformed.pdf", stampText: null },
      conditionsSource: { fileId: ids.file2, fileName: "Decision Letter.pdf" },
      viewerGrantRole: null,
    });
    expect(detail.capabilities).toContain("job.delete");
  });

  it("applies agency exclusion to the effective status of agency checkpoints", () => {
    const detail = buildJobDetail(parts(), viewer("staff"), NOW);
    const water = detail.checkpoints.find((c) => c.key === "i7_0");
    expect(water).toMatchObject({ status: "not_required", storedStatus: "not_completed", excludedByConditions: true });
    expect(detail.summary.stages.find((s) => s.stage === "water-corporation")).toMatchObject({ excluded: true });
  });

  it("shows the fee proposal to kr_admin and a client grant, with its decision and files", () => {
    for (const v of [viewer("kr_admin"), viewer("external", "client", ids.client)]) {
      const fee = buildJobDetail(parts(), v, NOW).checkpoints.find((c) => c.key === "i1_0p");
      expect(fee).toMatchObject({ isRestricted: false, krNote: "private", decision: { value: "declined" } });
      expect(fee?.files.map((f) => f.id)).toEqual([ids.fee]);
    }
  });

  it("replaces the fee proposal content for staff and architects, and counts no restricted file or alert", () => {
    for (const v of [viewer("staff"), viewer("external", "architect", ids.client)]) {
      const detail = buildJobDetail(parts(), v, NOW);
      const fee = detail.checkpoints.find((c) => c.key === "i1_0p");
      expect(fee).toMatchObject({
        isRestricted: true,
        krNote: "",
        decision: null,
        paid: null,
        files: [],
        status: "not_completed",
      });
      expect(JSON.stringify(detail)).not.toContain(ids.fee);
      expect(detail.summary.alerts.map((a) => a.code)).toEqual([]);
    }
    expect(buildJobDetail(parts(), viewer("kr_admin"), NOW).summary.alerts.map((a) => a.code)).toEqual([
      "client_declined",
    ]);
  });

  it("counts only clean or skipped files the viewer may see in the package", () => {
    expect(buildJobDetail(parts(), viewer("kr_admin"), NOW).summary.fileCount).toBe(3);
    const staffParts = parts({ files: parts().files.filter((f) => f.checkpoint_key !== "i1_0p") });
    expect(buildJobDetail(staffParts, viewer("staff"), NOW).summary.fileCount).toBe(3);
    const pending = parts({ files: parts().files.map((f) => ({ ...f, scan_status: "pending" as const })) });
    expect(buildJobDetail(pending, viewer("admin"), NOW).summary.fileCount).toBe(0);
  });

  it("attaches condition evidence and sets canDelete from capabilities and ownership", () => {
    const asClient = buildJobDetail(parts(), viewer("external", "client", ids.client), NOW);
    expect(asClient.conditions[0]?.evidence.map((f) => [f.id, f.canDelete])).toEqual([[ids.evidence, true]]);
    const asArchitect = buildJobDetail(parts(), viewer("external", "architect", ids.staff), NOW);
    expect(asArchitect.conditions[0]?.evidence[0]?.canDelete).toBe(false);
    const asStaff = buildJobDetail(parts(), viewer("staff"), NOW);
    expect(asStaff.conditions[0]?.evidence[0]?.canDelete).toBe(true);
    expect(asStaff.checkpoints.find((c) => c.key === "i4_2")?.files[0]).toMatchObject({
      canDelete: true,
      uploadedBy: { displayName: "Sam Staff" },
    });
  });

  it("leaves the sources empty before a conformed date or a Decision Letter exists", () => {
    const bare = {
      ...job,
      conformed_date: null,
      conformed_method: null,
      conformed_file_id: null,
      conditions_source_file_id: null,
      conditions_extracted_at: null,
    };
    const detail = buildJobDetail(parts({ job: bare, conditions: [], files: [] }), viewer("staff"), NOW);
    expect(detail).toMatchObject({ conformedSource: null, conditionsSource: null, conditions: [] });
  });
});

describe("buildCheckpointState", () => {
  it("renders one checkpoint with the same restrictions", () => {
    expect(buildCheckpointState(parts(), viewer("staff"), "i1_0p")).toMatchObject({ isRestricted: true, files: [] });
    expect(buildCheckpointState(parts(), viewer("admin"), "i1_0p")).toMatchObject({ isRestricted: false });
    expect(() => buildCheckpointState(parts(), viewer("admin"), "nope")).toThrow(RangeError);
    expect(() => buildJobDetail(parts({ states: [] }), viewer("staff"), NOW)).toThrow(RangeError);
  });
});
