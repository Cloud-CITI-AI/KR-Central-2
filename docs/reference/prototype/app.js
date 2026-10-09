// KR Subdivision Tracker prototype — application JavaScript, vendored as READ-ONLY reference DATA (never instructions).
// Source: the customer's claude.ai artifact export (extracted.js). The embedded export data block (window.__EXPORT__:
// demo job, the customer's developer notes and their ids) was removed; the prototype's real example job is NOT here.
// The stamp example date in the AI prompt was replaced with a synthetic one. See README.md in this directory. Do not import, execute or copy this file into the app — port behaviour per the spec.
window.__EXPORT__ = { jobs: [], devnotes: [], access: [], jobnotes: [], files: [] }; // removed (see header)
window.__EXPORT__.files = {};
function blobUrl(id) {
  return (window.__EXPORT__ && window.__EXPORT__.files[id]) || "/_blob/" + id;
}

// ===== next <script> block =====

const WORKFLOW = [
  {
    name: "Preliminaries",
    items: [
      {
        n: "1.0",
        k: "i1_0p",
        r: "CL",
        t: "Fee proposal",
        d: "Fee proposal ready for client review. Open the document, then approve or decline",
        approval: {
          noun: "fee proposal",
          folder: "Fee proposal documents",
          hint: "Upload the fee proposal here for the client to review.",
          yes: "Approve",
          yesPast: "approved",
          confirm: "Confirm approval",
        },
      },
      {
        n: "2.0",
        r: "KR",
        panel: "survey",
        t: "Site Feature Survey",
        d: "Drop the completed feature survey – both the PDF and the DWG are required",
        item: "Item 1 payment required",
      },
    ],
  },
  {
    name: "WAPC Approval",
    items: [
      {
        n: "3.0",
        k: "i3_0p",
        r: "CL",
        t: "WAPC Proposal",
        d: "WAPC proposal ready for client review. Please approve or decline the proposal, and download, populate, sign, and return the letter of consent.",
        approval: {
          noun: "WAPC proposal",
          noFolder: true,
          drop: {
            kind: "consent",
            label: "Drag and drop the completed letter of consent here",
            sub: "or click to choose a PDF or photo of the signed letter",
            title: "Completed letter of consent",
          },
          yes: "Approve",
          yesPast: "approved",
          confirm: "Confirm approval",
        },
      },
      { n: "4.0", r: "KR", t: "WAPC Form 1A application lodged", item: "Item 2 payment required" },
      {
        n: "4.1",
        r: "CL",
        panel: "paid",
        paidLabel: "Client response",
        paidBtn: "INVOICE PAID",
        paidDone: "Invoice paid",
        t: "WAPC Application Payment",
        d: "WAPC issue application fee invoice directly to client. Please press INVOICE PAID below, when paid.",
        fee: "WAPC Form 1A payment",
      },
      {
        n: "4.2",
        r: "KR",
        panel: "conform",
        t: "WAPC Application Conformed",
        d: "WAPC have 90 days to approve. Drop the Conformance Notification and the outcome date is set automatically",
      },
      { box: "outcome" },
      {
        n: "4.3",
        r: "KR",
        panel: "emails",
        t: "Queries from WAPC",
        d: "Possible queries regarding proposal. Possible deferral to outcome date",
      },
      { n: "5.0", r: "KR", panel: "conds", t: "WAPC conditional approval received" },
    ],
  },
  {
    name: "Western Power",
    items: [
      {
        n: "6.0",
        r: "KR",
        t: "Western Power connection application",
        d: "Connection application based on conditions.",
        fee: "WP connection fee",
        payer: "KR",
      },
      {
        n: "6.1",
        k: "i6_1a",
        r: "CL",
        approval: {
          noun: "quote",
          folder: "Quote documents",
          hint: "Upload the Western Power quote letter, drawings and any other quote documents here.",
          yes: "Accept",
          yesPast: "accepted",
          confirm: "Confirm acceptance",
        },
        t: "Western Power Quote",
        d: "Quote received and sent to the client. Open the quote documents, then accept or decline with a comment",
      },
      {
        n: "6.2",
        k: "i6_1",
        r: "KR",
        t: "Quote acceptance with Western Power",
        d: "Once the client has approved, KR Surveys accepts the quote with Western Power",
      },
      {
        n: "6.3",
        k: "i6_2",
        r: "CL",
        panel: "paid",
        t: "Western Power Invoice Payment",
        d: "Quote invoice paid. This will now progress the application and site works will be scheduled",
        fee: "WP quote",
      },
      {
        n: "6.4",
        k: "i6_4",
        r: "KR",
        t: "Western Power Contractor",
        d: "Western Power contractor has made contact and requested confirmation the site is ready. Once site has been made ready, boundary pegged, and contractor emailed, please mark as Completed",
        item: "Item 3 payment required",
      },
      {
        n: "6.5",
        k: "i6_6",
        r: "CL",
        panel: "paid",
        paidLabel: "Client response",
        paidBtn: "WORKS COMPLETE",
        paidDone: "Works complete",
        t: "Western Power site work complete",
        d: "Pillar/BGSP install complete. Client to notify KR Surveys when works have been completed",
      },
      {
        n: "6.6",
        k: "i6_7",
        r: "CL",
        panel: "paid",
        paidLabel: "Client response",
        paidBtn: "WORKS COMPLETE",
        paidDone: "Works complete",
        extraDrop: { title: "Notice of Completion", label: "Drag and drop the Notice of Completion here" },
        t: "Internal electrical work complete",
        fee: "Electrician fees",
      },
      {
        n: "6.7",
        k: "i6_8",
        r: "KR",
        t: "Submit for clearance",
        d: "All Western Power work is now complete. Submit for clearance",
      },
      {
        n: "6.8",
        k: "i6_9",
        r: "KR",
        panel: "clearance",
        agency: "Western Power",
        t: "Western Power clearance received",
        d: "Drop both the clearance PDF and the clearance email saved as a PDF",
        slots: [
          { kind: "clr", label: "Clearance PDF", drop: "Drag and drop the Western Power clearance PDF here" },
          {
            kind: "clremail",
            label: "Clearance email (as PDF)",
            drop: "Drag and drop the clearance email, saved as a PDF, here",
          },
        ],
      },
    ],
  },
  {
    name: "Water Corporation",
    items: [
      { n: "7.0", r: "KR", t: "Water Corporation agreement request", d: "Land Agreement request lodged online" },
      {
        n: "7.1",
        r: "KR",
        panel: "drop",
        dropTitle: "Water Corporation Agreement",
        dropLabel: "Drag and drop the Water Corporation Agreement PDF here",
        t: "Water Corporation agreement received",
        d: "Agreement kept on file until clearance required. Agreement populated and accompanies clearance documents.",
      },
      {
        n: "7.2",
        r: "CL",
        t: "Sewer junction cut-in",
        d: "Obtain 3 quotes for sewer junction cut-in (freehold subdivision only)",
        fee: "Plumber fees",
      },
      {
        n: "7.3",
        r: "CL",
        panel: "slots",
        slotsTitle: "Plumber documents",
        slots: [
          {
            kind: "coc",
            label: "Certificate of Completion",
            drop: "Drag and drop the Certificate of Completion here",
            images: true,
          },
          { kind: "ascon", label: "As-Con / Flimsy", drop: "Drag and drop the As-Con / Flimsy here", images: true },
        ],
        t: "Sewer junction cut-in complete",
        d: "Works complete by plumber and COC and flimsy received",
      },
      { n: "7.4", r: "KR", t: "Submit for clearance" },
      {
        n: "7.5",
        r: "CL",
        panel: "paid",
        paidLabel: "Client response",
        t: "Water Corporation Invoice Payment",
        fee: "Water Corporation invoice",
      },
      { n: "7.6", r: "KR", panel: "clearance", agency: "Water Corporation", t: "Water Corporation clearance received" },
    ],
  },
  {
    name: "Local Government",
    items: [
      { n: "8.0", k: "i8_2", r: "KR", t: "Submit for clearance", fee: "Local Gov. clearance fee", payer: "KR" },
      {
        n: "8.1",
        k: "i8_3",
        r: "CL",
        krNote: "KR Surveys comment – what the client needs to pay",
        panel: "paid",
        paidLabel: "Client response",
        paidBtn: "FEE PAID",
        paidDone: "Fee paid",
        t: "Additional Council Payments",
        d: "This may include development contributions or similar.",
        fee: "Other Local Gov. fees",
      },
      {
        n: "8.2",
        k: "i8_4",
        r: "KR",
        panel: "clearance",
        agency: "Local Government",
        t: "Local Government clearance received",
      },
    ],
  },
  {
    name: "Busselton Water",
    items: [
      { n: "9.0", r: "KR", t: "Busselton Water – request for quotation", d: "Submit request for quotation on website" },
      {
        n: "9.1",
        r: "CL",
        t: "Quotation received",
        d: "Client to review quote and advise if they agree with the quote.",
        approval: {
          noun: "quote",
          noFolder: true,
          label: "Client response",
          yes: "Accept",
          yesPast: "accepted",
          confirm: "Confirm acceptance",
        },
      },
      {
        n: "9.2",
        r: "CL",
        panel: "paid",
        paidLabel: "Client response",
        paidBtn: "QUOTE PAID",
        paidDone: "Quote paid",
        t: "Quotation paid",
        d: "Quotation paid and email sent to Busselton Water",
        fee: "Busselton Water fees",
      },
      { n: "9.3", r: "KR", t: "Submit for clearance" },
      { n: "9.4", r: "KR", panel: "clearance", agency: "Busselton Water", t: "Busselton Water clearance received" },
    ],
  },
  {
    name: "WAPC",
    items: [
      { n: "10.0", k: "i12_0", r: "KR", t: "All other agency clearances obtained" },
      { n: "10.1", k: "i12_1", r: "KR", t: "Submit Form 1C (WAPC clearance)" },
      { n: "10.2", k: "i12_2", r: "KR", t: "Form 1C Payment", fee: "Form 1C fees", payer: "KR" },
      { n: "10.3", k: "i12_3", r: "KR", t: "Plan endorsed and sent to Landgate" },
    ],
  },
  {
    name: "Survey",
    items: [
      {
        n: "11.0",
        r: "KR",
        panel: "photos",
        dropTitle: "Western Power set-out photos",
        dropLabel: "Drag and drop the Western Power set-out photos here",
        t: "Surround Survey & Western Power set-out",
      },
      {
        n: "11.1",
        k: "i11_draft",
        r: "KR",
        panel: "drop",
        dropTitle: "Draft Strata Plan",
        dropLabel: "Drag and drop the Draft Strata Plan (PDF) here",
        t: "Draft Strata/Deposited Plan",
        d: "Draft plan to be used for all clearance applications",
      },
      {
        n: "11.2",
        k: "i11_1",
        r: "KR",
        t: "Final Boundary Establishment",
        d: "Physical placement of final boundary pegs",
      },
      {
        n: "11.3",
        k: "i11_2",
        r: "KR",
        panel: "drop",
        dropTitle: "Unit Entitlement",
        dropLabel: "Drag and drop the Unit Entitlement (PDF) here",
        t: "Unit Entitlement",
        d: "Obtain unit entitlement for strata development",
        fee: "Unit entitlement cost",
        payer: "KR",
      },
      {
        n: "11.4",
        k: "i11_3",
        r: "KR",
        t: "Finalise Plan and Field Book",
        d: "Finalise plan and field book, ready for lodgement at Landgate",
      },
    ],
  },
  {
    name: "Landgate",
    items: [
      {
        n: "12.0",
        k: "i13_0",
        r: "KR",
        panel: "drop",
        dropTitle: "Final Strata Plan",
        dropLabel: "Drag and drop the final Strata Plan (PDF) here",
        t: "Plan lodged at Landgate",
        fee: "Lodgement fees",
        payer: "KR",
      },
      {
        n: "12.1",
        k: "i13_1",
        r: "KR",
        panel: "drop",
        dropTitle: "Field Book",
        dropLabel: "Drag and drop the Field Book (PDF) here",
        t: "Field book lodged at Landgate",
      },
      {
        n: "12.2",
        k: "i13_notif",
        r: "KR",
        panel: "drop",
        dropTitle: "Notifications and documents",
        dropLabel: "Drag and drop any notifications or documents required for titles here",
        dropAccept: "any",
        t: "Notification and Documents",
        d: "Upload any notifications or documents required for titles.",
      },
      { n: "12.3", k: "i13_2", r: "KR", t: "Plan in order for dealings", item: "Item 4 payment required" },
    ],
  },
  {
    name: "Titles",
    items: [
      {
        n: "13.0",
        k: "i14_0",
        r: "CL",
        panel: "paid",
        paidLabel: "Client response",
        paidBtn: "TITLES OBTAINED",
        paidDone: "Titles obtained",
        t: "Settlement Agent",
        d: "Settlement Agent to obtain titles of new lots.",
      },
    ],
  },
];
const RESP = [
  ["", "Unassigned"],
  ["KR", "KR Surveys"],
  ["CL", "Client"],
  ["AR", "Architect"],
];
const STATUS = [
  ["c", "Completed"],
  ["n", "Not completed"],
  ["x", "Not required"],
];
const STATUS_LABEL = { c: "Completed", n: "Not completed", x: "Not required" };
const key = (i) => i.k || "i" + i.n.replace(".", "_");
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const ALL = WORKFLOW.flatMap((s) => s.items.filter((i) => i.n));
const DEF_R = Object.fromEntries(ALL.map((i) => [key(i), i.r || ""]));

let downloads = null;
let db = null,
  assets = null,
  readOnly = false,
  localMode = false;
let jobs = []; // [{id, data}]
let currentId = null;
try {
  currentId = localStorage.getItem("kr-wf-job");
} catch (e) {}
const uploading = {}; // itemKey -> message
const confirmRm = {}; // itemKey|assetId -> true
const errors = {};

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};

let openStages = new Set();
try {
  openStages = new Set(JSON.parse(localStorage.getItem("kr-wf-open") || "[]"));
} catch (e) {}
function saveOpen() {
  try {
    localStorage.setItem("kr-wf-open", JSON.stringify([...openStages]));
  } catch (e) {}
}
function toggleStage(id, force) {
  const open = force ?? !openStages.has(id);
  if (open) openStages.add(id);
  else openStages.delete(id);
  saveOpen();
  render();
}
// links such as "Go to Western Power ↓" open the stage they point at
document.addEventListener("click", (e) => {
  const a = e.target.closest?.('a[href^="#"]');
  if (!a) return;
  const id = a.getAttribute("href").slice(1),
    sec = document.getElementById(id);
  if (!sec || !sec.classList.contains("stage")) return;
  e.preventDefault();
  if (!openStages.has(id)) toggleStage(id, true);
  document
    .getElementById(id)
    ?.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
});
function job() {
  return jobs.find((j) => j.id === currentId) || null;
}
const OPTIONAL_AGENCIES = ["Western Power", "Water Corporation", "Local Government", "Busselton Water"];
const SECTION_OF = {};
WORKFLOW.forEach((s) =>
  s.items.forEach((i) => {
    if (i.n) SECTION_OF[key(i)] = s.name;
  }),
);
function agencyExcluded(name, j = job()) {
  const list = j?.data?.conds?.list;
  return OPTIONAL_AGENCIES.includes(name) && Array.isArray(list) && list.length > 0 && !list.some((c) => c.a === name);
}
function itemState(k, j = job()) {
  const it = j?.data?.items?.[k] || {};
  const off = agencyExcluded(SECTION_OF[k], j);
  return {
    krnote: it.krnote || "",
    paid: it.paid || null,
    s: off ? "x" : it.s || "n",
    r: "r" in it ? it.r : DEF_R[k] || "",
    docs: Array.isArray(it.docs) ? it.docs : [],
    dec: it.dec || null,
  };
}

// ---------- writes (one at a time per job document) ----------
let writeChain = Promise.resolve();
function patchItem(k, patch) {
  const j = job();
  if (!j) return;
  // optimistic local merge
  const items = { ...(j.data.items || {}) };
  items[k] = { ...(items[k] || {}), ...patch };
  j.data = { ...j.data, items, updatedAt: new Date().toISOString() };
  render();
  if (localMode) return;
  const id = j.id;
  writeChain = writeChain
    .then(() => db.doc("jobs/" + id).update({ items: { [k]: patch }, updatedAt: new Date().toISOString() }))
    .catch((e) => {
      if (e && e.code === "invalid_argument") {
        readOnly = true;
        showBanner("You have view-only access to this tracker, so changes can’t be saved.");
      } else showBanner("A change couldn’t be saved (" + (e?.code || "error") + "). Reload the page and try again.");
      render();
    });
}

function showBanner(t) {
  const b = $("#banner");
  b.textContent = t;
  b.hidden = !t;
}

// ---------- rendering ----------
const DONE_KEY = "i13_2"; // 12.3 Plan in order for dealings
const jobText = (d) =>
  [d.num || "Job", d.addr, d.client].filter(Boolean).join(" – ") + (d.type ? " (" + d.type + ")" : "");
function renderJobs() {
  const sel = $("#jobSel");
  sel.replaceChildren();
  if (!jobs.length) sel.append(el("option", { value: "" }, "No jobs loaded yet"));
  const byNum = (a, b) =>
    String(a.data.num || "").localeCompare(String(b.data.num || ""), undefined, { numeric: true });
  // a job is only complete once 12.2 Plan in order for dealings is marked Completed
  const done = (j) => j.data.items?.[DONE_KEY]?.s === "c",
    real = (j) => !!j.data.source;
  const groups = [
    ["In progress", (j) => real(j) && !done(j)],
    ["Complete", (j) => real(j) && done(j)],
    ["Other", () => true],
  ];
  const left = new Set(jobs),
    ordered = [];
  for (const [label, test] of groups) {
    const list = [...left].filter(test).sort(byNum);
    if (!list.length) continue;
    list.forEach((j) => left.delete(j));
    ordered.push(...list);
    sel.append(
      el(
        "optgroup",
        { label: `${label} (${list.length})` },
        list.map((j) => el("option", { value: j.id }, jobText(j.data))),
      ),
    );
  }
  if (!job() && ordered.length) currentId = ordered[0].id;
  sel.value = currentId || "";
}

