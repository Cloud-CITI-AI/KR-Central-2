/**
 * The workflow definition: 10 stages, 46 checkpoints. Ported verbatim (titles, descriptions, tags, panel text)
 * from the prototype's `WORKFLOW` constant. This file is the single source of truth for the API, the web app
 * and the `checkpoint_definitions` seed in packages/db (a test asserts they match).
 *
 * Changing a key is a data migration. Adding a checkpoint needs a migration that seeds it and back-fills
 * `checkpoint_states` for existing jobs.
 */
import type { CheckpointDefinition, SlotDefinition, StageDefinition, StageKey } from "./types.js";

const GENERIC_ACCEPT = ["pdf", "image", "video", "text"] as const;
const PDF_ONLY = ["pdf"] as const;
const PDF_OR_IMAGE = ["pdf", "image"] as const;

function pdfSlot(
  key: string,
  title: string,
  dropLabel: string,
  uploaders: SlotDefinition["uploaders"] = "staff",
): SlotDefinition {
  return { key, title, dropLabel, dropHint: "PDF – or click to choose", accept: PDF_ONLY, uploaders };
}

function clearanceSlot(agency: string): SlotDefinition {
  return {
    key: "clearance",
    title: `${agency} clearance`,
    dropLabel: `Drag and drop the ${agency} clearance here`,
    dropHint: "PDF or image – or click to choose",
    accept: PDF_OR_IMAGE,
    uploaders: "staff",
  };
}

function folderSlot(noun: string): SlotDefinition {
  return {
    key: "documents",
    title: "Documents",
    dropLabel: `Drag and drop ${noun} documents here`,
    dropHint: "or click to choose files",
    accept: GENERIC_ACCEPT,
    uploaders: "staff",
  };
}

const PRELIMINARIES: readonly CheckpointDefinition[] = [
  {
    key: "i1_0p",
    number: "1.0",
    stage: "preliminaries",
    title: "Fee proposal",
    description: "Fee proposal ready for client review. Open the document, then approve or decline",
    defaultResponsibility: "client",
    restricted: "fee_proposal",
    panels: [
      {
        type: "approval",
        noun: "fee proposal",
        folder: {
          title: "Fee proposal documents",
          hint: "Upload the fee proposal here for the client to review.",
          slot: folderSlot("fee proposal"),
        },
        yesLabel: "Approve",
        yesPast: "approved",
        confirmLabel: "Confirm approval",
        decisionLabel: "Client decision",
      },
    ],
  },
  {
    key: "i2_0",
    number: "2.0",
    stage: "preliminaries",
    title: "Site Feature Survey",
    description: "Drop the completed feature survey – both the PDF and the DWG are required",
    defaultResponsibility: "kr",
    progressClaim: "Item 1 payment required",
    panels: [
      {
        type: "survey",
        slot: {
          key: "survey",
          title: "Feature survey",
          dropLabel: "Drag and drop the feature survey PDF and DWG here",
          dropHint: "both files are required – or click to choose",
          accept: ["pdf", "dwg"],
          uploaders: "staff",
          showRequirementChip: true,
          requiredKinds: ["pdf", "dwg"],
        },
      },
    ],
  },
];

