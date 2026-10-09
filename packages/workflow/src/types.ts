/**
 * Core vocabulary of the subdivision workflow. Wire values used by the API and stored in Postgres.
 * Source of truth for behaviour: the KR prototype (extracted.js `WORKFLOW`), see docs/spec/PRODUCT_SPEC.md §5.
 */

/** Checkpoint status. Prototype codes: c / n / x. */
export const CHECKPOINT_STATUSES = ["completed", "not_completed", "not_required"] as const;
export type CheckpointStatus = (typeof CHECKPOINT_STATUSES)[number];

/** Who is responsible for a checkpoint. `null` means unassigned. Prototype codes: KR / CL / AR / "". */
export const RESPONSIBILITIES = ["kr", "client", "architect"] as const;
export type Responsibility = (typeof RESPONSIBILITIES)[number];

/** Responsibility on a WAPC condition (prototype COND_RESP: KR / CL / ""). */
export const CONDITION_RESPONSIBILITIES = ["kr", "client"] as const;
export type ConditionResponsibility = (typeof CONDITION_RESPONSIBILITIES)[number];

export const RESPONSIBILITY_LABELS: Record<Responsibility | "unassigned", string> = {
  kr: "KR Surveys",
  client: "Client",
  architect: "Architect",
  unassigned: "Unassigned",
};

export const STATUS_LABELS: Record<CheckpointStatus, string> = {
  completed: "Completed",
  not_completed: "Not completed",
  not_required: "Not required",
};

/** Agencies that can be named on a WAPC condition (prototype AGENCIES). */
export const AGENCIES = ["Western Power", "Water Corporation", "Local Government", "Busselton Water", "WAPC"] as const;
export type Agency = (typeof AGENCIES)[number];

/** Agency stages that are automatically "not required" when the Decision Letter has conditions but none for them. */
export const OPTIONAL_AGENCIES = ["Western Power", "Water Corporation", "Local Government", "Busselton Water"] as const;
export type OptionalAgency = (typeof OPTIONAL_AGENCIES)[number];

/** Subdivision types shown as dashboard chips and chosen when creating a job (prototype SUB_TYPES). */
export const SUBDIVISION_TYPES = [
  "Survey-Strata",
  "Built Strata",
  "Amalgamation",
  "Freehold",
  "Strata Conversion",
  "Re-Subdivision",
] as const;
export type SubdivisionType = (typeof SUBDIVISION_TYPES)[number];

export const STAGE_KEYS = [
  "preliminaries",
  "wapc-approval",
  "western-power",
  "water-corporation",
  "local-government",
  "busselton-water",
  "wapc",
  "survey",
  "landgate",
  "titles",
] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

/**
 * File kinds accepted by upload slots. The API sniffs content (magic bytes) and maps it to one of these;
 * the declared extension alone is never trusted.
 */