// Never rebuild the page under someone typing in a comment box – it moves the cursor.
// Saves still go through; the redraw waits until they leave the box.
let pendingRender = false;
const typingInBox = () => {
  const t = document.activeElement;
  return !!(t && t.tagName === "TEXTAREA" && t.isConnected);
};
let pointerDown = false;
addEventListener(
  "pointerdown",
  () => {
    pointerDown = true;
  },
  true,
);
addEventListener(
  "pointerup",
  () => {
    setTimeout(() => {
      pointerDown = false;
    }, 0);
  },
  true,
);
addEventListener(
  "pointercancel",
  () => {
    pointerDown = false;
  },
  true,
);
document.addEventListener("focusout", (e) => {
  if (e.target?.tagName !== "TEXTAREA") return;
  // wait until any click that took focus away has landed, so buttons are not rebuilt mid-click
  const go = () => {
    if (pointerDown) return setTimeout(go, 30);
    if (pendingRender && !typingInBox()) {
      pendingRender = false;
      render();
    }
  };
  setTimeout(go, 0);
});
function render() {
  if (typingInBox()) {
    pendingRender = true;
    return;
  }
  const ae = document.activeElement,
    fid = ae && ae.id,
    sel = fid && "selectionStart" in ae ? [ae.selectionStart, ae.selectionEnd] : null;
  renderInner();
  if (fid && document.activeElement !== document.getElementById(fid)) {
    const n = document.getElementById(fid);
    if (n) {
      n.focus({ preventScroll: true });
      if (sel)
        try {
          n.setSelectionRange(sel[0], sel[1]);
        } catch (e) {}
    }
  }
}
function renderInner() {
  renderJobs();
  const j = job();

  // totals
  let c = 0,
    x = 0,
    n = 0;
  for (const i of ALL) {
    const s = itemState(key(i)).s;
    if (s === "c") c++;
    else if (s === "x") x++;
    else n++;
  }
  const tot = ALL.length;
  const pc = Math.round(((c + x) / tot) * 100);
  $("#pct").textContent = pc + "%";
  $("#pct").style.setProperty("--pc", pc);
  const [g, gx, gn] = $("#bar").children;
  g.style.width = (c / tot) * 100 + "%";
  gx.style.width = (x / tot) * 100 + "%";
  gn.style.width = (n / tot) * 100 + "%";
  $("#bar").setAttribute("aria-label", `${c} completed, ${x} not required, ${n} not completed of ${tot}`);
  $("#counts").replaceChildren(
    el("span", { class: "cnt c" }, el("b", {}, String(c)), "Completed"),
    el("span", { class: "cnt n" }, el("b", {}, String(n)), "Not completed"),
    el("span", { class: "cnt x" }, el("b", {}, String(x)), "Not required"),
  );
  renderApproval(j, !!j && !readOnly);

  // stages – collapsed bars, expand on click
  const canEdit = !!j && !readOnly;
  $("#stages").replaceChildren(
    ...WORKFLOW.map((s) => {
      const id = slug(s.name),
        its = s.items.filter((i) => i.n);
      let c = 0,
        x = 0;
      for (const i of its) {
        const v = itemState(key(i)).s;
        if (v === "c") c++;
        else if (v === "x") x++;
      }
      const n = its.length - c - x;
      const state = n ? "n" : c ? "c" : "x";
      const pct = Math.round(((c + x) / its.length) * 100);
      const off = agencyExcluded(s.name);
      const open = !off && openStages.has(id);
      const body = off
        ? null
        : el(
            "div",
            { class: "stage-body", id: "body-" + id, hidden: !open },
            AGENCIES.includes(s.name) ? topEvidence(s.name, canEdit) : null,
            el(
              "div",
              { class: "items" },
              s.items.map((i) =>
                i.note
                  ? el("div", { class: "note" }, i.note)
                  : i.box === "outcome"
                    ? outcomeBox(canEdit)
                    : card(i, canEdit),
              ),
            ),
          );
      return el(
        "section",
        { class: "stage", id },
        off
          ? el(
              "div",
              { class: "stage-bar off", "data-s": "x", title: "The Decision Letter has no conditions for " + s.name },
              el("span", { class: "chev", "aria-hidden": "true" }),
              el("span", { class: "sb-name" }, s.name),
              el(
                "span",
                { class: "sb-meta" },
                el("span", { class: "sb-count" }, "Not required – no conditions in the Decision Letter"),
              ),
            )
          : el(
              "button",
              {
                type: "button",
                class: "stage-bar",
                "data-s": state,
                "aria-expanded": String(open),
                "aria-controls": "body-" + id,
                onclick: () => toggleStage(id),
              },
              el("span", { class: "chev", "aria-hidden": "true" }),
              el("span", { class: "sb-name" }, s.name),
              el(
                "span",
                { class: "sb-meta" },
                el("span", { class: "sb-count" }, n ? `${n} to do` : state === "c" ? "Complete" : "Not required"),
                el("span", { class: "sb-track", "aria-hidden": "true" }, el("i", { style: `width:${pct}%` })),
                el("b", { class: "sb-pct" }, pct + "%"),
              ),
            ),
        body,
      );
    }),
  );
  tickCountdowns();
  renderPackage();
  renderAccess();
  renderDashboard();
  renderJobNotes();
  renderDevNotes(); // TEMP-DEV-NOTES
}

function card(i, canEdit) {
  const k = key(i),
    st = itemState(k);
  const seg = el(
    "div",
    { class: "seg", role: "group", "aria-label": "Status for " + i.n },
    STATUS.map(([v, label]) =>
      el(
        "button",
        {
          type: "button",
          "data-v": v,
          "aria-pressed": String(st.s === v),
          disabled: !canEdit,
          onclick: () => {
            if (st.s !== v) patchItem(k, { s: v });
          },
        },
        label,
      ),
    ),
  );

  const resp = el(
    "select",
    {
      id: "r-" + k,
      "aria-label": "Responsibility for " + i.n,
      disabled: !canEdit,
      onchange: (e) => patchItem(k, { r: e.target.value }),
    },
    RESP.map(([v, l]) => el("option", { value: v }, l)),
  );
  resp.value = st.r;

  const sideDocs =
    i.panel === "slots" ||
    i.extraDrop ||
    i.panel === "photos" ||
    i.panel === "drop" ||
    i.panel === "survey" ||
    i.panel === "conform" ||
    i.panel === "clearance"
      ? []
      : i.panel === "emails"
        ? st.docs.filter((d) => d.kind !== "email")
        : i.approval?.noFolder && i.approval.drop
          ? st.docs.filter((d) => d.kind !== i.approval.drop.kind)
          : st.docs;
  const docs = el(
    "div",
    { class: "docs" },
    sideDocs.map((d) => docRow(k, d, canEdit)),
  );

  return el(
    "div",
    { class: "card", "data-s": st.s },
    el(
      "div",
      {},
      el(
        "div",
        { class: "ttl" },
        el("span", { class: "num" }, i.n),
        el("span", {}, i.t),
        el("span", { class: "stat-label" }, STATUS_LABEL[st.s]),
      ),
      i.d ? el("div", { class: "det" }, i.d) : null,
      i.fee || i.item || i.trig
        ? el(
            "div",
            { class: "meta" },
            i.item ? el("span", { class: "tag claim", title: "KR progress claim" }, i.item.toUpperCase()) : null,
            i.fee
              ? el(
                  "span",
                  {
                    class: "tag " + (i.payer === "KR" ? "krpay" : "fee"),
                    title: i.payer === "KR" ? "KR payment" : "Client payment",
                  },
                  "$ " + i.fee,
                )
              : null,
            i.trig ? el("span", { class: "tag trig" }, "↳ " + i.trig) : null,
          )
        : null,
      i.approval ? approvalPanel(k, st, canEdit, i.approval) : null,
      i.panel === "emails" ? emailPanel(k, st, canEdit) : null,
      i.panel === "conds" ? conditionsPanel(k, st, canEdit) : null,
      i.panel === "survey" ? surveyPanel(k, st, canEdit) : null,
      i.panel === "photos" ? photoPanel(k, st, canEdit, i.dropTitle, i.dropLabel) : null,
      i.panel === "drop" ? singleDropPanel(k, st, canEdit, i.dropTitle, i.dropLabel, i.dropAccept) : null,
      i.panel === "slots" ? slotsPanel(k, st, canEdit, null, i.slots, i.slotsTitle) : null,
      i.panel === "clearance"
        ? i.slots
          ? slotsPanel(k, st, canEdit, i.agency, i.slots)
          : clearancePanel(k, st, canEdit, i.agency)
        : null,
      i.panel === "conform" ? conformPanel(k, st, canEdit) : null,
      i.panel === "evidence" ? evidencePanel(i.agency, canEdit) : null,
      i.krNote ? krNotePanel(k, st, canEdit, i.krNote) : null,
      i.extraDrop ? singleDropPanel(k, st, canEdit, i.extraDrop.title, i.extraDrop.label) : null,
      i.panel === "paid" ? paidPanel(k, st, canEdit, i.paidLabel, i.paidBtn, i.paidDone) : null,
    ),
    el(
      "div",
      { class: "ctrl" },
      seg,
      el("div", { class: "row" }, resp),
      sideDocs.length && (!i.approval || i.approval.noFolder) && i.panel !== "conds" ? docs : null,
      errors[k] ? el("div", { class: "msg" }, errors[k]) : null,
    ),
  );
}

const decDraft = {}; // itemKey -> {v, c, err}
function approvalPanel(k, st, canEdit, A) {
  const dropped = A.drop ? st.docs.filter((d) => d.kind === A.drop.kind) : [];
  st = { ...st, docs: A.drop ? st.docs.filter((d) => d.kind !== A.drop.kind) : st.docs };
  const folder = el(
    "div",
    { class: "folder" },
    el(
      "div",
      { class: "folder-h" },
      el("span", { class: "folder-ic", "aria-hidden": "true" }),
      el("b", {}, A.folder),
      el("span", { class: "n" }, st.docs.length ? `${st.docs.length} file${st.docs.length > 1 ? "s" : ""}` : "empty"),
      st.docs.length
        ? el(
            "button",
            { type: "button", class: "btn small", style: "margin-left:auto", onclick: () => view(st.docs, 0) },
            "Open all",
          )
        : null,
    ),
    st.docs.length
      ? el(
          "div",
          { class: "docs" },
          st.docs.map((d) => docRow(k, d, canEdit)),
        )
      : null,
    canEdit && assets
      ? fileDrop(
          "fd-" + k,
          uploading[k] ? "Uploading…" : "Drag and drop " + A.noun + " documents here",
          "or click to choose files",
          (files) => upload(k, files),
        )
      : st.docs.length
        ? null
        : el("div", { class: "msg ok" }, A.hint),
  );

  let decision;
  const draft = decDraft[k];
  if (st.dec && !draft) {
    const when = st.dec.at
      ? new Date(st.dec.at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })
      : "";
    decision = el(
      "div",
      { class: "dec-result", "data-v": st.dec.v },
      el(
        "div",
        { class: "row" },
        el("b", {}, `Client ${st.dec.v === "accepted" ? A.yesPast : "declined"} the ${A.noun}`),
        el("span", { class: "n" }, when),
        canEdit
          ? el(
              "button",
              {
                type: "button",
                class: "btn small",
                style: "margin-left:auto",
                onclick: () => {
                  decDraft[k] = { v: st.dec.v, c: st.dec.c || "" };
                  render();
                },
              },
              "Change",
            )
          : null,
      ),
      st.dec.c ? el("div", { class: "dec-c" }, "“" + st.dec.c + "”") : null,
    );
  } else if (draft) {
    const ta = el("textarea", {
      id: "dc-" + k,
      rows: "2",
      placeholder: draft.v === "declined" ? "Reason for declining (required)" : "Comment (optional)",
      oninput: (e) => {
        draft.c = e.target.value;
      },
    });
    ta.value = draft.c || "";
    decision = el(
      "div",
      { class: "dec-form", "data-v": draft.v },
      el("b", {}, `${draft.v === "accepted" ? A.yes : "Decline"} the ${A.noun}`),
      ta,
      draft.err ? el("div", { class: "msg" }, draft.err) : null,
      el(
        "div",
        { class: "row" },
        el(
          "button",
          {
            type: "button",
            class: "btn small primary",
            onclick: () => {
              const c = (draft.c || "").trim();
              if (draft.v === "declined" && !c) {
                draft.err = "Add a comment explaining why the quote is declined.";
                render();
                document.getElementById("dc-" + k)?.focus();
                return;
              }
              delete decDraft[k];
              patchItem(k, { dec: { v: draft.v, c, at: new Date().toISOString() } });
            },
          },
          draft.v === "accepted" ? A.confirm : "Confirm decline",
        ),
        el(
          "button",
          {
            type: "button",
            class: "btn small",
            onclick: () => {
              delete decDraft[k];
              render();
            },
          },
          "Cancel",
        ),
      ),
    );
    if (!draft.focused) {
      draft.focused = true;
      setTimeout(() => document.getElementById("dc-" + k)?.focus(), 0);
    }
  } else {
    decision = el(
      "div",
      { class: "row" },
      el(
        "button",
        {
          type: "button",
          class: "btn dec-btn acc",
          disabled: !canEdit,
          onclick: () => {
            decDraft[k] = { v: "accepted", c: "" };
            render();
          },
        },
        A.yes + " " + A.noun,
      ),
      el(
        "button",
        {
          type: "button",
          class: "btn dec-btn dcl",
          disabled: !canEdit,
          onclick: () => {
            decDraft[k] = { v: "declined", c: "" };
            render();
          },
        },
        "Decline " + A.noun,
      ),
    );
  }
  return el(
    "div",
    { class: "approval" },
    A.noFolder ? null : folder,
    A.drop ? dropSlot(k, A.drop, dropped, canEdit) : null,
    el("div", { class: "dec" }, el("div", { class: "dec-label" }, A.label || "Client decision"), decision),
  );
}

function docRow(k, d, canEdit) {
  const ext = (d.name.split(".").pop() || "").slice(0, 4).toUpperCase();
  const ck = k + "|" + d.id;
  const kids = [
    el("span", { class: "ic" }, ext),
    el(
      "button",
      {
        type: "button",
        class: "nm",
        title: d.name,
        onclick: () => {
          const ds = itemState(k).docs;
          view(
            ds,
            Math.max(
              0,
              ds.findIndex((x) => x.id === d.id),
            ),
          );
        },
      },
      d.name,
    ),
  ];
  if (canEdit && assets) {
    if (confirmRm[ck])
      kids.push(
        el(
          "span",
          { class: "confirm" },
          "Remove?",
          el("button", { type: "button", class: "btn small", onclick: () => removeDoc(k, d) }, "Yes"),
          el(
            "button",
            {
              type: "button",
              class: "btn small",
              onclick: () => {
                delete confirmRm[ck];
                render();
              },
            },
            "No",
          ),
        ),
      );
    else
      kids.push(
        el(
          "button",
          {
            type: "button",
            class: "rm",
            "aria-label": "Remove " + d.name,
            title: "Remove",
            onclick: () => {
              confirmRm[ck] = true;
              render();
            },
          },
          "×",
        ),
      );
  }
  return el("div", { class: "doc" }, kids);
}

// ---------- job-level fields (outcome date, conditions) ----------
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const deepMerge = (a, b) => {
  const o = { ...(a || {}) };
  for (const [k, v] of Object.entries(b)) o[k] = isObj(v) && isObj(o[k]) ? deepMerge(o[k], v) : v;
  return o;
};
function patchJob(patch) {
  const j = job();
  if (!j) return;
  j.data = deepMerge(j.data, { ...patch, updatedAt: new Date().toISOString() });
  render();
  if (localMode) return;
  const id = j.id;
  writeChain = writeChain
    .then(() => db.doc("jobs/" + id).update({ ...patch, updatedAt: new Date().toISOString() }))
    .catch((e) => {
      if (e && e.code === "invalid_argument") {
        readOnly = true;
        showBanner("You have view-only access to this tracker, so changes can’t be saved.");
      } else showBanner("A change couldn’t be saved (" + (e?.code || "error") + "). Reload the page and try again.");
      render();
    });
}