const WAPC_APPROVAL: readonly CheckpointDefinition[] = [
  {
    key: "i3_0p",
    number: "3.0",
    stage: "wapc-approval",
    title: "WAPC Proposal",
    description:
      "WAPC proposal ready for client review. Please approve or decline the proposal, and download, populate, sign, and return the letter of consent.",
    defaultResponsibility: "client",
    panels: [
      {
        type: "approval",
        noun: "WAPC proposal",
        extraSlot: {
          key: "consent",
          title: "Completed letter of consent",
          dropLabel: "Drag and drop the completed letter of consent here",
          dropHint: "or click to choose a PDF or photo of the signed letter",
          accept: PDF_OR_IMAGE,
          uploaders: "staff_and_client",
        },
        yesLabel: "Approve",
        yesPast: "approved",
        confirmLabel: "Confirm approval",
        decisionLabel: "Client decision",
      },
    ],
  },
  {
    key: "i4_0",
    number: "4.0",
    stage: "wapc-approval",
    title: "WAPC Form 1A application lodged",
    defaultResponsibility: "kr",
    progressClaim: "Item 2 payment required",
    panels: [],
  },
  {
    key: "i4_1",
    number: "4.1",
    stage: "wapc-approval",
    title: "WAPC Application Payment",
    description: "WAPC issue application fee invoice directly to client. Please press INVOICE PAID below, when paid.",
    defaultResponsibility: "client",
    fee: { label: "WAPC Form 1A payment", payer: "client" },
    panels: [{ type: "paid", label: "Client response", buttonLabel: "INVOICE PAID", doneLabel: "Invoice paid" }],
  },
  {
    key: "i4_2",
    number: "4.2",
    stage: "wapc-approval",
    title: "WAPC Application Conformed",
    description:
      "WAPC have 90 days to approve. Drop the Conformance Notification and the outcome date is set automatically",
    defaultResponsibility: "kr",
    panels: [
      {
        type: "conformance",
        slot: {
          key: "conformance",
          title: "Conformance Notification",
          dropLabel: "Drag and drop the Conformance Notification here",
          dropHint: "PDF – the conformed date is taken from the file name, or read from the stamp on page 1",
          accept: PDF_ONLY,
          uploaders: "staff",
        },
      },
    ],
  },
  {
    key: "i4_3",
    number: "4.3",
    stage: "wapc-approval",
    title: "Queries from WAPC",
    description: "Possible queries regarding proposal. Possible deferral to outcome date",
    defaultResponsibility: "kr",
    panels: [
      {
        type: "emails",
        slot: {
          key: "email",
          title: "Query emails",
          dropLabel: "Drop a WAPC query email here",
          dropHint: "Drag an email from Outlook, or click to choose a .msg / .eml file",
          accept: ["email"],
          uploaders: "staff",
        },
      },
    ],
  },
  {
    key: "i5_0",
    number: "5.0",
    stage: "wapc-approval",
    title: "WAPC conditional approval received",
    defaultResponsibility: "kr",
    panels: [
      {
        type: "conditions",
        slot: {
          key: "decision",
          title: "WAPC conditional approval",
          dropLabel: "Drag and drop the WAPC conditional approval PDF here",
          dropHint: "then extract its conditions",
          accept: PDF_ONLY,
          uploaders: "staff",
        },
      },
    ],
  },
];

const WESTERN_POWER: readonly CheckpointDefinition[] = [
  {
    key: "i6_0",
    number: "6.0",
    stage: "western-power",
    title: "Western Power connection application",
    description: "Connection application based on conditions.",
    defaultResponsibility: "kr",
    fee: { label: "WP connection fee", payer: "kr" },
    panels: [],
  },
  {
    key: "i6_1a",
    number: "6.1",
    stage: "western-power",
    title: "Western Power Quote",
    description:
      "Quote received and sent to the client. Open the quote documents, then accept or decline with a comment",
    defaultResponsibility: "client",
    panels: [
      {
        type: "approval",
        noun: "quote",
        folder: {
          title: "Quote documents",
          hint: "Upload the Western Power quote letter, drawings and any other quote documents here.",
          slot: folderSlot("quote"),
        },
        yesLabel: "Accept",
        yesPast: "accepted",
        confirmLabel: "Confirm acceptance",
        decisionLabel: "Client decision",
      },
    ],
  },
  {
    key: "i6_1",
    number: "6.2",
    stage: "western-power",
    title: "Quote acceptance with Western Power",
    description: "Once the client has approved, KR Surveys accepts the quote with Western Power",
    defaultResponsibility: "kr",
    panels: [],
  },
  {
    key: "i6_2",
    number: "6.3",
    stage: "western-power",
    title: "Western Power Invoice Payment",
    description: "Quote invoice paid. This will now progress the application and site works will be scheduled",
    defaultResponsibility: "client",
    fee: { label: "WP quote", payer: "client" },
    panels: [{ type: "paid", label: "Client decision", buttonLabel: "Invoice PAID", doneLabel: "Invoice paid" }],
  },
  {
    key: "i6_4",
    number: "6.4",
    stage: "western-power",
    title: "Western Power Contractor",
    description:
      "Western Power contractor has made contact and requested confirmation the site is ready. Once site has been made ready, boundary pegged, and contractor emailed, please mark as Completed",
    defaultResponsibility: "kr",
    progressClaim: "Item 3 payment required",
    panels: [],
  },
  {
    key: "i6_6",
    number: "6.5",
    stage: "western-power",
    title: "Western Power site work complete",
    description: "Pillar/BGSP install complete. Client to notify KR Surveys when works have been completed",
    defaultResponsibility: "client",
    panels: [{ type: "paid", label: "Client response", buttonLabel: "WORKS COMPLETE", doneLabel: "Works complete" }],
  },
  {
    key: "i6_7",
    number: "6.6",
    stage: "western-power",
    title: "Internal electrical work complete",
    defaultResponsibility: "client",
    fee: { label: "Electrician fees", payer: "client" },
    panels: [
      {
        type: "documents",
        variant: "documents",
        slot: pdfSlot(
          "notice_of_completion",
          "Notice of Completion",
          "Drag and drop the Notice of Completion here",
          "staff_and_client",
        ),
      },
      { type: "paid", label: "Client response", buttonLabel: "WORKS COMPLETE", doneLabel: "Works complete" },
    ],
  },
  {
    key: "i6_8",
    number: "6.7",
    stage: "western-power",
    title: "Submit for clearance",
    description: "All Western Power work is now complete. Submit for clearance",
    defaultResponsibility: "kr",
    panels: [],
  },
  {
    key: "i6_9",
    number: "6.8",
    stage: "western-power",
    title: "Western Power clearance received",
    description: "Drop both the clearance PDF and the clearance email saved as a PDF",
    defaultResponsibility: "kr",
    panels: [
      {
        type: "slots",
        title: "Western Power clearance",
        slots: [
          {
            ...pdfSlot("clr", "Clearance PDF", "Drag and drop the Western Power clearance PDF here"),
            showRequirementChip: true,
          },
          {
            ...pdfSlot(
              "clremail",
              "Clearance email (as PDF)",
              "Drag and drop the clearance email, saved as a PDF, here",
            ),
            showRequirementChip: true,
          },
        ],
      },
    ],
  },
];

