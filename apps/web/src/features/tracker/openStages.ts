"use client";
import { STAGE_KEYS, type StageKey } from "@kr/workflow";
import { useState } from "react";
import { flushSync } from "react-dom";

/** localStorage key of the open stages (prototype `kr-wf-open`): a JSON array of stage keys. */
export const OPEN_STAGES_KEY = "kr-wf-open";

const isStageKey = (value: unknown): value is StageKey => (STAGE_KEYS as readonly unknown[]).includes(value);

/** The remembered open stages; anything unreadable (blocked storage, bad JSON, unknown keys) is dropped. */
function read(): ReadonlySet<StageKey> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(OPEN_STAGES_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter(isStageKey) : []);
  } catch {
    return new Set();
  }
}

function write(open: ReadonlySet<StageKey>): void {
  try {
    localStorage.setItem(OPEN_STAGES_KEY, JSON.stringify([...open]));
  } catch {
    // storage blocked: the stages still open and close for this tab
  }
}

export interface OpenStages {
  readonly isOpen: (stage: StageKey) => boolean;
  readonly toggle: (stage: StageKey) => void;
  readonly open: (stage: StageKey) => void;
  readonly expandAll: () => void;
  readonly collapseAll: () => void;
  /** Save as PDF (§5.1): expand every stage, open the print dialog and restore the stages afterwards. */
  readonly saveAsPdf: () => void;
}

/** Which stages are open, remembered per browser (§5.3). While printing every stage counts as open. */
export function useOpenStages(): OpenStages {
  const [open, setOpen] = useState<ReadonlySet<StageKey>>(read);
  const [printing, setPrinting] = useState(false);
  const update = (next: ReadonlySet<StageKey>) => {
    setOpen(next);
    write(next);
  };
  return {
    isOpen: (stage) => printing || open.has(stage),
    toggle: (stage) => {
      const next = new Set(open);
      if (!next.delete(stage)) next.add(stage);
      update(next);
    },
    open: (stage) => {
      if (!open.has(stage)) update(new Set(open).add(stage));
    },
    expandAll: () => {
      update(new Set(STAGE_KEYS));
    },
    collapseAll: () => {
      update(new Set());
    },
    saveAsPdf: () => {
      flushSync(() => {
        setPrinting(true);
      });
      window.addEventListener(
        "afterprint",
        () => {
          setPrinting(false);
        },
        { once: true },
      );
      window.print();
    },
  };
}