// ---------- outcome date + countdown ----------
const fmtDate = (iso) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
function outcomeBox(canEdit) {
  const d = job()?.data || {},
    conf = d.conformed || "",
    val = d.outcome || "";
  const cIn = el("input", {
    type: "date",
    id: "conformedDate",
    disabled: !canEdit,
    onchange: (e) => {
      if (e.target.value !== conf) setConformed(e.target.value, "entered by hand");
    },
  });
  cIn.value = conf;
  const oIn = el("input", {
    type: "date",
    id: "outcomeDate",
    disabled: !canEdit,
    onchange: (e) => {
      if (e.target.value !== val) patchJob({ outcome: e.target.value });
    },
  });
  oIn.value = val;
  const auto = conf && val === addDays(conf, 90);
  return el(
    "div",
    { class: "outcome" },
    el(
      "div",
      { class: "oc-l" },
      el(
        "div",
        { class: "oc-dates" },
        el(
          "label",
          { class: "oc-f", for: "conformedDate" },
          el("span", { class: "oc-t" }, "Conformed date"),
          cIn,
          el(
            "span",
            { class: "det0" },
            conf
              ? d.conformedSrc && d.conformedSrc !== "entered by hand"
                ? "Read from " + d.conformedSrc
                : "Entered by hand"
              : "Stamped date on page 1 of the Conformance Notification",
          ),
        ),
        el(
          "label",
          { class: "oc-f", for: "outcomeDate" },
          el("span", { class: "oc-t" }, "WAPC outcome date"),
          oIn,
          el(
            "span",
            { class: "det0" },
            !val
              ? "90 days after the conformed date"
              : auto
                ? "90 days after the conformed date"
                : "Changed by hand (e.g. deferral)",
            val && conf && !auto && canEdit
              ? el(
                  "button",
                  { type: "button", class: "link-btn", onclick: () => patchJob({ outcome: addDays(conf, 90) }) },
                  " · reset to 90 days",
                )
              : null,
          ),
        ),
      ),
    ),
    el(
      "div",
      { class: "oc-r", role: "timer", "aria-live": "off" },
      val
        ? el("div", { class: "cd", "data-t": val })
        : el(
            "div",
            { class: "cd-empty" },
            "Drop the Conformance Notification in 4.2, or enter the conformed date, to start the countdown",
          ),
    ),
  );
}
// ---------- conformance notification → conformed date → outcome date (+90 days) ----------
const MONTHS = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const iso = (y, m, d) => {
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
};
function datesIn(s) {
  const out = [];
  for (const m of s.matchAll(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/g)) {
    const v = iso(+m[3], +m[2], +m[1]);
    if (v) out.push({ i: m.index, v });
  } // Australian d/m/y
  for (const m of s.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/g)) {
    const mo = MONTHS[m[2].slice(0, 4).toLowerCase()] || MONTHS[m[2].slice(0, 3).toLowerCase()];
    const v = mo && iso(+m[3], mo, +m[1]);
    if (v) out.push({ i: m.index, v });
  }
  for (const m of s.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g)) {
    const mo = MONTHS[m[1].slice(0, 4).toLowerCase()] || MONTHS[m[1].slice(0, 3).toLowerCase()];
    const v = mo && iso(+m[3], mo, +m[2]);
    if (v) out.push({ i: m.index, v });
  }
  return out.sort((a, b) => a.i - b.i).map((x) => x.v);
}
function findConformedDate(lines) {
  const L = lines.filter(Boolean);
  // a date on (or just after) a line that talks about conformance
  for (let i = 0; i < L.length; i++) {
    if (!/conform/i.test(L[i])) continue;
    const d = datesIn(L[i])[0] || datesIn(L[i + 1] || "")[0] || datesIn(L[i + 2] || "")[0];
    if (d) return { date: d, how: "conformed" };
  }
  // otherwise fall back to the letter's own date (first date in the document)
  const first = datesIn(L.slice(0, 40).join("\n"))[0];
  return first ? { date: first, how: "letter" } : null;
}
const addDays = (isoDate, n) => {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const confUi = { busy: false, msg: "" };
function setConformed(v, src) {
  patchJob({ conformed: v, conformedSrc: src || "", outcome: v ? addDays(v, 90) : "" });
}
// the conformed date is the date STAMPED on page 1
let sampleFn = null;
async function page1(bytes) {
  const lib = await loadPdfjs();
  const pdf = await lib.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true }).promise;
  const page = await pdf.getPage(1);
  const tc = await page.getTextContent();
  const lines = [];
  let cur = null,
    lastY = null;
  for (const it of tc.items) {
    if (it.str === undefined) continue;
    const y = it.transform[5];
    if (cur === null || lastY === null || Math.abs(y - lastY) > 2) {
      cur = { s: "" };
      lines.push(cur);
    }
    cur.s += (cur.s && !cur.s.endsWith(" ") ? " " : "") + it.str;
    lastY = y;
  }
  let annots = [];
  try {
    annots = (await page.getAnnotations())
      .map((a) =>
        [a.subtype, a.contentsObj?.str, a.contents, a.title, a.titleObj?.str, a.textContent?.join?.(" "), a.fieldValue]
          .filter(Boolean)
          .join(" "),
      )
      .filter(Boolean);
  } catch (e) {}
  return { page, lines: lines.map((l) => l.s.replace(/\s+/g, " ").trim()), annots };
}
async function page1Image(page) {
  const vp = page.getViewport({ scale: 3 });
  const cv = document.createElement("canvas");
  cv.width = Math.ceil(vp.width);
  cv.height = Math.ceil(vp.height);
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, cv.width, cv.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return await new Promise((res) => cv.toBlob(res, "image/png"));
}
async function stampByVision(page) {
  if (!sampleFn) return null;
  const caps = await sampleFn.limits().catch(() => null);
  if (!caps?.images) return null;
  const img = await page1Image(page);
  const r = await sampleFn.json(
    "This image is page 1 of a Western Australian Planning Commission (WAPC) Conformance Notification for a subdivision application. " +
      'Find the stamp box that reads "DEPARTMENT OF PLANNING, LANDS AND HERITAGE" with a DATE and a FILE number (e.g. "DATE 16-Mar-2026  FILE 123-26"). The conformed date is the DATE in that box – not the letter date or any other date on the page. Read the day digits carefully. ' +
      'Dates are Australian (day/month/year). Reply with only JSON like {"date":"2026-03-16","stampText":"DATE 16-Mar-2026 FILE 123-26","found":true} ' +
      'or {"date":null,"stampText":"","found":false} if there is no stamped date.',
    { images: img, modelTier: "default" },
  );
  return r && r.found && /^\d{4}-\d{2}-\d{2}$/.test(String(r.date || ""))
    ? { date: r.date, how: "stamp-image", text: String(r.stampText || "") }
    : { date: null, how: "none" };
}
function dateFromName(name) {
  const n = String(name || "");
  let m = /(?:^|\D)(20\d{2})(\d{2})(\d{2})(?:\D|$)/.exec(n);
  if (m) {
    const v = iso(+m[1], +m[2], +m[3]);
    if (v) return v;
  }
  m = /(?:^|\D)(20\d{2})[-_.](\d{1,2})[-_.](\d{1,2})(?:\D|$)/.exec(n);
  if (m) {
    const v = iso(+m[1], +m[2], +m[3]);
    if (v) return v;
  }
  m = /(?:^|\D)(\d{1,2})[-_.](\d{1,2})[-_.](20\d{2})(?:\D|$)/.exec(n);
  if (m) {
    const v = iso(+m[3], +m[2], +m[1]);
    if (v) return v;
  }
  return null;
}
async function readConformed(d) {
  confUi.busy = true;
  confUi.msg = "";
  render();
  try {
    const bytes = new Uint8Array(await (await fetch(blobUrl(d.id))).arrayBuffer());
    const p = await page1(bytes);
    // 1. a stamp added digitally (a PDF stamp annotation)
    let found = null;
    const nDate = dateFromName(d.name);
    if (nDate) found = { date: nDate, how: "name" };
    const aDate = !found && datesIn(p.annots.join("\n"))[0];
    if (aDate) found = { date: aDate, how: "stamp" };
    // 2. a stamp that is part of the page image – ask Claude to read page 1
    if (!found) {
      confUi.msg = "Reading the stamp on page 1…";
      render();
      try {
        const v = await stampByVision(p.page);
        if (v?.date) found = v;
      } catch (e) {
        if (e?.code === "not_granted")
          confUi.note =
            "Reading stamps needs permission to use Claude – enter the date by hand, or allow it next time.";
      }
    }
    // 3. last resort: a date written next to "conformed" in page 1's text
    if (!found) {
      const t = findConformedDate(p.lines);
      if (t && t.how === "conformed") found = { date: t.date, how: "text" };
    }
    if (!found)
      confUi.msg =
        confUi.note || `No stamped date could be found on page 1 of ${d.name}. Enter the conformed date below.`;
    else {
      setConformed(found.date, d.name);
      const shown = fmtDate(found.date);
      confUi.msg =
        found.how === "name"
          ? `Taken from the file name: ${shown}.`
          : found.how === "stamp-image"
            ? `Read from the stamp on page 1${found.text ? ` (“${found.text}”)` : ""}: ${shown}. Please check it below.`
            : found.how === "stamp"
              ? `Read from the stamp on page 1: ${shown}.`
              : `No stamp could be read, so the “conformed” date in the text was used: ${shown}. Please check it below.`;
    }
    delete confUi.note;
  } catch (e) {
    confUi.msg =
      e?.message === "load"
        ? "The PDF reader couldn’t load. Check your connection and try again."
        : `${d.name} couldn’t be read. Enter the conformed date below.`;
  }
  confUi.busy = false;
  render();
}
async function uploadConform(k, files) {
  const before = new Set(itemState(k).docs.map((d) => d.id));
  await upload(k, files);
  const fresh = itemState(k).docs.filter((d) => !before.has(d.id) && d.type === "application/pdf");
  if (fresh.length) readConformed(fresh[fresh.length - 1]);
}
function conformPanel(k, st, canEdit) {
  const pdfs = st.docs.filter((d) => d.type === "application/pdf");
  return el(
    "div",
    { class: "approval" },
    el(
      "div",
      { class: "folder-h" },
      el("span", { class: "folder-ic", "aria-hidden": "true" }),
      el("b", {}, "Conformance Notification"),
      el(
        "span",
        { class: "n" },
        st.docs.length ? `${st.docs.length} file${st.docs.length > 1 ? "s" : ""}` : "not received yet",
      ),
    ),
    st.docs.length
      ? el(
          "div",
          { class: "docs" },
          st.docs.map((d) => docRow(k, d, canEdit)),
        )
      : null,
    canEdit && assets
      ? fileDrop(
          "cf-" + k,
          uploading[k]
            ? "Uploading…"
            : confUi.busy
              ? "Reading the conformed date…"
              : "Drag and drop the Conformance Notification here",
          "PDF – the conformed date is taken from the file name, or read from the stamp on page 1",
          (files) => uploadConform(k, files),
          ".pdf",
        )
      : null,
    canEdit && pdfs.length
      ? el(
          "div",
          { class: "row wrap" },
          pdfs.map((d) =>
            el(
              "button",
              { type: "button", class: "btn small", disabled: confUi.busy, onclick: () => readConformed(d) },
              pdfs.length > 1 ? `Read date from ${d.name}` : "Read conformed date again",
            ),
          ),
        )
      : null,
    confUi.msg ? el("div", { class: "msg" }, confUi.msg) : null,
  );
}
const pad = (n) => String(n).padStart(2, "0");
function tickCountdowns() {
  for (const c of document.querySelectorAll(".cd")) {
    const iso = c.dataset.t;
    const end = new Date(iso + "T23:59:59").getTime();
    let ms = end - Date.now();
    const past = ms < 0;
    ms = Math.abs(ms);
    const d = Math.floor(ms / 864e5),
      h = Math.floor(ms / 36e5) % 24,
      m = Math.floor(ms / 6e4) % 60,
      s = Math.floor(ms / 1e3) % 60;
    c.dataset.state = past ? "past" : d < 14 ? "soon" : "ok";
    c.replaceChildren(
      el(
        "div",
        { class: "cd-digits" },
        el("span", {}, el("b", {}, String(d)), el("i", {}, d === 1 ? "day" : "days")),
        el("span", {}, el("b", {}, pad(h)), el("i", {}, "hrs")),
        el("span", {}, el("b", {}, pad(m)), el("i", {}, "min")),
        el("span", {}, el("b", {}, pad(s)), el("i", {}, "sec")),
      ),
      el(
        "div",
        { class: "cd-cap" },
        past ? `Outcome date passed – ${fmtDate(iso)}` : `until outcome date – ${fmtDate(iso)}`,
      ),
    );
  }
}
setInterval(tickCountdowns, 1000);