const WATER_CORPORATION: readonly CheckpointDefinition[] = [
  {
    key: "i7_0",
    number: "7.0",
    stage: "water-corporation",
    title: "Water Corporation agreement request",
    description: "Land Agreement request lodged online",
    defaultResponsibility: "kr",
    panels: [],
  },
  {
    key: "i7_1",
    number: "7.1",
    stage: "water-corporation",
    title: "Water Corporation agreement received",
    description:
      "Agreement kept on file until clearance required. Agreement populated and accompanies clearance documents.",
    defaultResponsibility: "kr",
    panels: [
      {
        type: "documents",
        variant: "documents",
        slot: pdfSlot(
          "documents",
          "Water Corporation Agreement",
          "Drag and drop the Water Corporation Agreement PDF here",
        ),
      },
    ],
  },
  {
    key: "i7_2",
    number: "7.2",
    stage: "water-corporation",
    title: "Sewer junction cut-in",
    description: "Obtain 3 quotes for sewer junction cut-in (freehold subdivision only)",
    defaultResponsibility: "client",
    fee: { label: "Plumber fees", payer: "client" },
    panels: [],
  },
  {
    key: "i7_3",
    number: "7.3",
    stage: "water-corporation",
    title: "Sewer junction cut-in complete",
    description: "Works complete by plumber and COC and flimsy received",
    defaultResponsibility: "client",
    panels: [
      {
        type: "slots",
        title: "Plumber documents",
        slots: [
          {
            key: "coc",
            title: "Certificate of Completion",
            dropLabel: "Drag and drop the Certificate of Completion here",
            dropHint: "PDF or photo – or click to choose",
            accept: PDF_OR_IMAGE,
            uploaders: "staff_and_client",
            showRequirementChip: true,
          },
          {
            key: "ascon",
            title: "As-Con / Flimsy",
            dropLabel: "Drag and drop the As-Con / Flimsy here",
            dropHint: "PDF or photo – or click to choose",
            accept: PDF_OR_IMAGE,
            uploaders: "staff_and_client",
            showRequirementChip: true,
          },
        ],
      },
    ],
  },
  {
    key: "i7_4",
    number: "7.4",
    stage: "water-corporation",
    title: "Submit for clearance",
    defaultResponsibility: "kr",
    panels: [],
  },
  {
    key: "i7_5",
    number: "7.5",
    stage: "water-corporation",
    title: "Water Corporation Invoice Payment",
    defaultResponsibility: "client",
    fee: { label: "Water Corporation invoice", payer: "client" },
    panels: [{ type: "paid", label: "Client response", buttonLabel: "Invoice PAID", doneLabel: "Invoice paid" }],
  },
  {
    key: "i7_6",
    number: "7.6",
    stage: "water-corporation",
    title: "Water Corporation clearance received",
    defaultResponsibility: "kr",
    panels: [{ type: "clearance", agency: "Water Corporation", slot: clearanceSlot("Water Corporation") }],
  },
];