export const FILE_KINDS = ["pdf", "image", "video", "text", "dwg", "email"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/** Who may upload into a slot, in addition to KR staff (staff can always upload). */
export type SlotUploaders = "staff" | "staff_and_client" | "staff_and_external";

export interface SlotDefinition {
  /** Stable key, unique within the checkpoint. Stored as `files.slot`. */
  readonly key: string;
  /** Heading shown above the slot (e.g. "Clearance PDF"). */
  readonly title: string;
  /** Bold text inside the drop zone. */
  readonly dropLabel: string;
  /** Secondary text inside the drop zone. */
  readonly dropHint: string;
  readonly accept: readonly FileKind[];
  readonly uploaders: SlotUploaders;
  /** Shown as a "required"/"received" chip (survey PDF+DWG, clearance slots, plumber documents). */
  readonly showRequirementChip?: boolean;
  /** For the survey slot: each listed kind must be present at least once for the chips to turn green. */
  readonly requiredKinds?: readonly FileKind[];
}

export interface ApprovalPanel {
  readonly type: "approval";
  /** e.g. "fee proposal", "quote". Used in "Approve fee proposal", "Client declined the quote". */
  readonly noun: string;
  /** Folder of documents the client reviews; absent when the prototype had `noFolder`. */
  readonly folder?: { readonly title: string; readonly hint: string; readonly slot: SlotDefinition };
  /** Extra drop slot inside the panel (WAPC proposal: completed letter of consent). */
  readonly extraSlot?: SlotDefinition;
  readonly yesLabel: string;
  readonly yesPast: string;
  readonly confirmLabel: string;
  /** Label above the decision buttons (default "Client decision"). */
  readonly decisionLabel: string;
}

export interface PaidPanel {
  readonly type: "paid";
  readonly label: string;
  readonly buttonLabel: string;
  readonly doneLabel: string;
}

export interface KrNotePanel {
  readonly type: "kr_note";
  readonly label: string;
  readonly placeholder: string;
}

export interface DocumentsPanel {
  /** Single titled drop area (prototype `drop`, `photos`, `extraDrop`). */
  readonly type: "documents";
  readonly variant: "documents" | "photos";
  readonly slot: SlotDefinition;
}

export interface SlotsPanel {
  /** Several required files, each with its own drop box (prototype `slots`, `clearance` with slots). */
  readonly type: "slots";
  readonly title: string;
  readonly slots: readonly SlotDefinition[];
}

export interface ClearancePanel {
  /** Single clearance drop for an agency (prototype `clearance` without slots). */
  readonly type: "clearance";
  readonly agency: OptionalAgency;
  readonly slot: SlotDefinition;
}

export interface SurveyPanel {
  readonly type: "survey";
  readonly slot: SlotDefinition;
}

export interface ConformancePanel {
  readonly type: "conformance";
  readonly slot: SlotDefinition;
}

export interface EmailsPanel {
  readonly type: "emails";
  readonly slot: SlotDefinition;
}

export interface ConditionsPanel {
  readonly type: "conditions";
  readonly slot: SlotDefinition;
}

export type Panel =
  | ApprovalPanel
  | PaidPanel
  | KrNotePanel
  | DocumentsPanel
  | SlotsPanel
  | ClearancePanel
  | SurveyPanel
  | ConformancePanel
  | EmailsPanel
  | ConditionsPanel;

export type PanelType = Panel["type"];

export interface FeeTag {
  readonly label: string;
  /** "client" renders the yellow "Client payment" tag, "kr" the blue "KR payment" tag. */
  readonly payer: "client" | "kr";
}

export interface CheckpointDefinition {
  /** Storage key (prototype `k` or derived `i<n with . replaced by _>`). Never shown to users. */
  readonly key: string;
  /** Display number, e.g. "12.3". */
  readonly number: string;
  readonly stage: StageKey;
  readonly title: string;
  readonly description?: string;
  readonly defaultResponsibility: Responsibility | null;
  /** KR progress claim tag, e.g. "Item 1 payment required" (rendered upper-case). */
  readonly progressClaim?: string;
  readonly fee?: FeeTag;
  /**
   * Visibility restriction. "fee_proposal": panel content and files visible only to admin, kr_admin and
   * the job's client grants (developer note 2). Everyone else sees number, title and status only.
   */
  readonly restricted?: "fee_proposal";
  /** Panels in render order (main column of the card). */
  readonly panels: readonly Panel[];
}

export interface StageDefinition {
  readonly key: StageKey;
  readonly name: string;
  /** Set for the four optional agency stages and "WAPC" (conditions evidence shown at top of the stage). */
  readonly agency?: Agency;
  /** True for agency stages that are auto-excluded when the Decision Letter has no conditions for them. */
  readonly optional: boolean;
  /** Reporting phase used by next-action rules (prototype jobSummary). */
  readonly phase: "sequential-before" | "agencies" | "sequential-after";
  readonly checkpoints: readonly CheckpointDefinition[];
  /** Index (within checkpoints) after which the WAPC outcome-date box is rendered. Only WAPC Approval. */
  readonly outcomeBoxAfter?: string;
}