// ---------- email drop (.msg / .eml / dropped text) ----------
function cfb(buf) {
  const dv = new DataView(buf),
    u8 = new Uint8Array(buf);
  if (dv.getUint32(0, true) !== 0xe011cfd0) throw new Error("not an Outlook .msg file");
  const ss = 1 << dv.getUint16(0x1e, true),
    mss = 1 << dv.getUint16(0x20, true);
  const dirStart = dv.getUint32(0x30, true),
    cutoff = dv.getUint32(0x38, true);
  const miniFatStart = dv.getUint32(0x3c, true),
    nMiniFat = dv.getUint32(0x40, true);
  let difat = dv.getUint32(0x44, true);
  const nDifat = dv.getUint32(0x48, true);
  const END = 0xfffffffa,
    off = (s) => (s + 1) * ss,
    u32 = (o) => (o + 4 <= u8.length ? dv.getUint32(o, true) : 0xfffffffe);
  const fatSecs = [];
  for (let i = 0; i < 109; i++) {
    const v = u32(0x4c + i * 4);
    if (v < END) fatSecs.push(v);
  }
  for (let k = 0; k < nDifat && difat < END; k++) {
    for (let j = 0; j < ss / 4 - 1; j++) {
      const v = u32(off(difat) + j * 4);
      if (v < END) fatSecs.push(v);
    }
    difat = u32(off(difat) + ss - 4);
  }
  const fat = [];
  for (const s of fatSecs) for (let j = 0; j < ss / 4; j++) fat.push(u32(off(s) + j * 4));
  const chain = (start, table) => {
    const a = [];
    let s = start;
    while (s < END && a.length <= table.length) {
      a.push(s);
      s = table[s];
    }
    return a;
  };
  const read = (start, size) => {
    const secs = chain(start, fat),
      out = new Uint8Array(size ?? secs.length * ss);
    let p = 0;
    for (const s of secs) {
      const n = Math.min(ss, out.length - p);
      if (n <= 0) break;
      out.set(u8.subarray(off(s), off(s) + n), p);
      p += n;
    }
    return out;
  };
  const dirBytes = read(dirStart),
    ddv = new DataView(dirBytes.buffer),
    ents = [];
  for (let o = 0; o + 128 <= dirBytes.length; o += 128) {
    const nl = ddv.getUint16(o + 0x40, true);
    ents.push({
      name: new TextDecoder("utf-16le").decode(dirBytes.subarray(o, o + Math.max(0, nl - 2))),
      type: dirBytes[o + 0x42],
      l: ddv.getUint32(o + 0x44, true),
      r: ddv.getUint32(o + 0x48, true),
      c: ddv.getUint32(o + 0x4c, true),
      start: ddv.getUint32(o + 0x74, true),
      size: ddv.getUint32(o + 0x78, true),
    });
  }
  const mini = read(ents[0].start, ents[0].size);
  const mfBytes = nMiniFat ? read(miniFatStart) : new Uint8Array(0),
    mfdv = new DataView(mfBytes.buffer),
    miniFat = [];
  for (let o = 0; o + 4 <= mfBytes.length; o += 4) miniFat.push(mfdv.getUint32(o, true));
  const readMini = (start, size) => {
    const out = new Uint8Array(size);
    let p = 0;
    for (const s of chain(start, miniFat)) {
      const n = Math.min(mss, size - p);
      if (n <= 0) break;
      out.set(mini.subarray(s * mss, s * mss + n), p);
      p += n;
    }
    return out;
  };
  const children = (idx) => {
    const out = [],
      walk = (i) => {
        if (i >= ents.length || i === 0xffffffff) return;
        const e = ents[i];
        walk(e.l);
        out.push(e);
        walk(e.r);
      };
    walk(ents[idx].c);
    return out;
  };
  return { top: children(0), data: (e) => (e.size < cutoff ? readMini(e.start, e.size) : read(e.start, e.size)) };
}
function stripHtml(html) {
  const t = html.replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d)[^>]*>/gi, "\n");
  const doc = new DOMParser().parseFromString(t, "text/html");
  doc.querySelectorAll("style,script,head").forEach((n) => n.remove());
  return (doc.body?.textContent || "")
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function parseMsg(buf) {
  const f = cfb(buf),
    by = {};
  for (const e of f.top) by[e.name.toUpperCase()] = e;
  const str = (id) => {
    const u = by["__SUBSTG1.0_" + id + "001F"];
    if (u) return new TextDecoder("utf-16le").decode(f.data(u)).replace(/\0+$/, "");
    const a = by["__SUBSTG1.0_" + id + "001E"];
    if (a) return new TextDecoder("windows-1252").decode(f.data(a)).replace(/\0+$/, "");
    return "";
  };
  let body = str("1000");
  if (!body) {
    const h = by["__SUBSTG1.0_10130102"];
    if (h) body = stripHtml(new TextDecoder("utf-8").decode(f.data(h)));
  }
  let date = "";
  const props = by["__PROPERTIES_VERSION1.0"];
  if (props) {
    const p = f.data(props),
      pdv = new DataView(p.buffer);
    for (let o = 32; o + 16 <= p.length; o += 16) {
      const tag = pdv.getUint32(o, true),
        id = tag >>> 16,
        type = tag & 0xffff;
      if (type === 0x40 && (id === 0x0039 || id === 0x0e06)) {
        const ms = (pdv.getUint32(o + 12, true) * 4294967296 + pdv.getUint32(o + 8, true)) / 1e4 - 11644473600000;
        if (ms > 0) {
          date = new Date(ms).toISOString();
          if (id === 0x0039) break;
        }
      }
    }
  }
  const email = str("5D01") || str("0C1F") || str("0065");
  const name = str("0C1A") || str("0042");
  return {
    subject: str("0037"),
    from: name && email && name !== email ? `${name} <${email}>` : name || email,
    to: str("0E04"),
    cc: str("0E03"),
    date,
    body,
  };
}
function decodeBytes(bytes, cs) {
  try {
    return new TextDecoder(cs || "utf-8").decode(bytes);
  } catch (e) {
    return new TextDecoder("utf-8").decode(bytes);
  }
}
const latin1Bytes = (s) => Uint8Array.from(s, (ch) => ch.charCodeAt(0) & 255);
function decodeWords(s) {
  return (s || "").replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=\s*(?==\?)?/g, (_, cs, enc, txt) => {
    try {
      const bytes = /b/i.test(enc)
        ? latin1Bytes(atob(txt))
        : latin1Bytes(
            txt.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))),
          );
      return decodeBytes(bytes, cs);
    } catch (e) {
      return txt;
    }
  });
}
function mimeSplit(raw) {
  const i = raw.search(/\r?\n\r?\n/);
  const head = i < 0 ? raw : raw.slice(0, i),
    body = i < 0 ? "" : raw.slice(i).replace(/^\r?\n\r?\n/, "");
  const h = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const m = /^([\w-]+):\s*(.*)$/.exec(line);
    if (m && !(m[1].toLowerCase() in h)) h[m[1].toLowerCase()] = m[2];
  }
  return { h, body };
}
function mimeText(part) {
  const ct = part.h["content-type"] || "text/plain";
  if (/^multipart\//i.test(ct)) {
    const b = /boundary="?([^";]+)"?/i.exec(ct)?.[1];
    if (!b) return null;
    const parts = part.body
      .split("--" + b)
      .slice(1)
      .filter((p) => !p.startsWith("--"))
      .map((p) => mimeSplit(p.replace(/^\r?\n/, "")));
    const texts = parts.map((p) => ({ ct: p.h["content-type"] || "text/plain", v: mimeText(p) })).filter((p) => p.v);
    return (
      (texts.find((p) => /text\/plain/i.test(p.ct)) || texts.find((p) => /multipart/i.test(p.ct)) || texts[0])?.v ||
      null
    );
  }
  if (!/^text\//i.test(ct) || /attachment/i.test(part.h["content-disposition"] || "")) return null;
  const cs = /charset="?([^";]+)"?/i.exec(ct)?.[1],
    cte = (part.h["content-transfer-encoding"] || "").toLowerCase();
  let bytes;
  if (cte === "base64") {
    try {
      bytes = latin1Bytes(atob(part.body.replace(/\s+/g, "")));
    } catch (e) {
      bytes = latin1Bytes(part.body);
    }
  } else if (cte === "quoted-printable")
    bytes = latin1Bytes(
      part.body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))),
    );
  else bytes = latin1Bytes(part.body);
  const text = decodeBytes(bytes, cs);
  return /html/i.test(ct) ? stripHtml(text) : text.trim();
}
function parseEml(buf) {
  const raw = Array.from(new Uint8Array(buf), (b) => String.fromCharCode(b)).join("");
  const top = mimeSplit(raw);
  const dt = top.h.date ? new Date(top.h.date) : null;
  return {
    subject: decodeWords(top.h.subject),
    from: decodeWords(top.h.from),
    to: decodeWords(top.h.to),
    cc: decodeWords(top.h.cc),
    date: dt && !isNaN(dt) ? dt.toISOString() : "",
    body: mimeText(top) || "",
  };
}
const fmtDateTime = (iso) =>
  iso
    ? new Date(iso).toLocaleString("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
function emailText(m) {
  return [
    `Subject: ${m.subject || "(no subject)"}`,
    m.from && `From: ${m.from}`,
    m.to && `To: ${m.to}`,
    m.cc && `Cc: ${m.cc}`,
    m.date && `Date: ${fmtDateTime(m.date)}`,
    "",
    "—".repeat(30),
    "",
    m.body || "(no message text)",
  ]
    .filter((x) => typeof x === "string")
    .join("\n");
}
async function addEmails(k, dt) {
  if (!assets || !job()) return;
  delete errors[k];
  const files = [...(dt.files || [])],
    found = [],
    problems = [];
  for (const f of files) {
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    try {
      if (ext === "msg") found.push(parseMsg(await f.arrayBuffer()));
      else if (ext === "eml") found.push(parseEml(await f.arrayBuffer()));
      else
        problems.push(
          `${f.name} isn’t an email – drop an Outlook message (.msg) or .eml file, or use Upload for other documents`,
        );
    } catch (e) {
      problems.push(`${f.name} couldn’t be read as an email`);
    }
  }
  if (!files.length) {
    const txt = (dt.getData?.("text/plain") || "").trim();
    if (txt)
      found.push({
        subject: txt.split("\n")[0].slice(0, 90),
        from: "",
        date: new Date().toISOString(),
        body: txt,
        pasted: true,
      });
  }
  if (!found.length && !problems.length) problems.push("Nothing to add – drop an email file or email text");
  const added = [];
  for (const m of found) {
    uploading[k] = true;
    render();
    const name =
      (m.subject || "Email")
        .replace(/[\\/:*?"<>|]+/g, " ")
        .slice(0, 80)
        .trim() + ".txt";
    try {
      const r = await assets.upload(new Blob([emailText(m)], { type: "text/plain" }), { type: "text/plain" });
      added.push({
        id: r.id,
        name,
        type: "text/plain",
        size: r.sizeBytes,
        at: new Date().toISOString(),
        kind: "email",
        subject: m.subject || "(no subject)",
        from: m.from || (m.pasted ? "Pasted text" : ""),
        date: m.date || "",
      });
    } catch (e) {
      problems.push(`“${m.subject || "Email"}” ${ERR[e?.code] || "couldn’t be saved (" + (e?.code || "error") + ")"}`);
    }
  }
  delete uploading[k];
  if (problems.length) errors[k] = problems.join(". ") + ".";
  if (added.length) patchItem(k, { docs: [...itemState(k).docs, ...added] });
  else render();
}
function emailPanel(k, st, canEdit) {
  const mails = st.docs.filter((d) => d.kind === "email");
  const input = el("input", {
    type: "file",
    multiple: true,
    accept: ".msg,.eml",
    id: "em-" + k,
    class: "sr",
    "aria-label": "Choose email files for " + k,
    onchange: (e) => addEmails(k, { files: e.target.files }),
  });
  const zone =
    canEdit && assets
      ? el(
          "label",
          {
            class: "drop",
            for: "em-" + k,
            ondragover: (e) => {
              e.preventDefault();
              e.currentTarget.classList.add("over");
            },
            ondragleave: (e) => e.currentTarget.classList.remove("over"),
            ondrop: (e) => {
              e.preventDefault();
              e.currentTarget.classList.remove("over");
              addEmails(k, e.dataTransfer);
            },
          },
          input,
          el("b", {}, uploading[k] ? "Saving email…" : "Drop a WAPC query email here"),
          el("span", {}, "Drag an email from Outlook, or click to choose a .msg / .eml file"),
        )
      : null;
  return el(
    "div",
    { class: "approval" },
    el(
      "div",
      { class: "folder-h" },
      el("span", { class: "folder-ic", "aria-hidden": "true" }),
      el("b", {}, "Query emails"),
      el("span", { class: "n" }, mails.length ? `${mails.length} email${mails.length > 1 ? "s" : ""}` : "none yet"),
    ),
    mails.length
      ? el(
          "div",
          { class: "mails" },
          mails.map((m) =>
            el(
              "div",
              { class: "mail" },
              el("button", { type: "button", class: "nm", onclick: () => view(mails, mails.indexOf(m)) }, m.subject),
              el("div", { class: "mail-m" }, [m.from, fmtDateTime(m.date)].filter(Boolean).join(" · ")),
              canEdit && assets ? mailRemove(k, m) : null,
            ),
          ),
        )
      : null,
    zone,
  );
}
function mailRemove(k, d) {
  const ck = k + "|" + d.id;
  if (confirmRm[ck])
    return el(
      "span",
      { class: "confirm" },
      "Remove?",
      el("button", { type: "button", class: "btn small", onclick: () => removeDoc(k, d) }, "Yes"),
      el(
        "button",
        {
          type: "button",
          class: "btn small",
          onclick: () => {
            delete confirmRm[ck];
            render();
          },
        },
        "No",
      ),
    );
  return el(
    "button",
    {
      type: "button",
      class: "rm",
      "aria-label": "Remove " + d.name,
      title: "Remove",
      onclick: () => {
        confirmRm[ck] = true;
        render();
      },
    },
    "×",
  );
}

// ---------- conditional approval → conditions checklist ----------
const AGENCIES = ["Western Power", "Water Corporation", "Local Government", "Busselton Water", "WAPC"];
let pdfjsP = null;
function loadPdfjs() {
  const base = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  const add = (src) =>
    new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = res;
      s.onerror = () => rej(new Error("load"));
      document.head.append(s);
    });
  return (pdfjsP ||= add(base + "pdf.min.js")
    .then(() => add(base + "pdf.worker.min.js"))
    .then(() => window.pdfjsLib)
    .catch((e) => {
      pdfjsP = null;
      throw e;
    }));
}
async function pdfText(bytes) {
  const lib = await loadPdfjs();
  const pdf = await lib.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true }).promise;
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    let cur = null,
      lastY = null,
      lastEnd = null;
    for (const it of tc.items) {
      if (it.str === undefined) continue;
      const x = it.transform[4],
        y = it.transform[5];
      if (cur === null || lastY === null || Math.abs(y - lastY) > 2) {
        cur = { s: "" };
        lines.push(cur);
        lastEnd = null;
      }
      if (lastEnd !== null && x - lastEnd > 1 && !cur.s.endsWith(" ") && !it.str.startsWith(" ")) cur.s += " ";
      cur.s += it.str;
      lastY = y;
      lastEnd = x + (it.width || 0);
      if (it.hasEOL) lastY = null;
    }
    lines.push({ s: "" });
  }
  return lines.map((l) => l.s.replace(/\s+/g, " ").trim());
}
function agencyFrom(s) {
  const t = s.toLowerCase();
  if (/busselton water/.test(t)) return "Busselton Water";
  if (/western power/.test(t)) return "Western Power";
  if (/water corp/.test(t)) return "Water Corporation";
  if (/planning commission|\bwapc\b/.test(t)) return "WAPC";
  if (/local government|\bshire\b|\bcity of\b|\btown of\b|\bcouncil\b/.test(t)) return "Local Government";
  return null;
}
function guessAgency(text) {
  const t = text.toLowerCase();
  if (/electric|power supply|western power/.test(t)) return "Western Power";
  if (/busselton water/.test(t)) return "Busselton Water";
  if (/sewer|wastewater|water corporation/.test(t)) return "Water Corporation";
  if (/water supply|potable/.test(t)) return /busselton/.test(t) ? "Busselton Water" : "Water Corporation";
  if (/crossover|drainage|verge|kerb|road|footpath|local government|council|shire/.test(t)) return "Local Government";
  return "WAPC";
}
function parseConditions(lines) {
  let start = lines.findIndex((l) => /^conditions?\b/i.test(l) && l.length < 60);
  start = start < 0 ? 0 : start + 1;
  let end = lines.findIndex((l, i) => i > start && /^advice\b/i.test(l));
  if (end < 0) end = lines.length;
  const out = [];
  let cur = null;
  for (const l of lines.slice(start, end)) {
    if (!l) continue;
    if (/^page \d+( of \d+)?$/i.test(l)) continue;
    // page footers: page numbers and the "OFFICIAL" security marking
    if (/^(\d{1,3}\s*)?((UN)?OFFICIAL(:?\s*Sensitive)?)?\s*(\d{1,3})?$/i.test(l)) continue;
    const m = /^(\d{1,2})[.)]\s*(.*)$/.exec(l);
    if (m && +m[1] === out.length + 1) {
      cur = { n: m[1], t: m[2] };
      out.push(cur);
    } else if (cur) cur.t += " " + l;
  }
  return out.map((c) => {
    const t = c.t
      .replace(/\s\d{1,3}\s+(UN)?OFFICIAL(:?\s*Sensitive)?\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    // the responsible agency is named in brackets at the end – take the last bracketed agency, even if stray text follows it
    const named = [...t.matchAll(/\(([^()]{3,80})\)/g)]
      .map((m) => agencyFrom(m[1]))
      .filter(Boolean)
      .pop();
    return { n: c.n, t, a: named || guessAgency(t), guessed: !named, done: false };
  });
}
const condUi = { open: true, busy: false, msg: "", confirmReplace: null };
async function extractConditions(k, d) {
  condUi.busy = true;
  condUi.msg = "";
  condUi.confirmReplace = null;
  render();
  try {
    const bytes = new Uint8Array(await (await fetch(blobUrl(d.id))).arrayBuffer());
    const lines = await pdfText(bytes);
    const list = parseConditions(lines);
    const ad = findApprovalDates(lines);
    if (ad.approval || ad.expiry)
      patchJob({ ...(ad.approval ? { approval: ad.approval } : {}), ...(ad.expiry ? { expiry: ad.expiry } : {}) });
    if (!list.length)
      condUi.msg =
        "No numbered conditions were found in this PDF. Check it is the WAPC conditional approval letter (not a scanned image).";
    else {
      patchJob({ conds: { list, src: d.id, srcName: d.name, at: new Date().toISOString() } });
      condUi.open = true;
      const g = list.filter((c) => c.guessed);
      if (g.length)
        condUi.msg = `Check the agency for condition${g.length > 1 ? "s" : ""} ${g.map((c) => c.n).join(", ")} – no agency was named in brackets, so it was guessed.`;
    }
  } catch (e) {
    condUi.msg =
      e?.message === "load"
        ? "The PDF reader couldn’t load. Check your connection and try again."
        : "This PDF couldn’t be read. Try re-saving it as a PDF and uploading again.";
  }
  condUi.busy = false;
  render();
}
function setCond(idx, patch) {
  const c = job()?.data?.conds;
  if (!c?.list) return;
  const list = c.list.map((x, i) => (i === idx ? { ...x, ...patch } : x));
  patchJob({ conds: { list } });
}
const COND_RESP = [
  ["", "Unassigned"],
  ["KR", "KR Surveys"],
  ["CL", "Client"],
];
const condDraft = {}; // "idx:field" -> text being typed
const condTimers = {};
function condField(idx, field, value) {
  const key = idx + ":" + field;
  condDraft[key] = value;
  clearTimeout(condTimers[key]);
  condTimers[key] = setTimeout(() => flushCond(idx, field, true), 700);
}
function flushCond(idx, field, typing) {
  const key = idx + ":" + field;
  clearTimeout(condTimers[key]);
  delete condTimers[key];
  if (!(key in condDraft)) return;
  const v = typing ? condDraft[key] : condDraft[key].trim();
  if (!typing) delete condDraft[key];
  const c = job()?.data?.conds?.list?.[idx];
  if (!c) return;
  const cur = field === "kr" ? (c.kr ?? c.cm ?? "") : c[field] || "";
  if (v !== cur) setCond(idx, field === "kr" ? { kr: v, cm: "" } : { [field]: v });
  else if (!typing) render();
}
function condEditor(c, idx, canEdit, where) {
  const p = where + "-" + idx;
  const sel = el(
    "select",
    {
      id: "cr-" + p,
      "aria-label": "Responsibility for condition " + c.n,
      disabled: !canEdit,
      onchange: (e) => setCond(idx, { r: e.target.value }),
    },
    COND_RESP.map(([v, l]) => el("option", { value: v }, l)),
  );
  sel.value = c.r || "";
  const box = (field, label, saved) => {
    const key = idx + ":" + field;
    const ta = el("textarea", {
      id: "c" + field + "-" + p,
      class: "ccm",
      rows: "2",
      placeholder: label,
      disabled: !canEdit,
      "aria-label": label + " – condition " + c.n,
      oninput: (e) => condField(idx, field, e.target.value),
      onchange: () => flushCond(idx, field),
    });
    ta.value = key in condDraft ? condDraft[key] : saved;
    return el("label", { class: "cfield" }, el("span", { class: "lbl" }, label), ta);
  };
  return el(
    "div",
    { class: "ced" },
    el(
      "div",
      { class: "row wrap" },
      el(
        "label",
        { class: "ctick" },
        el("input", {
          type: "checkbox",
          id: "cd-" + p,
          checked: c.done,
          disabled: !canEdit,
          onchange: (e) => setCond(idx, { done: e.target.checked }),
        }),
        el("span", { class: "cstate" }, c.done ? "Cleared" : "Open"),
      ),
      el("span", { class: "lbl" }, "Responsibility"),
      sel,
    ),
    el(
      "div",
      { class: "cfields" },
      box("kr", "KR Surveys comment", c.kr ?? c.cm ?? ""),
      box("cl", "Client comment", c.cl || ""),
    ),
  );
}
function conditionsPanel(k, st, canEdit) {
  const conds = job()?.data?.conds;
  const list = Array.isArray(conds?.list) ? conds.list : [];
  const pdfs = st.docs.filter((d) => d.type === "application/pdf");
  const folder = el(
    "div",
    { class: "folder" },
    el(
      "div",
      { class: "folder-h" },
      el("span", { class: "folder-ic", "aria-hidden": "true" }),
      el("b", {}, "WAPC conditional approval"),
      el("span", { class: "n" }, st.docs.length ? `${st.docs.length} file${st.docs.length > 1 ? "s" : ""}` : "empty"),
    ),
    st.docs.length
      ? el(
          "div",
          { class: "docs" },
          st.docs.map((d) => docRow(k, d, canEdit)),
        )
      : null,
    canEdit && assets
      ? fileDrop(
          "fd-" + k,
          uploading[k] ? "Uploading…" : "Drag and drop the WAPC conditional approval PDF here",
          "then extract its conditions",
          (files) => upload(k, files),
          ".pdf",
        )
      : st.docs.length
        ? null
        : el("div", { class: "msg ok" }, "The WAPC conditional approval PDF goes here."),
  );
  // conditions only come from the WAPC Decision Letter, never the stamped plan or other files
  const letters = pdfs.filter((d) => /decision/i.test(d.name));
  const actions =
    canEdit && letters.length
      ? el(
          "div",
          { class: "row wrap" },
          letters.map((d) => {
            const go = () => {
              if (list.length) {
                condUi.confirmReplace = d.id;
                render();
              } else extractConditions(k, d);
            };
            if (condUi.confirmReplace === d.id)
              return el(
                "span",
                { class: "confirm" },
                `Replace the ${list.length} existing conditions, including their ticks, comments and evidence?`,
                el("button", { type: "button", class: "btn small", onclick: () => extractConditions(k, d) }, "Replace"),
                el(
                  "button",
                  {
                    type: "button",
                    class: "btn small",
                    onclick: () => {
                      condUi.confirmReplace = null;
                      render();
                    },
                  },
                  "Cancel",
                ),
              );
            return el(
              "button",
              { type: "button", class: "btn small primary", disabled: condUi.busy, onclick: go },
              condUi.busy
                ? "Reading Decision Letter…"
                : letters.length > 1
                  ? `Extract conditions – ${d.name}`
                  : list.length
                    ? "Re-extract conditions from Decision Letter"
                    : "Extract conditions from Decision Letter",
            );
          }),
        )
      : canEdit && pdfs.length
        ? el(
            "div",
            { class: "msg ok" },
            "Conditions can only be extracted from the Decision Letter – upload it with “Decision Letter” in the file name.",
          )
        : null;

  let checklist = null;
  if (list.length) {
    const done = list.filter((c) => c.done).length;
    const det = el(
      "details",
      {
        class: "conds",
        ontoggle: (e) => {
          condUi.open = e.target.open;
        },
      },
      el(
        "summary",
        {},
        el("b", {}, "Conditions checklist"),
        el("span", { class: "n" }, `${done} of ${list.length} cleared`),
      ),
      el(
        "div",
        { class: "clist2" },
        list.map((c, idx) => condCard(c, idx, canEdit, "chk", true)),
      ),
      conds.srcName
        ? el(
            "div",
            { class: "msg ok" },
            `Extracted from ${conds.srcName} · changes here and in each agency section update each other`,
          )
        : null,
    );
    if (condUi.open) det.setAttribute("open", "");
    checklist = det;
  }
  return el(
    "div",
    { class: "approval" },
    folder,
    actions,
    condUi.msg ? el("div", { class: "msg" }, condUi.msg) : null,
    checklist,
  );
}
function agencyConditions(agency, canEdit) {
  const list = job()?.data?.conds?.list;
  if (!Array.isArray(list)) return null;
  const mine = list.map((c, idx) => ({ c, idx })).filter((x) => x.c.a === agency);
  if (!mine.length) return null;
  const done = mine.filter((x) => x.c.done).length;
  return el(
    "div",
    { class: "acond" },
    el(
      "div",
      { class: "folder-h" },
      el("b", {}, `WAPC conditions – ${agency}`),
      el("span", { class: "n" }, `${done} of ${mine.length} completed`),
      el("a", { class: "link small", href: "#wapc-approval", style: "margin-left:auto" }, "Checklist ↑"),
    ),
    mine.map(({ c, idx }) =>
      el(
        "label",
        { class: "acond-i" + (c.done ? " done" : "") },
        el("input", {
          type: "checkbox",
          id: "cond-" + idx,
          checked: c.done,
          disabled: !canEdit,
          onchange: (e) => setCond(idx, { done: e.target.checked }),
        }),
        el("span", { class: "cn" }, "Condition " + c.n),
        el(
          "span",
          { class: "ctx" },
          c.t,
          c.r || c.cm
            ? el(
                "span",
                { class: "cmeta" },
                [c.r ? (c.r === "KR" ? "KR Surveys" : "Client") : "", c.cm ? "“" + c.cm + "”" : ""]
                  .filter(Boolean)
                  .join(" · "),
              )
            : null,
        ),
      ),
    ),
  );
}