const LOCAL_GOVERNMENT: readonly CheckpointDefinition[] = [
  {
    key: "i8_2",
    number: "8.0",
    stage: "local-government",
    title: "Submit for clearance",
    defaultResponsibility: "kr",
    fee: { label: "Local Gov. clearance fee", payer: "kr" },
    panels: [],
  },
  {
    key: "i8_3",
    number: "8.1",
    stage: "local-government",
    title: "Additional Council Payments",
    description: "This may include development contributions or similar.",
    defaultResponsibility: "client",
    fee: { label: "Other Local Gov. fees", payer: "client" },
    panels: [
      {
        type: "kr_note",
        label: "KR Surveys comment – what the client needs to pay",
        placeholder: "e.g. Development contribution of $X payable to the Shire – invoice attached",
      },
      { type: "paid", label: "Client response", buttonLabel: "FEE PAID", doneLabel: "Fee paid" },
    ],
  },
  {
    key: "i8_4",
    number: "8.2",
    stage: "local-government",
    title: "Local Government clearance received",
    defaultResponsibility: "kr",
    panels: [{ type: "clearance", agency: "Local Government", slot: clearanceSlot("Local Government") }],
  },
];

const BUSSELTON_WATER: readonly CheckpointDefinition[] = [
  {
    key: "i9_0",
    number: "9.0",
    stage: "busselton-water",
    title: "Busselton Water – request for quotation",
    description: "Submit request for quotation on website",
    defaultResponsibility: "kr",
    panels: [],
  },
  {
    key: "i9_1",
    number: "9.1",
    stage: "busselton-water",
    title: "Quotation received",
    description: "Client to review quote and advise if they agree with the quote.",
    defaultResponsibility: "client",
    panels: [
      {
        type: "approval",
        noun: "quote",
        yesLabel: "Accept",
        yesPast: "accepted",
        confirmLabel: "Confirm acceptance",
        decisionLabel: "Client response",
      },
    ],
  },
  {
    key: "i9_2",
    number: "9.2",
    stage: "busselton-water",
    title: "Quotation paid",
    description: "Quotation paid and email sent to Busselton Water",
    defaultResponsibility: "client",
    fee: { label: "Busselton Water fees", payer: "client" },
    panels: [{ type: "paid", label: "Client response", buttonLabel: "QUOTE PAID", doneLabel: "Quote paid" }],
  },
  {
    key: "i9_3",
    number: "9.3",
    stage: "busselton-water",
    title: "Submit for clearance",
    defaultResponsibility: "kr",
    panels: [],
  },
  {
    key: "i9_4",
    number: "9.4",
    stage: "busselton-water",
    title: "Busselton Water clearance received",
    defaultResponsibility: "kr",
    panels: [{ type: "clearance", agency: "Busselton Water", slot: clearanceSlot("Busselton Water") }],
  },
];

const WAPC: readonly CheckpointDefinition[] = [
  {
    key: "i12_0",
    number: "10.0",
    stage: "wapc",
    title: "All other agency clearances obtained",
    defaultResponsibility: "kr",
    panels: [],
  },
  {
    key: "i12_1",
    number: "10.1",
    stage: "wapc",
    title: "Submit Form 1C (WAPC clearance)",
    defaultResponsibility: "kr",
    panels: [],
  },
  {
    key: "i12_2",
    number: "10.2",
    stage: "wapc",
    title: "Form 1C Payment",
    defaultResponsibility: "kr",
    fee: { label: "Form 1C fees", payer: "kr" },
    panels: [],
  },
  {
    key: "i12_3",
    number: "10.3",
    stage: "wapc",
    title: "Plan endorsed and sent to Landgate",
    defaultResponsibility: "kr",
    panels: [],
  },
];

