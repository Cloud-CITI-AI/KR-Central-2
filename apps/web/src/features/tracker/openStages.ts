"use client";
import { STAGE_KEYS, type StageKey } from "@kr/workflow";
import { useEffect, useState } from "react";
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
  /** The bar's state (`aria-expanded`): changes at once, for every stage. */
  readonly isOpen: (stage: StageKey) => boolean;
  /**
   * Whether the body is displayed. Equal to `isOpen` except right after Expand all, when the bodies are shown one stage per frame
   * (see `useOpenStages`); while printing every body is shown.
   */
  readonly isShown: (stage: StageKey) => boolean;
  readonly toggle: (stage: StageKey) => void;
  readonly open: (stage: StageKey) => void;
  readonly expandAll: () => void;
  readonly collapseAll: () => void;
  /** Save as PDF (§5.1): expand every stage, open the print dialog and restore the stages afterwards. */
  readonly saveAsPdf: () => void;
}

interface StageState {
  readonly open: ReadonlySet<StageKey>;
  /** The open stages whose body is displayed: all of them, except the ones Expand all has not got to yet. */
  readonly shown: ReadonlySet<StageKey>;
}

/**
 * Which stages are open, remembered per browser (§5.3). While printing every stage counts as open.
 *
 * Every stage body is mounted whether it is open or not (deep links and print need them in the page), so what an open costs is
 * laying out its cards. One stage (a click on its bar, a link) is shown in the same render. Expand all flips all ten bars at once
 * and then shows the bodies one stage per frame, in order, so the first paint after the click is not held up by 46 cards of layout
 * (INP 672 ms on the reference profile against a budget of 200, PRODUCT_SPEC §14); Collapse all hides everything at once.
 */
export function useOpenStages(): OpenStages {
  const [state, setState] = useState<StageState>(() => {
    const open = read();
    return { open, shown: open };
  });
  const [printing, setPrinting] = useState(false);

  /** Stages in `showNow` are displayed straight away, the others only once they were shown before and are still open. */
  const update = (open: ReadonlySet<StageKey>, showNow: readonly StageKey[]) => {
    setState((before) => ({
      open,
      shown: new Set([...before.shown, ...showNow].filter((stage) => open.has(stage))),
    }));
    write(open);
  };

  // The next open stage that is not shown yet appears after the next frame has been painted (rAF, then a task).
  const waiting = STAGE_KEYS.find((stage) => state.open.has(stage) && !state.shown.has(stage));
  useEffect(() => {
    if (!waiting) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => {
        setState((before) =>
          before.open.has(waiting) ? { open: before.open, shown: new Set(before.shown).add(waiting) } : before,
        );
      }, 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [waiting]);

  return {
    isOpen: (stage) => printing || state.open.has(stage),
    isShown: (stage) => printing || (state.open.has(stage) && state.shown.has(stage)),
    toggle: (stage) => {
      const next = new Set(state.open);
      if (!next.delete(stage)) next.add(stage);
      update(next, [stage]);
    },
    open: (stage) => {
      if (!state.open.has(stage) || !state.shown.has(stage)) update(new Set(state.open).add(stage), [stage]);
    },
    expandAll: () => {
      update(new Set(STAGE_KEYS), []);
    },
    collapseAll: () => {
      update(new Set(), []);
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