// ---------- uploads ----------
const TYPES = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  json: "application/json",
};
const ERR = {
  too_large: "is larger than 20 MB",
  unsupported_type: "isn’t a supported type (use PDF, image, video or text)",
  quota_or_state: "couldn’t be stored – storage is full",
  rate_limited: "wasn’t uploaded – too many uploads at once, try again shortly",
};

const noteDraft = {},
  noteTimers = {};
function flushNote(k, typing) {
  clearTimeout(noteTimers[k]);
  delete noteTimers[k];
  if (!(k in noteDraft)) return;
  const v = typing ? noteDraft[k] : noteDraft[k].trim();
  if (!typing) delete noteDraft[k];
  if (v !== itemState(k).krnote) patchItem(k, { krnote: v });
  else if (!typing) render();
}
function krNotePanel(k, st, canEdit, label) {
  const ta = el("textarea", {
    id: "kn-" + k,
    class: "ccm",
    rows: "3",
    disabled: !canEdit,
    "aria-label": label,
    placeholder: "e.g. Development contribution of $X payable to the Shire – invoice attached",
    oninput: (e) => {
      noteDraft[k] = e.target.value;
      clearTimeout(noteTimers[k]);
      noteTimers[k] = setTimeout(() => flushNote(k, true), 700);
    },
    onchange: () => flushNote(k),
  });
  ta.value = k in noteDraft ? noteDraft[k] : st.krnote;
  return el("label", { class: "paid-box kn" }, el("span", { class: "dec-label" }, label), ta);
}