const SURVEY: readonly CheckpointDefinition[] = [
  {
    key: "i11_0",
    number: "11.0",
    stage: "survey",
    title: "Surround Survey & Western Power set-out",
    defaultResponsibility: "kr",
    panels: [
      {
        type: "documents",
        variant: "photos",
        slot: {
          key: "photos",
          title: "Western Power set-out photos",
          dropLabel: "Drag and drop the Western Power set-out photos here",
          dropHint: "JPG, PNG or WebP photos – drop several at once, or click to choose",
          accept: ["image"],
          uploaders: "staff",
        },
      },
    ],
  },
  {
    key: "i11_draft",
    number: "11.1",
    stage: "survey",
    title: "Draft Strata/Deposited Plan",
    description: "Draft plan to be used for all clearance applications",
    defaultResponsibility: "kr",
    panels: [
      {
        type: "documents",
        variant: "documents",
        slot: pdfSlot("documents", "Draft Strata Plan", "Drag and drop the Draft Strata Plan (PDF) here"),
      },
    ],
  },
  {
    key: "i11_1",
    number: "11.2",
    stage: "survey",
    title: "Final Boundary Establishment",
    description: "Physical placement of final boundary pegs",
    defaultResponsibility: "kr",
    panels: [],
  },
  {
    key: "i11_2",
    number: "11.3",
    stage: "survey",
    title: "Unit Entitlement",
    description: "Obtain unit entitlement for strata development",
    defaultResponsibility: "kr",
    fee: { label: "Unit entitlement cost", payer: "kr" },
    panels: [
      {
        type: "documents",
        variant: "documents",
        slot: pdfSlot("documents", "Unit Entitlement", "Drag and drop the Unit Entitlement (PDF) here"),
      },
    ],
  },
  {
    key: "i11_3",
    number: "11.4",
    stage: "survey",
    title: "Finalise Plan and Field Book",
    description: "Finalise plan and field book, ready for lodgement at Landgate",
    defaultResponsibility: "kr",
    panels: [],
  },
];

const LANDGATE: readonly CheckpointDefinition[] = [
  {
    key: "i13_0",
    number: "12.0",
    stage: "landgate",
    title: "Plan lodged at Landgate",
    defaultResponsibility: "kr",
    fee: { label: "Lodgement fees", payer: "kr" },
    panels: [
      {
        type: "documents",
        variant: "documents",
        slot: pdfSlot("documents", "Final Strata Plan", "Drag and drop the final Strata Plan (PDF) here"),
      },
    ],
  },
  {
    key: "i13_1",
    number: "12.1",
    stage: "landgate",
    title: "Field book lodged at Landgate",
    defaultResponsibility: "kr",
    panels: [
      {
        type: "documents",
        variant: "documents",
        slot: pdfSlot("documents", "Field Book", "Drag and drop the Field Book (PDF) here"),
      },
    ],
  },
  {
    key: "i13_notif",
    number: "12.2",
    stage: "landgate",
    title: "Notification and Documents",
    description: "Upload any notifications or documents required for titles.",
    defaultResponsibility: "kr",
    panels: [
      {
        type: "documents",
        variant: "documents",
        slot: {
          key: "documents",
          title: "Notifications and documents",
          dropLabel: "Drag and drop any notifications or documents required for titles here",
          dropHint: "PDF, photo or text file – drop several at once, or click to choose",
          accept: GENERIC_ACCEPT,
          uploaders: "staff",
        },
      },
    ],
  },
  {
    key: "i13_2",
    number: "12.3",
    stage: "landgate",
    title: "Plan in order for dealings",
    defaultResponsibility: "kr",
    progressClaim: "Item 4 payment required",
    panels: [],
  },
];

const TITLES: readonly CheckpointDefinition[] = [
  {
    key: "i14_0",
    number: "13.0",
    stage: "titles",
    title: "Settlement Agent",
    description: "Settlement Agent to obtain titles of new lots.",
    defaultResponsibility: "client",
    panels: [{ type: "paid", label: "Client response", buttonLabel: "TITLES OBTAINED", doneLabel: "Titles obtained" }],
  },
];