function paidPanel(k, st, canEdit, label = "Client decision", btn = "Invoice PAID", doneText = "Invoice paid") {
  if (st.paid?.at) {
    const when = new Date(st.paid.at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
    return el(
      "div",
      { class: "paid-box" },
      el("div", { class: "dec-label" }, label),
      el(
        "div",
        { class: "dec-result" },
        el(
          "div",
          { class: "row" },
          el("b", {}, doneText),
          el("span", { class: "n" }, when),
          canEdit
            ? el(
                "button",
                {
                  type: "button",
                  class: "btn small",
                  style: "margin-left:auto",
                  onclick: () => patchItem(k, { paid: null, s: "n" }),
                },
                "Undo",
              )
            : null,
        ),
      ),
    );
  }
  return el(
    "div",
    { class: "paid-box" },
    el("div", { class: "dec-label" }, label),
    el(
      "button",
      {
        type: "button",
        class: "btn dec-btn acc",
        disabled: !canEdit,
        onclick: () => patchItem(k, { paid: { at: new Date().toISOString() }, s: "c" }),
      },
      btn,
    ),
  );
}

async function uploadEvidence(idx, files) {
  const list = job()?.data?.conds?.list;
  if (!assets || !Array.isArray(list) || !files.length) return;
  const ek = "ev" + idx;
  delete errors[ek];
  const added = [],
    problems = [];
  for (const f of files) {
    const type = TYPES[(f.name.split(".").pop() || "").toLowerCase()];
    if (!type) {
      problems.push(`${f.name} isn’t a supported type (use PDF, image, video or text)`);
      continue;
    }
    uploading[ek] = true;
    render();
    try {
      const r = await assets.upload(f, { type });
      added.push({ id: r.id, name: f.name, type: r.contentType, size: r.sizeBytes, at: new Date().toISOString() });
    } catch (e) {
      problems.push(`${f.name} ${ERR[e?.code] || "couldn’t be uploaded (" + (e?.code || "error") + ")"}`);
    }
  }
  delete uploading[ek];
  if (problems.length) errors[ek] = problems.join(". ") + ".";
  const cur = job()?.data?.conds?.list?.[idx];
  if (added.length && cur) setCond(idx, { ev: [...(cur.ev || []), ...added] });
  else render();
}
function topEvidence(agency, canEdit) {
  const list = job()?.data?.conds?.list;
  if (!Array.isArray(list) || !list.some((c) => c.a === agency)) return null;
  return evidencePanel(agency, canEdit, true);
}
function evidencePanel(agency, canEdit, top) {
  const list = job()?.data?.conds?.list;
  const mine = Array.isArray(list) ? list.map((c, idx) => ({ c, idx })).filter((x) => x.c.a === agency) : [];
  if (!mine.length)
    return el(
      "div",
      { class: "approval" },
      el(
        "div",
        { class: "msg ok" },
        `No ${agency} conditions yet. Extract them from the WAPC conditional approval in 5.0 and they will appear here.`,
      ),
    );
  const done = mine.filter((x) => x.c.done).length;
  return el(
    "div",
    { class: "approval evid" + (top ? " evid-top" : "") },
    el(
      "div",
      { class: "folder-h" },
      el("b", {}, top ? `WAPC conditions – ${agency}` : `${agency} conditions`),
      el("span", { class: "n" }, `${done} of ${mine.length} cleared`),
      el("a", { class: "link small", href: "#wapc-approval", style: "margin-left:auto" }, "Checklist ↑"),
    ),
    mine.map(({ c, idx }) => condCard(c, idx, canEdit, "ag", false)),
  );
}
function agencyPicker(c, idx, canEdit) {
  const sel = el(
    "select",
    {
      id: "ca-" + idx,
      class: "agency-sel",
      "aria-label": "Agency for condition " + c.n,
      disabled: !canEdit,
      onchange: (e) => setCond(idx, { a: e.target.value, guessed: false }),
    },
    AGENCIES.map((a) => el("option", { value: a }, a)),
  );
  sel.value = c.a;
  const ok =
    c.guessed && canEdit
      ? el(
          "button",
          { type: "button", class: "link-btn", onclick: () => setCond(idx, { guessed: false }) },
          "Agency is correct",
        )
      : null;
  return el("span", { class: "row" }, sel, ok);
}
function condCard(c, idx, canEdit, where, showAgency) {
  const ev = Array.isArray(c.ev) ? c.ev : [],
    ek = "ev" + idx,
    inId = "evf-" + where + "-" + idx;
  const zone =
    canEdit && assets
      ? el(
          "label",
          {
            class: "drop small",
            for: inId,
            ondragover: (e) => {
              e.preventDefault();
              e.currentTarget.classList.add("over");
            },
            ondragleave: (e) => e.currentTarget.classList.remove("over"),
            ondrop: (e) => {
              e.preventDefault();
              e.currentTarget.classList.remove("over");
              uploadEvidence(idx, [...e.dataTransfer.files]);
            },
          },
          el("input", {
            type: "file",
            multiple: true,
            id: inId,
            class: "sr",
            accept: ".pdf,.png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.txt,.csv",
            "aria-label": "Evidence for condition " + c.n,
            onchange: (e) => uploadEvidence(idx, [...e.target.files]),
          }),
          el("b", {}, uploading[ek] ? "Uploading…" : "Drop clearance evidence here"),
          el("span", {}, "photos, stat dec, approvals – or click to choose"),
        )
      : null;
  return el(
    "div",
    { class: "ev-c" + (c.done ? " done" : "") },
    el(
      "div",
      { class: "ev-h" },
      el("span", { class: "cn" }, "Condition " + c.n),
      showAgency ? agencyPicker(c, idx, canEdit) : el("span", { class: "agency" }, c.a),
      c.guessed
        ? el(
            "span",
            { class: "guess", title: "No agency was named in brackets in the Decision Letter, so it was guessed" },
            "Agency guessed – please check",
          )
        : null,
      showAgency
        ? el("a", { class: "link small", href: "#" + slug(c.a), style: "margin-left:auto" }, `Go to ${c.a} ↓`)
        : null,
    ),
    el("div", { class: "ctx" }, c.t),
    condEditor(c, idx, canEdit, where),
    ev.length
      ? el(
          "div",
          { class: "docs" },
          ev.map((d, j) => evRow(idx, d, j, ev, canEdit)),
        )
      : null,
    zone,
    errors[ek] ? el("div", { class: "msg" }, errors[ek]) : null,
  );
}
function evRow(idx, d, j, ev, canEdit) {
  const ck = "ev" + idx + "|" + d.id;
  const kids = [
    el("span", { class: "ic" }, (d.name.split(".").pop() || "").slice(0, 4).toUpperCase()),
    el("button", { type: "button", class: "nm", title: d.name, onclick: () => view(ev, j) }, d.name),
  ];
  if (canEdit && assets) {
    if (confirmRm[ck])
      kids.push(
        el(
          "span",
          { class: "confirm" },
          "Remove?",
          el(
            "button",
            {
              type: "button",
              class: "btn small",
              onclick: async () => {
                delete confirmRm[ck];
                const cur = job()?.data?.conds?.list?.[idx];
                if (cur) setCond(idx, { ev: (cur.ev || []).filter((x) => x.id !== d.id) });
                try {
                  await assets.delete(d.id);
                } catch (e) {}
              },
            },
            "Yes",
          ),
          el(
            "button",
            {
              type: "button",
              class: "btn small",
              onclick: () => {
                delete confirmRm[ck];
                render();
              },
            },
            "No",
          ),
        ),
      );
    else
      kids.push(
        el(
          "button",
          {
            type: "button",
            class: "rm",
            "aria-label": "Remove " + d.name,
            title: "Remove",
            onclick: () => {
              confirmRm[ck] = true;
              render();
            },
          },
          "×",
        ),
      );
  }
  return el("div", { class: "doc" }, kids);
}

function fileDrop(id, label, sub, onFiles, accept) {
  return el(
    "label",
    {
      class: "drop small",
      for: id,
      ondragover: (e) => {
        e.preventDefault();
        e.currentTarget.classList.add("over");
      },
      ondragleave: (e) => e.currentTarget.classList.remove("over"),
      ondrop: (e) => {
        e.preventDefault();
        e.currentTarget.classList.remove("over");
        onFiles([...e.dataTransfer.files]);
      },
    },
    el("input", {
      type: "file",
      multiple: true,
      id,
      class: "sr",
      accept: accept || ".pdf,.png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.txt,.csv",
      "aria-label": label,
      onchange: (e) => onFiles([...e.target.files]),
    }),
    el("b", {}, label),
    el("span", {}, sub),
  );
}

// ---------- feature survey (PDF + DWG) ----------
const DWG_MAX = 14 * 1024 * 1024; // wrapped as JSON, so it must stay under the 20 MB file limit
async function uploadSurvey(k, files) {
  if (!assets || !job() || !files.length) return;
  delete errors[k];
  const added = [],
    problems = [];
  for (const f of files) {
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    if (ext !== "pdf" && ext !== "dwg") {
      problems.push(`${f.name} isn’t a PDF or DWG`);
      continue;
    }
    if (ext === "dwg" && f.size > DWG_MAX) {
      problems.push(`${f.name} is larger than 14 MB – save a smaller copy (e.g. purge unused layers) and try again`);
      continue;
    }
    uploading[k] = true;
    render();
    try {
      let r;
      if (ext === "pdf") r = await assets.upload(f, { type: "application/pdf" });
      else {
        const b64 = await new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result).split(",")[1] || "");
          fr.onerror = rej;
          fr.readAsDataURL(f);
        });
        r = await assets.upload(
          new Blob([JSON.stringify({ name: f.name, type: "application/acad", b64 })], { type: "application/json" }),
          { type: "application/json" },
        );
      }
      added.push({
        id: r.id,
        name: f.name,
        type: ext === "pdf" ? "application/pdf" : "application/acad",
        size: f.size,
        at: new Date().toISOString(),
        kind: "survey",
        ...(ext === "dwg" ? { wrapped: true } : {}),
      });
    } catch (e) {
      problems.push(`${f.name} ${ERR[e?.code] || "couldn’t be uploaded (" + (e?.code || "error") + ")"}`);
    }
  }
  delete uploading[k];
  if (problems.length) errors[k] = problems.join(". ") + ".";
  if (added.length) patchItem(k, { docs: [...itemState(k).docs, ...added] });
  else render();
}
function surveyPanel(k, st, canEdit) {
  const docs = st.docs;
  const has = (ext) => docs.some((d) => d.name.toLowerCase().endsWith("." + ext));
  const chip = (ext, label) =>
    el(
      "span",
      { class: "req " + (has(ext) ? "ok" : "miss") },
      (has(ext) ? "✓ " : "") + label + (has(ext) ? " received" : " required"),
    );
  return el(
    "div",
    { class: "approval" },
    el(
      "div",
      { class: "folder-h" },
      el("span", { class: "folder-ic", "aria-hidden": "true" }),
      el("b", {}, "Feature survey"),
      el("span", { class: "n" }, docs.length ? `${docs.length} file${docs.length > 1 ? "s" : ""}` : "empty"),
    ),
    el("div", { class: "row wrap" }, chip("pdf", "PDF"), chip("dwg", "DWG")),
    docs.length
      ? el(
          "div",
          { class: "docs" },
          docs.map((d) => docRow(k, d, canEdit)),
        )
      : null,
    canEdit && assets
      ? fileDrop(
          "fs-" + k,
          uploading[k] ? "Uploading…" : "Drag and drop the feature survey PDF and DWG here",
          "both files are required – or click to choose",
          (files) => uploadSurvey(k, files),
          ".pdf,.dwg",
        )
      : null,
  );
}
// store-only ZIP so a DWG can be handed back through the allowed download types
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
// ---------- download every file for the job as one .zip, laid out like the page ----------
function zipMany(entries) {
  // entries: [{ name: 'folder/file.pdf', data: Uint8Array }] – stored, no compression
  const now = new Date(),
    enc = new TextEncoder();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const put = (dv, fields) =>
    fields.forEach(([o, v, s]) => (s === 4 ? dv.setUint32(o, v >>> 0, true) : dv.setUint16(o, v, true)));
  const parts = [],
    central = [];
  let off = 0;
  for (const e of entries) {
    const nm = enc.encode(e.name),
      crc = crc32(e.data),
      len = e.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    put(lh, [
      [0, 0x04034b50, 4],
      [4, 20, 2],
      [6, 0x0800, 2],
      [8, 0, 2],
      [10, time, 2],
      [12, date, 2],
      [14, crc, 4],
      [18, len, 4],
      [22, len, 4],
      [26, nm.length, 2],
      [28, 0, 2],
    ]);
    const ch = new DataView(new ArrayBuffer(46));
    put(ch, [
      [0, 0x02014b50, 4],
      [4, 20, 2],
      [6, 20, 2],
      [8, 0x0800, 2],
      [10, 0, 2],
      [12, time, 2],
      [14, date, 2],
      [16, crc, 4],
      [20, len, 4],
      [24, len, 4],
      [28, nm.length, 2],
      [30, 0, 2],
      [32, 0, 2],
      [34, 0, 2],
      [36, 0, 2],
      [38, 0, 4],
      [42, off, 4],
    ]);
    parts.push(lh, nm, e.data);
    central.push(ch, nm);
    off += 30 + nm.length + len;
  }
  const cdLen = central.reduce((n, p) => n + (p.byteLength ?? p.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  put(end, [
    [0, 0x06054b50, 4],
    [4, 0, 2],
    [6, 0, 2],
    [8, entries.length, 2],
    [10, entries.length, 2],
    [12, cdLen, 4],
    [16, off, 4],
    [20, 0, 2],
  ]);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}
const safeName = (s) =>
  String(s || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/, "")
    .trim()
    .slice(0, 90) || "file";
const pad2 = (n) => String(n).padStart(2, "0");
// every file on the job, with the folder it belongs in
function jobFileList() {
  const j = job();
  if (!j) return [];
  const out = [];
  WORKFLOW.forEach((s, si) => {
    const stage = `${pad2(si + 1)} ${safeName(s.name)}`;
    if (AGENCIES.includes(s.name)) {
      for (const c of (j.data.conds?.list || []).filter((c) => c.a === s.name))
        for (const d of c.ev || [])
          out.push({ d, folder: `${stage}/WAPC conditions/Condition ${safeName(c.n)} evidence` });
    }
    for (const i of s.items.filter((i) => i.n)) {
      const docs = j.data.items?.[key(i)]?.docs || [];
      for (const d of docs)
        out.push({ d, folder: `${stage}/${safeName(i.n + " " + i.t)}` + (d.kind === "email" ? "/Query emails" : "") });
    }
  });
  return out;
}
// ---------- job notes: extra information on the job for the surveyor or client ----------
let jobNotes = [],
  userNs = null;
const jnUi = { confirm: null, err: "" };
const JN_FOR = [
  ["all", "Everyone"],
  ["surveyor", "Surveyor"],
  ["client", "Client"],
];
function renderJobNotes() {
  const box = document.getElementById("jobnotes");
  if (!box) return;
  const j = job();
  box.hidden = !j;
  if (!j) return;
  if (!box.dataset.built) {
    // built once so a redraw never clears what is being typed
    box.dataset.built = "1";
    const ta = el("textarea", { id: "jnText", rows: "3", "aria-label": "New job note" });
    const who = el(
      "select",
      { id: "jnFor", "aria-label": "Note is for" },
      JN_FOR.map(([v, l]) => el("option", { value: v }, "For: " + l)),
    );
    const form = el(
      "form",
      {
        class: "dn-form",
        onsubmit: (e) => {
          e.preventDefault();
          addJobNote(ta.value, who.value).then((ok) => {
            if (ok) ta.value = "";
          });
        },
      },
      ta,
      el(
        "div",
        { class: "row wrap" },
        who,
        el("button", { type: "submit", class: "btn primary", id: "jnBtn", style: "margin-left:auto" }, "Add note"),
      ),
    );
    box.replaceChildren(
      el("div", { class: "pkg-t" }, el("b", {}, "Job notes"), el("span", { id: "jnSub" })),
      form,
      el("div", { id: "jnDyn", class: "acc" }),
    );
  }
  document.getElementById("jnSub").textContent = "Any notes relevant to the subdivision. Any party can post a note.";
  document.getElementById("jnBtn").disabled = !db || readOnly;
  const list = jobNotes.filter((n) => n.job === currentId).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const canDel = (n) => !readOnly && ((n.by && n.by === viewerId) || isKrStaff());
  document.getElementById("jnDyn").replaceChildren(
    ...[
      jnUi.err ? el("div", { class: "msg" }, jnUi.err) : null,
      list.length
        ? el(
            "ol",
            { class: "dn-list" },
            list.map((n) =>
              el(
                "li",
                {},
                el(
                  "div",
                  { class: "dn-meta" },
                  el(
                    "span",
                    {},
                    new Date(n.at).toLocaleString("en-AU", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    }),
                  ),
                  el(
                    "span",
                    { class: "jn-for " + (n.for || "all") },
                    "For " + (JN_FOR.find((x) => x[0] === n.for) || JN_FOR[0])[1].toLowerCase(),
                  ),
                  n.by ? el("span", { class: "jn-by", "data-uid": n.by }, n.by === viewerId ? "by you" : "") : null,
                  !canDel(n)
                    ? null
                    : jnUi.confirm === n.id
                      ? el(
                          "span",
                          { class: "confirm", style: "margin-left:auto" },
                          "Delete?",
                          el(
                            "button",
                            { type: "button", class: "btn small", onclick: () => deleteJobNote(n.id) },
                            "Yes",
                          ),
                          el(
                            "button",
                            {
                              type: "button",
                              class: "btn small",
                              onclick: () => {
                                jnUi.confirm = null;
                                renderJobNotes();
                              },
                            },
                            "No",
                          ),
                        )
                      : el(
                          "button",
                          {
                            type: "button",
                            class: "rm",
                            style: "margin-left:auto",
                            title: "Delete note",
                            "aria-label": "Delete note",
                            onclick: () => {
                              jnUi.confirm = n.id;
                              renderJobNotes();
                            },
                          },
                          "×",
                        ),
                ),
                el("div", { class: "dn-text" }, n.text),
              ),
            ),
          )
        : el("div", { class: "msg ok" }, "No notes on this job yet."),
    ].filter(Boolean),
  );
  // show who wrote each note (names are looked up, never stored)
  const ids = [...new Set(list.map((n) => n.by).filter((id) => id && id !== viewerId))];
  if (userNs && ids.length)
    userNs
      .profiles(ids)
      .then((ps) => {
        for (const s of document.querySelectorAll("#jnDyn .jn-by")) {
          const p = ps[s.dataset.uid];
          if (p && s.dataset.uid !== viewerId) s.textContent = p.name ? "by " + p.name : "";
        }
      })
      .catch(() => {});
}
async function addJobNote(text, forWho) {
  jnUi.err = "";
  text = String(text || "").trim();
  if (!text) {
    jnUi.err = "Type a note first.";
    renderJobNotes();
    return false;
  }
  if (!job()) return false;
  const ref = db.collection("jobnotes").doc();
  const rec = {
    job: currentId,
    jobNum: job().data.num || "",
    text,
    for: forWho || "all",
    at: new Date().toISOString(),
    by: viewerId || null,
  };
  jobNotes = [...jobNotes, { id: ref.id, ...rec }];
  renderJobNotes();
  try {
    await ref.set(rec);
    return true;
  } catch (e) {
    jobNotes = jobNotes.filter((n) => n.id !== ref.id);
    jnUi.err = "The note couldn’t be saved (" + (e?.code || "error") + "). Try again.";
    renderJobNotes();
    return false;
  }
}
async function deleteJobNote(id) {
  jnUi.confirm = null;
  const keep = jobNotes;
  jobNotes = jobNotes.filter((n) => n.id !== id);
  renderJobNotes();
  try {
    await db.doc("jobnotes/" + id).delete();
  } catch (e) {
    jobNotes = keep;
    jnUi.err = "The note couldn’t be deleted. Try again.";
    renderJobNotes();
  }
}

function jobSummaryText() {
  const j = job(),
    d = j.data,
    lines = [`${jobText(d)}`, `Downloaded ${new Date().toLocaleString("en-AU")}`, ""];
  if (d.conformed)
    lines.push(
      `Conformed date: ${fmtDate(d.conformed)}`,
      `WAPC outcome date: ${d.outcome ? fmtDate(d.outcome) : "–"}`,
      "",
    );
  WORKFLOW.forEach((s, si) => {
    lines.push(
      `${pad2(si + 1)} ${s.name.toUpperCase()}${agencyExcluded(s.name) ? "  (not required – no conditions in the Decision Letter)" : ""}`,
    );
    for (const i of s.items.filter((i) => i.n)) {
      const st = itemState(key(i));
      lines.push(`  ${i.n.padEnd(5)} ${STATUS_LABEL[st.s].padEnd(14)} ${i.t}`);
    }
    lines.push("");
  });
  const conds = d.conds?.list || [];
  if (conds.length) {
    lines.push("WAPC CONDITIONS");
    for (const c of conds)
      lines.push(
        `  ${String(c.n).padEnd(3)} ${c.done ? "Cleared" : "Open   "}  ${c.a}  –  ${c.t}`,
        ...((c.kr ?? c.cm) ? [`        KR comment: ${c.kr ?? c.cm}`] : []),
        ...(c.cl ? [`        Client comment: ${c.cl}`] : []),
      );
  }
  const notes = jobNotes.filter((n) => n.job === currentId).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  if (notes.length) {
    lines.push("", "JOB NOTES");
    for (const n of notes)
      lines.push(
        `  ${new Date(n.at).toLocaleString("en-AU")}  (for ${n.for || "all"})`,
        ...n.text.split("\n").map((t) => "    " + t),
      );
  }
  return lines.join("\r\n");
}
const pkgUi = { busy: false, msg: "" };
async function downloadPackage() {
  if (!downloads || pkgUi.busy) return;
  const list = jobFileList();
  if (!list.length) return;
  const j = job(),
    top = safeName(jobText({ num: j.data.num, addr: j.data.addr }));
  pkgUi.busy = true;
  pkgUi.msg = "";
  renderPackage();
  const entries = [],
    used = new Set(),
    failed = [];
  const unique = (p) => {
    let q = p,
      n = 2;
    const dot = p.lastIndexOf(".");
    while (used.has(q.toLowerCase()))
      q = dot > p.lastIndexOf("/") ? `${p.slice(0, dot)} (${n++})${p.slice(dot)}` : `${p} (${n++})`;
    used.add(q.toLowerCase());
    return q;
  };
  try {
    for (let n = 0; n < list.length; n++) {
      const { d, folder } = list[n];
      pkgUi.msg = `Collecting file ${n + 1} of ${list.length}…`;
      renderPackage();
      try {
        const res = await fetch(blobUrl(d.id));
        if (!res.ok) throw new Error("missing");
        let data;
        if (d.wrapped) {
          const w = await res.json();
          const bin = atob(w.b64);
          data = new Uint8Array(bin.length);
          for (let x = 0; x < bin.length; x++) data[x] = bin.charCodeAt(x);
        } else data = new Uint8Array(await res.arrayBuffer());
        entries.push({ name: unique(`${top}/${folder}/${safeName(d.name)}`), data });
      } catch (e) {
        failed.push(d.name);
      }
    }
    entries.unshift({ name: `${top}/Job summary.txt`, data: new TextEncoder().encode(jobSummaryText()) });
    pkgUi.msg = "Preparing the download…";
    renderPackage();
    await downloads.save({ filename: `${safeName(j.data.num)} – subdivision files.zip`, data: zipMany(entries) });
    pkgUi.msg =
      `Downloaded ${entries.length - 1} file${entries.length === 2 ? "" : "s"}` +
      (failed.length ? ` – ${failed.length} couldn’t be fetched: ${failed.join(", ")}` : "") +
      ".";
  } catch (e) {
    pkgUi.msg =
      e?.code === "declined"
        ? "Download cancelled."
        : e?.code === "too_large"
          ? "The package is too large to download in one go."
          : "The download couldn’t be prepared. Try again.";
  }
  pkgUi.busy = false;
  renderPackage();
}
// WAPC approval date and expiry, read from the Decision Letter (editable)
function renderApproval(j, canEdit) {
  const box = document.getElementById("appr");
  if (!box) return;
  const d = j?.data || {};
  const field = (id, label, val, onSet, extra) => {
    const inp = el("input", {
      type: "date",
      id,
      disabled: !canEdit,
      onchange: (e) => {
        if (e.target.value !== (val || "")) onSet(e.target.value);
      },
    });
    inp.value = val || "";
    return el("label", { class: "appr-f", for: id }, el("span", { class: "appr-l" }, label), inp, extra || null);
  };
  let left = null;
  if (d.expiry) {
    const days = Math.ceil((new Date(d.expiry + "T23:59:59") - Date.now()) / 864e5);
    left = el(
      "span",
      { class: "appr-d " + (days < 0 ? "past" : days < 180 ? "soon" : "ok") },
      days < 0
        ? `Expired ${-days} day${days === -1 ? "" : "s"} ago`
        : `${days.toLocaleString("en-AU")} day${days === 1 ? "" : "s"} left to lodge Form 1C`,
    );
  }
  box.replaceChildren(
    ...[
      field("apprDate", "WAPC approval date", d.approval, (v) => patchJob({ approval: v })),
      field("apprExp", "Approval expiry", d.expiry, (v) => patchJob({ expiry: v }), left),
      !d.approval && !d.expiry
        ? el(
            "span",
            { class: "appr-h" },
            "Filled in automatically when conditions are extracted from the Decision Letter in 5.0",
          )
        : null,
    ].filter(Boolean),
  );
}
// the letter date is the approval date; the expiry is "by the close of business on …" (or the letter date + the years it is valid for)
function findApprovalDates(lines) {
  const text = lines.join(" ").replace(/\s+/g, " ");
  const head = lines.slice(0, 40).join("\n");
  const approval = datesIn(head)[0] || null;
  let expiry = null;
  const m =
    /close of business on\s+([^.;]{6,30}?\d{4})/i.exec(text) ||
    /no longer be valid[^.]{0,40}?(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i.exec(text) ||
    /(?:expires?|expiry)[^.]{0,30}?(\d{1,2}\s+[A-Za-z]+\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/i.exec(text);
  if (m) expiry = datesIn(m[1])[0] || null;
  if (!expiry && approval) {
    const y = /valid for\s+(?:(one|two|three|four|five)\s*)?\(?(\d)?\)?\s*years?/i.exec(text);
    const words = { one: 1, two: 2, three: 3, four: 4, five: 5 };
    const n = y ? +y[2] || words[(y[1] || "").toLowerCase()] : 0;
    if (n) {
      const dt = new Date(approval + "T00:00:00Z");
      dt.setUTCFullYear(dt.getUTCFullYear() + n);
      expiry = dt.toISOString().slice(0, 10);
    }
  }
  return { approval, expiry };
}
// ---------- access list (ready for when the tracker has its own site) ----------
// Saved now as a list of who should get access; nothing is sent yet.
let invites = [];
let viewerEmail = null,
  viewerId = null,
  viewerKnown = false,
  viewerName = "",
  viewerMember = false;
const KR_DOMAIN = /@krsurveys\.com\.au$/i;
const isKrStaff = () => (viewerEmail ? KR_DOMAIN.test(viewerEmail) : viewerMember);
const accUi = { msg: "", err: "", confirm: null };
const ROLES = [
  ["client", "Client – sees their own job"],
  ["architect", "Architect – sees their own job"],
  ["staff", "KR Surveys staff – all jobs"],
];
const roleText = (r) => (ROLES.find((x) => x[0] === r) || [, r])[1].split(" – ")[0];
function renderAccess() {
  const box = document.getElementById("access");
  if (!box) return;
  // the typing boxes are built once and kept, so a redraw never clears what is being typed
  if (!box.dataset.built) {
    box.dataset.built = "1";
    const email = el("input", {
      type: "email",
      id: "accEmail",
      placeholder: "name@example.com",
      autocomplete: "off",
      "aria-label": "Email address",
    });
    const name = el("input", {
      type: "text",
      id: "accName",
      placeholder: "Name (optional)",
      autocomplete: "off",
      "aria-label": "Name",
    });
    const role = el(
      "select",
      { id: "accRole", "aria-label": "Role", onchange: () => renderAccess() },
      ROLES.map(([v, l]) => el("option", { value: v }, l)),
    );
    const jobPick = el("select", { id: "accJob", "aria-label": "Job" });
    const form = el(
      "form",
      {
        class: "acc-form",
        onsubmit: (e) => {
          e.preventDefault();
          addInvite(email.value, name.value, role.value, jobPick.value).then((ok) => {
            if (ok) {
              email.value = "";
              name.value = "";
            }
          });
        },
      },
      email,
      name,
      role,
      jobPick,
      el("button", { type: "submit", class: "btn primary", id: "accBtn" }, "Grant access"),
    );
    box.replaceChildren(
      el(
        "div",
        { class: "pkg-t" },
        el("b", {}, "Access manager"),
        el(
          "span",
          {},
          "Add the people who should be able to view a job – choose the job from the list. KR Surveys staff see all jobs. Access will be sent to them once the tracker moves to its own website – until then, share it from the Share menu (KR Surveys staff only). Read-only copy – list as at export.",
        ),
      ),
      form,
      el("span", { class: "acc-scope", id: "accScope" }),
      el("div", { id: "accDyn", class: "acc" }),
    );
  }
  // job picker: every job from the KR PROJECT TRACKER, open jobs first (keeps the choice across redraws)
  const pick = document.getElementById("accJob"),
    keepJob = pick.value;
  const byNum = (a, b) =>
    String(a.data.num || "").localeCompare(String(b.data.num || ""), undefined, { numeric: true });
  const real = jobs.filter((x) => x.data.source);
  const groups = [
    ["In progress", real.filter((x) => !jobDone(x)).sort(byNum)],
    ["Complete", real.filter((x) => jobDone(x)).sort(byNum)],
  ].filter((g) => g[1].length);
  pick.replaceChildren(
    el("option", { value: "" }, "Choose a job…"),
    ...groups.map(([l, list]) =>
      el(
        "optgroup",
        { label: l },
        list.map((x) => el("option", { value: x.id }, jobText(x.data))),
      ),
    ),
  );
  pick.value = real.some((x) => x.id === keepJob) ? keepJob : "";
  const isStaffRole = document.getElementById("accRole").value === "staff";
  pick.hidden = isStaffRole;
  document.getElementById("accScope").textContent = isStaffRole
    ? "KR Surveys staff get access to all jobs."
    : "Clients and architects only see the job you choose.";
  const staff = isKrStaff();
  document.querySelector("#access .acc-form").hidden = !staff;
  document.getElementById("accScope").hidden = !staff;
  document.getElementById("accBtn").disabled = !db || readOnly || !staff;
  const numOf = (v) => (v.job ? jobs.find((x) => x.id === v.job)?.data?.num || v.jobNum || v.job : "");
  const mine = [...invites].sort(
    (a, b) =>
      (a.role === "staff") - (b.role === "staff") ||
      String(numOf(a)).localeCompare(String(numOf(b)), undefined, { numeric: true }) ||
      a.email.localeCompare(b.email),
  );
  document.getElementById("accDyn").replaceChildren(
    ...[
      !staff
        ? el(
            "div",
            { class: "acc-lock" },
            !viewerKnown
              ? "Checking who you are…"
              : viewerEmail
                ? `Only KR Surveys staff with an @krsurveys.com.au email can add or remove people. You’re signed in as ${viewerEmail}.`
                : "Only KR Surveys staff can add or remove people. Your KR Surveys account couldn’t be confirmed – ask a KR Surveys staff member.",
          )
        : null,
      accUi.err ? el("div", { class: "msg" }, accUi.err) : null,
      accUi.msg ? el("div", { class: "msg ok" }, accUi.msg) : null,
      mine.length
        ? el(
            "ul",
            { class: "acc-list" },
            mine.map((v) =>
              el(
                "li",
                {},
                el("span", { class: "acc-e" }, v.name ? `${v.name} <${v.email}>` : v.email),
                el("span", { class: "acc-j" }, v.role === "staff" ? "All jobs" : numOf(v)),
                el("span", { class: "acc-r" }, roleText(v.role)),
                el("span", { class: "acc-s" }, "Pending"),
                !isKrStaff()
                  ? null
                  : accUi.confirm === v.id
                    ? el(
                        "span",
                        { class: "confirm" },
                        "Remove?",
                        el("button", { type: "button", class: "btn small", onclick: () => removeInvite(v.id) }, "Yes"),
                        el(
                          "button",
                          {
                            type: "button",
                            class: "btn small",
                            onclick: () => {
                              accUi.confirm = null;
                              renderAccess();
                            },
                          },
                          "No",
                        ),
                      )
                    : el(
                        "button",
                        {
                          type: "button",
                          class: "rm",
                          "aria-label": "Remove " + v.email,
                          title: "Remove",
                          disabled: readOnly,
                          onclick: () => {
                            accUi.confirm = v.id;
                            renderAccess();
                          },
                        },
                        "×",
                      ),
              ),
            ),
          )
        : null,
    ].filter(Boolean),
  );
}
async function addInvite(email, name, role, jobChoice) {
  accUi.err = "";
  accUi.msg = "";
  if (!isKrStaff()) {
    accUi.err = "Only KR Surveys staff can add people.";
    renderAccess();
    return false;
  }
  email = String(email || "")
    .trim()
    .toLowerCase();
  name = String(name || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    accUi.err = "Enter a valid email address, e.g. name@example.com.";
    renderAccess();
    document.getElementById("accEmail")?.focus();
    return false;
  }
  if (role !== "staff" && !jobChoice) {
    accUi.err = "Choose which job they should see.";
    renderAccess();
    document.getElementById("accJob")?.focus();
    return false;
  }
  const jobId = role === "staff" ? null : jobChoice;
  if (invites.some((v) => v.email === email && (v.job || null) === jobId)) {
    accUi.err = `${email} is already on the list for ${jobId ? jobs.find((x) => x.id === jobId)?.data?.num || "that job" : "all jobs"}.`;
    renderAccess();
    return false;
  }
  const ref = db.collection("access").doc();
  const rec = {
    email,
    name,
    role,
    job: jobId,
    jobNum: jobId ? jobs.find((x) => x.id === jobId)?.data?.num || "" : "",
    status: "pending",
    addedAt: new Date().toISOString(),
    addedBy: viewerId,
  };
  invites = [...invites, { id: ref.id, ...rec }];
  accUi.msg = `${email} added – access will be sent when the tracker moves to its own website.`;
  renderAccess();
  try {
    await ref.set(rec);
    return true;
  } catch (e) {
    invites = invites.filter((v) => v.id !== ref.id);
    accUi.msg = "";
    accUi.err = "That couldn’t be saved (" + (e?.code || "error") + "). Try again.";
    renderAccess();
    return false;
  }
}
async function removeInvite(id) {
  accUi.confirm = null;
  if (!isKrStaff()) return;
  const keep = invites;
  invites = invites.filter((v) => v.id !== id);
  renderAccess();
  try {
    await db.doc("access/" + id).delete();
  } catch (e) {
    invites = keep;
    accUi.err = "That couldn’t be removed. Try again.";
    renderAccess();
  }
}

// ---------- save what is on screen as a PDF (the page can't open the print dialog) ----------
let pdfLibsP = null;
function loadPdfLibs() {
  const add = (src) =>
    new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = res;
      s.onerror = () => rej(new Error("load"));
      document.head.append(s);
    });
  return (pdfLibsP ||= Promise.all([
    add("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"),
    add("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"),
  ]).catch((e) => {
    pdfLibsP = null;
    throw e;
  }));
}
async function saveScreenAsPdf(btn) {
  const label = btn.textContent;
  const done = (t) => {
    btn.textContent = t;
    btn.disabled = false;
    setTimeout(() => {
      btn.textContent = label;
    }, 4000);
  };
  if (!downloads) {
    done("Downloads unavailable");
    return;
  }
  btn.disabled = true;
  btn.textContent = "Preparing PDF…";
  try {
    await loadPdfLibs();
    const root = document.body,
      scale = 1.5;
    // break pages between boxes, not through them
    const top0 = root.getBoundingClientRect().top;
    const breaks = [
      ...document.querySelectorAll(
        "header.top, .jobbar, .summary, .stage-tools, section.stage > .stage-bar, .card, .outcome, .note, .acond, .ev-c, .pkg, footer",
      ),
    ]
      .filter((e) => e.offsetParent !== null)
      .map((e) => (e.getBoundingClientRect().bottom - top0 + 4) * scale)
      .sort((a, b) => a - b);
    const canvas = await window.html2canvas(root, {
      scale,
      useCORS: true,
      logging: false,
      backgroundColor: getComputedStyle(root).backgroundColor,
      ignoreElements: (e) => e.id === "viewer" || e.classList?.contains("no-pdf"),
    });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
    const pw = 210,
      ph = 297,
      pageH = Math.floor((canvas.width * ph) / pw);
    let y = 0,
      first = true;
    while (y < canvas.height - 2) {
      let end = Math.min(y + pageH, canvas.height);
      if (end < canvas.height) {
        const b = breaks.filter((v) => v > y + pageH * 0.5 && v <= y + pageH).pop();
        if (b) end = Math.round(b);
      }
      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = end - y;
      const ctx = slice.getContext("2d");
      ctx.fillStyle = getComputedStyle(root).backgroundColor;
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, y, canvas.width, end - y, 0, 0, canvas.width, end - y);
      if (!first) pdf.addPage();
      first = false;
      pdf.addImage(slice.toDataURL("image/jpeg", 0.88), "JPEG", 0, 0, pw, ((end - y) * pw) / canvas.width);
      y = end;
    }
    const j = job(),
      stamp = new Date().toISOString().slice(0, 10);
    await downloads.save({
      filename: `${safeName(j ? j.data.num : "Subdivision tracker")} – subdivision tracker ${stamp}.pdf`,
      data: pdf.output("blob"),
    });
    done("Saved");
  } catch (e) {
    done(
      e?.code === "declined"
        ? label
        : e?.code === "extension_not_enabled" || e?.code === "rejected_extension"
          ? "PDF downloads are off here"
          : e?.message === "load"
            ? "Couldn’t load – try again"
            : "PDF failed – try again",
    );
  }
}

// ===== TEMP-DEV-NOTES (start) – temporary developer notes. Remove this block, the #devnotes section,
// ===== its call in renderInner() and the 'devnotes' listener at boot before going live. =====
let devNotes = [];
const dnUi = { confirm: null, err: "" };
function renderDevNotes() {
  const box = document.getElementById("devnotes");
  if (!box) return;
  if (!box.dataset.built) {
    // built once so a redraw never clears what is being typed
    box.dataset.built = "1";
    const ta = el("textarea", {
      id: "dnText",
      rows: "3",
      placeholder: "e.g. 6.8 – the clearance email box should also accept .msg files",
      "aria-label": "New note for the developer",
    });
    const form = el(
      "form",
      {
        class: "dn-form",
        onsubmit: (e) => {
          e.preventDefault();
          addDevNote(ta.value).then((ok) => {
            if (ok) ta.value = "";
          });
        },
      },
      ta,
      el(
        "div",
        { class: "row wrap" },
        el(
          "label",
          { class: "dn-job" },
          el("input", { type: "checkbox", id: "dnJob" }),
          el("span", { id: "dnJobLbl" }, "About this job"),
        ),
        el("button", { type: "submit", class: "btn primary", id: "dnBtn", style: "margin-left:auto" }, "Add note"),
      ),
    );
    box.replaceChildren(
      el(
        "div",
        { class: "pkg-t" },
        el("b", {}, "Developer notes"),
        el("span", { class: "dn-temp" }, "TEMPORARY"),
        el(
          "span",
          {},
          "Notes for the developer finishing this tracker. This box and its notes will be removed before the tracker goes live. Read-only copy – notes as at export.",
        ),
      ),
      form,
      el("div", { id: "dnDyn", class: "acc" }),
    );
  }
  const j = job();
  document.getElementById("dnJobLbl").textContent = j ? `About this job (${j.data.num || "job"})` : "About this job";
  document.getElementById("dnBtn").disabled = !db || readOnly;
  const list = [...devNotes].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  document.getElementById("dnDyn").replaceChildren(
    ...[
      dnUi.err ? el("div", { class: "msg" }, dnUi.err) : null,
      list.length
        ? el(
            "ol",
            { class: "dn-list" },
            list.map((n) =>
              el(
                "li",
                {},
                el(
                  "div",
                  { class: "dn-meta" },
                  el(
                    "span",
                    {},
                    new Date(n.at).toLocaleString("en-AU", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    }),
                  ),
                  n.jobNum ? el("span", { class: "agency" }, n.jobNum) : null,
                  n.by && n.by === viewerId ? el("span", {}, "by you") : null,
                  dnUi.confirm === n.id
                    ? el(
                        "span",
                        { class: "confirm", style: "margin-left:auto" },
                        "Delete?",
                        el("button", { type: "button", class: "btn small", onclick: () => deleteDevNote(n.id) }, "Yes"),
                        el(
                          "button",
                          {
                            type: "button",
                            class: "btn small",
                            onclick: () => {
                              dnUi.confirm = null;
                              renderDevNotes();
                            },
                          },
                          "No",
                        ),
                      )
                    : el(
                        "button",
                        {
                          type: "button",
                          class: "rm",
                          style: "margin-left:auto",
                          title: "Delete note",
                          "aria-label": "Delete note",
                          disabled: readOnly,
                          onclick: () => {
                            dnUi.confirm = n.id;
                            renderDevNotes();
                          },
                        },
                        "×",
                      ),
                ),
                el("div", { class: "dn-text" }, n.text),
              ),
            ),
          )
        : el("div", { class: "msg ok" }, "No notes yet."),
    ].filter(Boolean),
  );
}
async function addDevNote(text) {
  dnUi.err = "";
  text = String(text || "").trim();
  if (!text) {
    dnUi.err = "Type a note first.";
    renderDevNotes();
    return false;
  }
  const withJob = document.getElementById("dnJob")?.checked && job();
  const ref = db.collection("devnotes").doc();
  const rec = {
    text,
    at: new Date().toISOString(),
    by: viewerId || null,
    job: withJob ? currentId : null,
    jobNum: withJob ? job()?.data?.num || "" : "",
  };
  devNotes = [...devNotes, { id: ref.id, ...rec }];
  renderDevNotes();
  try {
    await ref.set(rec);
    return true;
  } catch (e) {
    devNotes = devNotes.filter((n) => n.id !== ref.id);
    dnUi.err = "The note couldn’t be saved (" + (e?.code || "error") + "). Try again.";
    renderDevNotes();
    return false;
  }
}
async function deleteDevNote(id) {
  dnUi.confirm = null;
  const keep = devNotes;
  devNotes = devNotes.filter((n) => n.id !== id);
  renderDevNotes();
  try {
    await db.doc("devnotes/" + id).delete();
  } catch (e) {
    devNotes = keep;
    dnUi.err = "The note couldn’t be deleted. Try again.";
    renderDevNotes();
  }
}
// ===== TEMP-DEV-NOTES (end) =====