export const STAGES: readonly StageDefinition[] = [
  {
    key: "preliminaries",
    name: "Preliminaries",
    optional: false,
    phase: "sequential-before",
    checkpoints: PRELIMINARIES,
  },
  {
    key: "wapc-approval",
    name: "WAPC Approval",
    optional: false,
    phase: "sequential-before",
    checkpoints: WAPC_APPROVAL,
    outcomeBoxAfter: "i4_2",
  },
  {
    key: "western-power",
    name: "Western Power",
    agency: "Western Power",
    optional: true,
    phase: "agencies",
    checkpoints: WESTERN_POWER,
  },
  {
    key: "water-corporation",
    name: "Water Corporation",
    agency: "Water Corporation",
    optional: true,
    phase: "agencies",
    checkpoints: WATER_CORPORATION,
  },
  {
    key: "local-government",
    name: "Local Government",
    agency: "Local Government",
    optional: true,
    phase: "agencies",
    checkpoints: LOCAL_GOVERNMENT,
  },
  {
    key: "busselton-water",
    name: "Busselton Water",
    agency: "Busselton Water",
    optional: true,
    phase: "agencies",
    checkpoints: BUSSELTON_WATER,
  },
  { key: "wapc", name: "WAPC", agency: "WAPC", optional: false, phase: "sequential-after", checkpoints: WAPC },
  { key: "survey", name: "Survey", optional: false, phase: "sequential-after", checkpoints: SURVEY },
  { key: "landgate", name: "Landgate", optional: false, phase: "sequential-after", checkpoints: LANDGATE },
  { key: "titles", name: "Titles", optional: false, phase: "sequential-after", checkpoints: TITLES },
];

/** All 46 checkpoints in display order. */
export const CHECKPOINTS: readonly CheckpointDefinition[] = STAGES.flatMap((s) => s.checkpoints);

export const CHECKPOINT_KEYS = CHECKPOINTS.map((c) => c.key);

/** Checkpoint that marks a job complete (12.3 Plan in order for dealings). */
export const JOB_COMPLETE_CHECKPOINT_KEY = "i13_2";
/** Checkpoint whose status gates the "WAPC outcome date" alert (5.0 WAPC conditional approval received). */
export const CONDITIONAL_APPROVAL_CHECKPOINT_KEY = "i5_0";
/** Checkpoint that holds the Conformance Notification (4.2). */
export const CONFORMANCE_CHECKPOINT_KEY = "i4_2";
/** Checkpoint that holds the WAPC query emails (4.3). */
export const EMAILS_CHECKPOINT_KEY = "i4_3";
/** Number of days WAPC has to decide after conformance. */
export const WAPC_DECISION_DAYS = 90;

const byKey = new Map(CHECKPOINTS.map((c) => [c.key, c] as const));
const stageByKey = new Map(STAGES.map((s) => [s.key, s] as const));

export function isCheckpointKey(key: string): boolean {
  return byKey.has(key);
}

export function getCheckpoint(key: string): CheckpointDefinition {
  const c = byKey.get(key);
  if (!c) throw new RangeError(`Unknown checkpoint key: ${key}`);
  return c;
}

export function getStage(key: StageKey): StageDefinition {
  const s = stageByKey.get(key);
  if (!s) throw new RangeError(`Unknown stage key: ${key}`);
  return s;
}

/** All slots declared by a checkpoint's panels, in render order. */
export function slotsOf(checkpoint: CheckpointDefinition): readonly SlotDefinition[] {
  const out: SlotDefinition[] = [];
  for (const p of checkpoint.panels) {
    switch (p.type) {
      case "approval":
        if (p.folder) out.push(p.folder.slot);
        if (p.extraSlot) out.push(p.extraSlot);
        break;
      case "slots":
        out.push(...p.slots);
        break;
      case "documents":
      case "clearance":
      case "survey":
      case "conformance":
      case "emails":
      case "conditions":
        out.push(p.slot);
        break;
      case "paid":
      case "kr_note":
        break;
    }
  }
  return out;
}

export function findSlot(checkpointKey: string, slotKey: string): SlotDefinition | undefined {
  return slotsOf(getCheckpoint(checkpointKey)).find((s) => s.key === slotKey);
}

export function hasPanel(
  checkpoint: CheckpointDefinition,
  type: CheckpointDefinition["panels"][number]["type"],
): boolean {
  return checkpoint.panels.some((p) => p.type === type);
}