// ---------- dashboard: every job at a glance, with what needs actioning next ----------
let dashView = "tracker";
try {
  if (localStorage.getItem("kr-wf-view") === "dashboard") dashView = "dashboard";
} catch (e) {}
const dashUi = { filter: "progress", q: "", type: "" };
// subdivision types, matched loosely against the tracker's "Subdivision - …" wording
const SUB_TYPES = ["Survey-Strata", "Built Strata", "Amalgamation", "Freehold", "Strata Conversion", "Re-Subdivision"];
const typeKey = (t) =>
  String(t || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
const RESP_LABEL = { KR: "KR Surveys", CL: "Client", AR: "Architect", "": "Unassigned" };
const jobDone = (j) => j.data.items?.[DONE_KEY]?.s === "c";
function jobSummary(j) {
  let c = 0,
    x = 0,
    n = 0;
  for (const i of ALL) {
    const s = itemState(key(i), j).s;
    if (s === "c") c++;
    else if (s === "x") x++;
    else n++;
  }
  const tot = ALL.length;
  // Reporting follows the job in phases:
  //  1. Preliminaries, then WAPC Approval – one next item at a time, in order
  //  2. the agency stages (between WAPC Approval and WAPC) run side by side – the first open item in each
  //  3. WAPC, Survey, Landgate, Titles – one next item at a time, in order
  const firstOpen = (s) => s.items.find((i) => i.n && itemState(key(i), j).s === "n");
  const pick = (s) => {
    const i = firstOpen(s);
    return { i, stage: s.name, r: itemState(key(i), j).r };
  };
  const iWapc = WORKFLOW.findIndex((s) => s.name === "WAPC Approval"),
    iAfter = WORKFLOW.findIndex((s) => s.name === "WAPC");
  const before = WORKFLOW.slice(0, iWapc + 1),
    agencies = WORKFLOW.slice(iWapc + 1, iAfter),
    after = WORKFLOW.slice(iAfter);
  const next = [];
  const seqStage = before.find((s) => firstOpen(s));
  if (seqStage) next.push(pick(seqStage));
  else {
    const open = agencies.filter((s) => !agencyExcluded(s.name, j) && firstOpen(s));
    if (open.length) next.push(...open.map(pick));
    else {
      const s = after.find((s) => firstOpen(s));
      if (s) next.push(pick(s));
    }
  }
  // things worth flagging
  const alerts = [],
    d = j.data,
    today = Date.now();
  if (d.expiry) {
    const days = Math.ceil((new Date(d.expiry + "T23:59:59") - today) / 864e5);
    if (days < 0) alerts.push({ t: `WAPC approval expired ${fmtDate(d.expiry)}`, lvl: "bad" });
    else if (days < 180)
      alerts.push({ t: `WAPC approval expires in ${days} days (${fmtDate(d.expiry)})`, lvl: "warn" });
  }
  if (d.outcome && itemState("i5_0", j).s === "n") {
    const days = Math.ceil((new Date(d.outcome + "T23:59:59") - today) / 864e5);
    if (days < 0)
      alerts.push({ t: `WAPC outcome date passed ${fmtDate(d.outcome)} – no approval recorded`, lvl: "bad" });
    else if (days <= 14) alerts.push({ t: `WAPC outcome due in ${days} days`, lvl: "warn" });
  }
  for (const i of ALL) {
    const st = itemState(key(i), j);
    if (i.approval && st.dec?.v === "declined" && st.s === "n")
      alerts.push({ t: `Client declined the ${i.approval.noun} (${i.n})`, lvl: "bad" });
  }
  const guessed = (d.conds?.list || []).filter((c) => c.guessed).length;
  if (guessed)
    alerts.push({ t: `${guessed} condition${guessed > 1 ? "s" : ""} need their agency checked`, lvl: "warn" });
  return { c, x, n, tot, pct: Math.round(((c + x) / tot) * 100), next, alerts };
}
function setView(v) {
  dashView = v;
  try {
    localStorage.setItem("kr-wf-view", v);
  } catch (e) {}
  document.body.classList.toggle("dash-view", v === "dashboard");
  $("#dashBtn").textContent = v === "dashboard" ? "← Back to tracker" : "Dashboard";
  window.scrollTo(0, 0);
  render();
}
function openJob(id) {
  currentId = id;
  try {
    localStorage.setItem("kr-wf-job", id);
  } catch (e) {}
  setView("tracker");
}
function renderDashboard() {
  const box = document.getElementById("dash");
  if (!box) return;
  document.body.classList.toggle("dash-view", dashView === "dashboard");
  if (dashView !== "dashboard") return;
  if (!box.dataset.built) {
    // the search box is built once so a redraw never clears it
    box.dataset.built = "1";
    const q = el("input", {
      type: "search",
      id: "dashQ",
      placeholder: "Search job, address or client",
      "aria-label": "Search jobs",
      oninput: (e) => {
        dashUi.q = e.target.value;
        renderDashboard();
      },
    });
    box.replaceChildren(
      el(
        "div",
        { class: "dash-head" },
        el("h2", {}, "Subdivision dashboard"),
        el(
          "div",
          { class: "dash-tools" },
          el("div", { class: "seg dash-filter", id: "dashFilter", role: "group", "aria-label": "Show" }),
          q,
        ),
        el("div", { class: "dash-types", id: "dashTypes", role: "group", "aria-label": "Subdivision type" }),
      ),
      el("div", { id: "dashSum", class: "dash-sum" }),
      el("div", { id: "dashGrid", class: "dash-grid" }),
    );
  }
  const real = jobs.filter((j) => j.data.source);
  const all = real.map((j) => ({ j, s: jobSummary(j), done: jobDone(j) }));
  const counts = {
    progress: all.filter((x) => !x.done).length,
    complete: all.filter((x) => x.done).length,
    all: all.length,
  };
  $("#dashFilter").replaceChildren(
    ...[
      ["progress", "In progress"],
      ["complete", "Complete"],
      ["all", "All"],
    ].map(([v, l]) =>
      el(
        "button",
        {
          type: "button",
          "aria-pressed": String(dashUi.filter === v),
          onclick: () => {
            dashUi.filter = v;
            renderDashboard();
          },
        },
        `${l} (${counts[v]})`,
      ),
    ),
  );
  const q = dashUi.q.trim().toLowerCase();
  const inStatus = (x) => dashUi.filter === "all" || (dashUi.filter === "complete") === x.done;
  $("#dashTypes").replaceChildren(
    el("span", { class: "dt-l" }, "Type"),
    ...[["", "All types"], ...SUB_TYPES.map((t) => [typeKey(t), t])].map(([v, l]) => {
      const n = all.filter((x) => inStatus(x) && (!v || typeKey(x.j.data.type) === v)).length;
      return el(
        "button",
        {
          type: "button",
          class: "dt",
          "aria-pressed": String(dashUi.type === v),
          onclick: () => {
            dashUi.type = dashUi.type === v ? "" : v;
            renderDashboard();
          },
        },
        l,
        el("span", { class: "dt-n" }, String(n)),
      );
    }),
  );
  const shown = all
    .filter(
      (x) =>
        inStatus(x) &&
        (!dashUi.type || typeKey(x.j.data.type) === dashUi.type) &&
        (!q || jobText(x.j.data).toLowerCase().includes(q)),
    )
    .sort(
      (a, b) =>
        b.s.alerts.length - a.s.alerts.length ||
        String(a.j.data.num).localeCompare(String(b.j.data.num), undefined, { numeric: true }),
    );
  const withClient = all.filter((x) => !x.done && x.s.next.some((nx) => nx.r === "CL")).length,
    flagged = all.filter((x) => x.s.alerts.length).length;
  $("#dashSum").replaceChildren(
    el("span", { class: "cnt n" }, el("b", {}, String(counts.progress)), "In progress"),
    el("span", { class: "cnt c" }, el("b", {}, String(counts.complete)), "Complete"),
    el("span", { class: "cnt w" }, el("b", {}, String(withClient)), "Waiting on client"),
    el("span", { class: "cnt x" }, el("b", {}, String(flagged)), "Need attention"),
  );
  $("#dashGrid").replaceChildren(
    ...(shown.length
      ? shown.map(({ j, s, done }) => {
          const d = j.data;
          return el(
            "article",
            { class: "dcard" + (done ? " done" : "") },
            el(
              "div",
              { class: "dc-top" },
              el("b", { class: "dc-num" }, d.num || j.id),
              el("span", { class: "dc-state " + (done ? "c" : "n") }, done ? "Complete" : "In progress"),
              el("span", { class: "dc-pct" }, s.pct + "%"),
            ),
            el("div", { class: "dc-addr" }, d.addr || ""),
            el("div", { class: "dc-meta" }, [d.client, d.type].filter(Boolean).join(" · ")),
            el(
              "div",
              {
                class: "bar dc-bar",
                role: "img",
                "aria-label": `${s.c} completed, ${s.x} not required, ${s.n} not completed`,
              },
              el("i", { class: "g", style: `width:${(s.c / s.tot) * 100}%` }),
              el("i", { class: "x", style: `width:${(s.x / s.tot) * 100}%` }),
              el("i", { class: "n", style: `width:${(s.n / s.tot) * 100}%` }),
            ),
            el(
              "div",
              { class: "dc-note" },
              el("div", { class: "dc-note-h" }, done ? "All done" : "Next to action"),
              s.alerts.length
                ? el(
                    "ul",
                    { class: "dc-alerts" },
                    s.alerts.map((a) => el("li", { class: a.lvl }, a.t)),
                  )
                : null,
              done
                ? el("div", { class: "dc-empty" }, "Plan in order for dealings – nothing left to action.")
                : s.next.length
                  ? el(
                      "ul",
                      { class: "dc-next" },
                      s.next
                        .slice(0, 4)
                        .map((nx) =>
                          el(
                            "li",
                            {},
                            el("span", { class: "dc-n" }, nx.i.n),
                            el("span", { class: "dc-t" }, nx.i.t),
                            el("span", { class: "dc-who " + (nx.r || "none") }, RESP_LABEL[nx.r] || nx.r),
                          ),
                        ),
                    )
                  : el(
                      "div",
                      { class: "dc-empty" },
                      "Everything open is marked – check 12.3 Plan in order for dealings.",
                    ),
              !done && s.next.length > 4
                ? el(
                    "div",
                    { class: "dc-more" },
                    `+ ${s.next.length - 4} more stage${s.next.length - 4 > 1 ? "s" : ""} with open items`,
                  )
                : null,
            ),
            el("button", { type: "button", class: "btn small dc-open", onclick: () => openJob(j.id) }, "Open job →"),
          );
        })
      : [el("div", { class: "dc-none" }, "No jobs match.")]),
  );
}

function renderPackage() {
  const box = document.getElementById("pkg");
  if (!box) return;
  const n = jobFileList().length;
  box.hidden = !job();
  box.replaceChildren(
    ...[
      el(
        "div",
        { class: "pkg-t" },
        el("b", {}, "Job files"),
        el(
          "span",
          {},
          n ? `${n} file${n > 1 ? "s" : ""} across the stages above` : "No files uploaded to this job yet",
        ),
      ),
      downloads
        ? el(
            "button",
            { type: "button", class: "btn primary", disabled: pkgUi.busy || !n, onclick: downloadPackage },
            pkgUi.busy ? "Preparing…" : "Download all files (.zip)",
          )
        : el("span", { class: "msg ok" }, "Downloads aren’t available in this view."),
      pkgUi.msg ? el("div", { class: "msg ok pkg-m" }, pkgUi.msg) : null,
    ].filter(Boolean),
  );
}

function zipOne(name, data) {
  const nm = new TextEncoder().encode(name),
    crc = crc32(data),
    now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const put = (dv, fields) =>
    fields.forEach(([o, v, s]) => (s === 4 ? dv.setUint32(o, v >>> 0, true) : dv.setUint16(o, v, true)));
  const lh = new DataView(new ArrayBuffer(30)),
    ch = new DataView(new ArrayBuffer(46)),
    end = new DataView(new ArrayBuffer(22));
  put(lh, [
    [0, 0x04034b50, 4],
    [4, 20, 2],
    [6, 0x0800, 2],
    [8, 0, 2],
    [10, time, 2],
    [12, date, 2],
    [14, crc, 4],
    [18, data.length, 4],
    [22, data.length, 4],
    [26, nm.length, 2],
    [28, 0, 2],
  ]);
  put(ch, [
    [0, 0x02014b50, 4],
    [4, 20, 2],
    [6, 20, 2],
    [8, 0x0800, 2],
    [10, 0, 2],
    [12, time, 2],
    [14, date, 2],
    [16, crc, 4],
    [20, data.length, 4],
    [24, data.length, 4],
    [28, nm.length, 2],
    [30, 0, 2],
    [32, 0, 2],
    [34, 0, 2],
    [36, 0, 2],
    [38, 0, 4],
    [42, 0, 4],
  ]);
  const cdOff = 30 + nm.length + data.length,
    cdLen = 46 + nm.length;
  put(end, [
    [0, 0x06054b50, 4],
    [4, 0, 2],
    [6, 0, 2],
    [8, 1, 2],
    [10, 1, 2],
    [12, cdLen, 4],
    [16, cdOff, 4],
    [20, 0, 2],
  ]);
  return new Blob([lh, nm, data, ch, nm, end], { type: "application/zip" });
}
async function downloadWrapped(d, btn) {
  if (!downloads) return;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Preparing…";
  try {
    const w = await (await fetch(blobUrl(d.id))).json();
    const bin = atob(w.b64),
      u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    await downloads.save({ filename: d.name.replace(/\.dwg$/i, "") + ".zip", data: zipOne(w.name || d.name, u8) });
    btn.textContent = "Downloaded";
  } catch (e) {
    btn.textContent = e?.code === "declined" ? label : "Download failed – try again";
  }
  btn.disabled = false;
}

function clearancePanel(k, st, canEdit, agency) {
  return el(
    "div",
    { class: "approval" },
    el(
      "div",
      { class: "folder-h" },
      el("span", { class: "folder-ic", "aria-hidden": "true" }),
      el("b", {}, agency + " clearance"),
      el(
        "span",
        { class: "n" },
        st.docs.length ? `${st.docs.length} file${st.docs.length > 1 ? "s" : ""}` : "not received yet",
      ),
      st.docs.length > 1
        ? el(
            "button",
            { type: "button", class: "btn small", style: "margin-left:auto", onclick: () => view(st.docs, 0) },
            "Open all",
          )
        : null,
    ),
    st.docs.length
      ? el(
          "div",
          { class: "docs" },
          st.docs.map((d) => docRow(k, d, canEdit)),
        )
      : null,
    canEdit && assets
      ? fileDrop(
          "cl-" + k,
          uploading[k] ? "Uploading…" : `Drag and drop the ${agency} clearance here`,
          "PDF or image – or click to choose",
          (files) => upload(k, files),
        )
      : null,
  );
}

// several required files, each with its own drop box (e.g. clearance PDF + clearance email)
function slotsPanel(k, st, canEdit, agency, slots, title) {
  const other = st.docs.filter((d) => !slots.some((s) => s.kind === d.kind));
  return el(
    "div",
    { class: "approval" },
    el(
      "div",
      { class: "folder-h" },
      el("span", { class: "folder-ic", "aria-hidden": "true" }),
      el("b", {}, title || agency + " clearance"),
      el(
        "span",
        { class: "n" },
        st.docs.length ? `${st.docs.length} file${st.docs.length > 1 ? "s" : ""}` : "not received yet",
      ),
    ),
    el(
      "div",
      { class: "row wrap" },
      slots.map((s) => {
        const got = st.docs.some((d) => d.kind === s.kind);
        return el(
          "span",
          { class: "req " + (got ? "ok" : "miss") },
          (got ? "✓ " : "") + s.label + (got ? " received" : " required"),
        );
      }),
    ),
    slots.map((s) => {
      const docs = st.docs.filter((d) => d.kind === s.kind);
      return el(
        "div",
        { class: "folder slot" },
        el("div", { class: "slot-t" }, s.label),
        docs.length
          ? el(
              "div",
              { class: "docs" },
              docs.map((d) => docRow(k, d, canEdit)),
            )
          : null,
        canEdit && assets
          ? fileDrop(
              "sl-" + s.kind + "-" + k,
              uploading[k] ? "Uploading…" : s.drop,
              s.images ? "PDF or photo – or click to choose" : "PDF – or click to choose",
              (files) => upload(k, files, { kind: s.kind }),
              s.images ? ".pdf,.jpg,.jpeg,.png,.webp" : ".pdf",
            )
          : null,
      );
    }),
    other.length
      ? el(
          "div",
          { class: "folder slot" },
          el("div", { class: "slot-t" }, "Other files"),
          el(
            "div",
            { class: "docs" },
            other.map((d) => docRow(k, d, canEdit)),
          ),
        )
      : null,
  );
}

function singleDropPanel(k, st, canEdit, title, label, accept) {
  return el(
    "div",
    { class: "approval" },
    el(
      "div",
      { class: "folder-h" },
      el("span", { class: "folder-ic", "aria-hidden": "true" }),
      el("b", {}, title),
      el(
        "span",
        { class: "n" },
        st.docs.length ? `${st.docs.length} file${st.docs.length > 1 ? "s" : ""}` : "not received yet",
      ),
    ),
    st.docs.length
      ? el(
          "div",
          { class: "docs" },
          st.docs.map((d) => docRow(k, d, canEdit)),
        )
      : null,
    canEdit && assets
      ? fileDrop(
          "sd-" + k,
          uploading[k] ? "Uploading…" : label,
          accept === "any"
            ? "PDF, photo or text file – drop several at once, or click to choose"
            : "PDF – or click to choose",
          (files) => upload(k, files),
          accept === "any" ? undefined : ".pdf",
        )
      : null,
  );
}

// photos show as thumbnails; click one to page through them all
function photoPanel(k, st, canEdit, title, label) {
  const pics = st.docs.filter((d) => d.type?.startsWith("image/")),
    other = st.docs.filter((d) => !d.type?.startsWith("image/"));
  return el(
    "div",
    { class: "approval" },
    el(
      "div",
      { class: "folder-h" },
      el("span", { class: "folder-ic", "aria-hidden": "true" }),
      el("b", {}, title),
      el("span", { class: "n" }, pics.length ? `${pics.length} photo${pics.length > 1 ? "s" : ""}` : "none yet"),
      pics.length > 1
        ? el(
            "button",
            { type: "button", class: "btn small", style: "margin-left:auto", onclick: () => view(pics, 0) },
            "View all",
          )
        : null,
    ),
    pics.length
      ? el(
          "div",
          { class: "thumbs" },
          pics.map((d, j) =>
            el(
              "button",
              { type: "button", class: "thumb", title: d.name, onclick: () => view(pics, j) },
              el("img", { src: blobUrl(d.id), alt: d.name, loading: "lazy" }),
            ),
          ),
        )
      : null,
    pics.length && canEdit && assets
      ? el(
          "div",
          { class: "docs" },
          pics.map((d) => docRow(k, d, canEdit)),
        )
      : null,
    other.length
      ? el(
          "div",
          { class: "docs" },
          other.map((d) => docRow(k, d, canEdit)),
        )
      : null,
    canEdit && assets
      ? fileDrop(
          "ph-" + k,
          uploading[k] ? "Uploading…" : label,
          "JPG, PNG or WebP photos – drop several at once, or click to choose",
          (files) => upload(k, files),
          ".jpg,.jpeg,.png,.webp,.gif",
        )
      : null,
  );
}

function dropSlot(k, D, docs, canEdit) {
  const id = "dz-" + k;
  const zone =
    canEdit && assets
      ? el(
          "label",
          {
            class: "drop",
            for: id,
            ondragover: (e) => {
              e.preventDefault();
              e.currentTarget.classList.add("over");
            },
            ondragleave: (e) => e.currentTarget.classList.remove("over"),
            ondrop: (e) => {
              e.preventDefault();
              e.currentTarget.classList.remove("over");
              upload(k, [...e.dataTransfer.files], { kind: D.kind });
            },
          },
          el("input", {
            type: "file",
            multiple: true,
            id,
            class: "sr",
            accept: ".pdf,.png,.jpg,.jpeg,.gif,.webp",
            "aria-label": D.label,
            onchange: (e) => upload(k, [...e.target.files], { kind: D.kind }),
          }),
          el("b", {}, uploading[k] ? "Uploading…" : D.label),
          el("span", {}, D.sub),
        )
      : null;
  return el(
    "div",
    { class: "folder" },
    el(
      "div",
      { class: "folder-h" },
      el("span", { class: "folder-ic", "aria-hidden": "true" }),
      el("b", {}, D.title),
      el(
        "span",
        { class: "n" },
        docs.length ? `${docs.length} file${docs.length > 1 ? "s" : ""} received` : "not received yet",
      ),
    ),
    docs.length
      ? el(
          "div",
          { class: "docs" },
          docs.map((d) => docRow(k, d, canEdit)),
        )
      : null,
    zone,
  );
}

async function upload(k, files, extra) {
  if (!files.length || !job()) return;
  delete errors[k];
  const added = [],
    problems = [];
  for (const f of files) {
    const type = TYPES[(f.name.split(".").pop() || "").toLowerCase()];
    if (!type) {
      problems.push(`${f.name} isn’t a supported type (use PDF, image, video or text)`);
      continue;
    }
    uploading[k] = true;
    render();
    try {
      const r = await assets.upload(f, { type });
      added.push({
        id: r.id,
        name: f.name,
        type: r.contentType,
        size: r.sizeBytes,
        at: new Date().toISOString(),
        ...(extra || {}),
      });
    } catch (e) {
      problems.push(`${f.name} ${ERR[e?.code] || "couldn’t be uploaded (" + (e?.code || "error") + ")"}`);
    }
  }
  delete uploading[k];
  if (problems.length) errors[k] = problems.join(". ") + ".";
  if (added.length) patchItem(k, { docs: [...itemState(k).docs, ...added] });
  else render();
}

async function removeDoc(k, d) {
  delete confirmRm[k + "|" + d.id];
  patchItem(k, { docs: itemState(k).docs.filter((x) => x.id !== d.id) });
  try {
    await assets.delete(d.id);
  } catch (e) {
    /* pointer already removed; orphan is harmless */
  }
}

// ---------- viewer ----------
let vList = [],
  vIdx = 0;
async function view(list, idx) {
  vList = list;
  vIdx = idx;
  const d = list[idx];
  $("#vPos").textContent = list.length > 1 ? idx + 1 + " of " + list.length : "";
  $("#vPrev").hidden = $("#vNext").hidden = list.length < 2;
  $("#vPrev").disabled = idx === 0;
  $("#vNext").disabled = idx === list.length - 1;
  const url = blobUrl(d.id);
  $("#vName").textContent = d.name;
  $("#vOpen").href = url;
  const body = $("#vBody");
  $("#vOpen").hidden = !!d.wrapped;
  if (d.wrapped)
    body.replaceChildren(
      el(
        "div",
        { class: "dwg-msg" },
        el("b", {}, "DWG drawings can’t be previewed in the browser"),
        el("span", {}, "Download it and open it in your CAD software."),
        downloads
          ? el(
              "button",
              { type: "button", class: "btn primary", onclick: (e) => downloadWrapped(d, e.currentTarget) },
              "Download " + d.name + " (.zip)",
            )
          : el("span", { class: "msg" }, "Downloads aren’t available in this view."),
      ),
    );
  else if (d.type?.startsWith("image/")) body.replaceChildren(el("img", { src: url, alt: d.name }));
  else if (d.type?.startsWith("video/"))
    body.replaceChildren(el("video", { src: url, controls: true, style: "max-width:100%;max-height:100%" }));
  else if (d.type === "application/pdf") body.replaceChildren(el("iframe", { src: url, title: d.name }));
  else {
    const pre = el("pre", {}, "Loading…");
    body.replaceChildren(pre);
    try {
      pre.textContent = await (await fetch(url)).text();
    } catch (e) {
      pre.textContent = "Couldn’t load this file. Use “Open in new tab”.";
    }
  }
  const dlg = $("#viewer");
  if (!dlg.open) {
    if (dlg.showModal) dlg.showModal();
    else dlg.setAttribute("open", "");
  }
}
$("#vPrev").onclick = () => {
  if (vIdx > 0) view(vList, vIdx - 1);
};
$("#vNext").onclick = () => {
  if (vIdx < vList.length - 1) view(vList, vIdx + 1);
};
$("#vClose").onclick = () => {
  $("#viewer").close();
  $("#vBody").replaceChildren();
};
$("#viewer").addEventListener("close", () => $("#vBody").replaceChildren());

$("#dashBtn").onclick = () => setView(dashView === "dashboard" ? "tracker" : "dashboard");
if (dashView === "dashboard") {
  document.body.classList.add("dash-view");
  $("#dashBtn").textContent = "← Back to tracker";
}
$("#pdfBtn").onclick = (e) => saveScreenAsPdf(e.currentTarget);
$("#expandAll").onclick = () => {
  WORKFLOW.forEach((s) => openStages.add(slug(s.name)));
  saveOpen();
  render();
};
$("#collapseAll").onclick = () => {
  openStages.clear();
  saveOpen();
  render();
};

// ---------- jobs ----------
$("#jobSel").onchange = (e) => {
  currentId = e.target.value;
  try {
    localStorage.setItem("kr-wf-job", currentId);
  } catch (_) {}
  render();
};

// ---------- boot ----------
render();
(async () => {
  const c = window.claude;
  const [d, a] = await Promise.all(
    [c?.use ? c.use("db") : null, c?.use ? c.use("assets") : null].map((p) => Promise.resolve(p).catch(() => null)),
  );
  db = d;
  assets = a;
  try {
    downloads = c?.use ? await c.use("downloads") : null;
  } catch (e) {
    downloads = null;
  }
  try {
    sampleFn = c?.use ? await c.use("sample") : null;
  } catch (e) {
    sampleFn = null;
  }
  try {
    const u = c?.use ? await c.use("user") : null;
    userNs = u;
    const me = u ? await u.me() : null;
    viewerEmail = me?.email || null;
    viewerId = me?.id || null;
    viewerName = me?.name || "";
    if (viewerId) {
      const ps = await u.profiles([viewerId]);
      viewerMember = !ps[viewerId]?.guest;
    }
  } catch (e) {}
  viewerKnown = true;
  renderAccess();
  if (!db) {
    localMode = true;
    const X = window.__EXPORT__;
    jobs = X
      ? X.jobs.map((j) => ({ id: j.id, data: j.data }))
      : [{ id: "local-demo", data: { num: "Example job", addr: "changes in this view aren’t saved", items: {} } }];
    currentId = jobs[0].id;
    if (X) {
      devNotes = X.devnotes || [];
      invites = X.access || [];
      jobNotes = X.jobnotes || [];
    }
    showBanner(X ? X.note : "This view can’t reach the shared tracker, so changes won’t be saved and uploads are off.");
    render();
    return;
  }
  db.collection("jobnotes").onSnapshot(
    (snap) => {
      jobNotes = snap.docs.map((s) => ({ id: s.id, ...s.data() }));
      renderJobNotes();
    },
    () => {},
  );
  db.collection("devnotes").onSnapshot(
    (snap) => {
      devNotes = snap.docs.map((s) => ({ id: s.id, ...s.data() }));
      renderDevNotes();
    },
    () => {},
  ); // TEMP-DEV-NOTES
  db.collection("access").onSnapshot(
    (snap) => {
      invites = snap.docs.map((s) => ({ id: s.id, ...s.data() }));
      renderAccess();
    },
    () => {},
  );
  db.collection("jobs").onSnapshot(
    (snap) => {
      jobs = snap.docs.map((s) => ({ id: s.id, data: s.data() }));
      render();
    },
    (err) => {
      showBanner("Live updates stopped (" + err.code + "). Reload the page to reconnect.");
    },
  );
})();
