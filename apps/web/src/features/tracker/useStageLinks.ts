"use client";
import { CHECKPOINTS, STAGES, STAGE_KEYS, type StageKey } from "@kr/workflow";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OpenStages } from "./openStages";

const CHECKPOINT_PREFIX = "checkpoint-";

/** The stage an in-page target belongs to: a stage key ("western-power") or a card id ("checkpoint-i13_2"). */
function stageOf(id: string): StageKey | undefined {
  const stage = STAGE_KEYS.find((key) => key === id);
  if (stage) return stage;
  if (!id.startsWith(CHECKPOINT_PREFIX)) return undefined;
  const key = id.slice(CHECKPOINT_PREFIX.length);
  return CHECKPOINTS.some((c) => c.key === key)
    ? STAGES.find((s) => s.checkpoints.some((c) => c.key === key))?.key
    : undefined;
}

/** The stage's bar button (an excluded stage has none) or else the element itself, made focusable by script only (`tabindex=-1`). */
function focusTarget(element: HTMLElement): void {
  const bar = element.querySelector<HTMLElement>(":scope > h2 > button");
  const focusable = bar ?? element;
  if (!bar && !element.hasAttribute("tabindex")) element.tabIndex = -1;
  focusable.focus({ preventScroll: true });
}

/**
 * Deep links (§4, §5.3): `?stage=<stageKey>` (`initialStage`) and `#checkpoint-<key>` open the stage and scroll to it, as do the
 * in-page links "Go to Western Power ↓" and "Checklist ↑" (any `a[href="#<stageKey>"]`), smoothly unless the person prefers
 * reduced motion. Anything else is left to the browser. Because the link's default action is cancelled and the page is scrolled by
 * hand, focus is moved to the target too (WCAG 2.4.3, 2.1.1): the stage's bar button, or the card itself, so the next Tab goes on from
 * there instead of back to where the link was. Arriving with `?stage=` or a hash on load only scrolls; it never takes focus.
 */
export function useStageLinks(stages: OpenStages, initialStage: StageKey | undefined): void {
  const latest = useRef(stages);
  useEffect(() => {
    latest.current = stages;
  });
  const [target, setTarget] = useState<{ readonly id: string; readonly focus: boolean } | null>(null);

  const goTo = useCallback((id: string, focus: boolean): boolean => {
    const stage = stageOf(id);
    if (!stage) return false;
    latest.current.open(stage);
    setTarget({ id, focus });
    return true;
  }, []);

  useEffect(() => {
    const arrive = () => {
      if (initialStage) goTo(initialStage, false);
    };
    arrive();
  }, [initialStage, goTo]);

  useEffect(() => {
    const fromHash = (focus: boolean) => () => {
      goTo(window.location.hash.slice(1), focus);
    };
    const arrive = fromHash(false);
    const change = fromHash(true);
    arrive();
    window.addEventListener("hashchange", change);
    return () => {
      window.removeEventListener("hashchange", change);
    };
  }, [goTo]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href^='#']") : null;
      if (anchor && goTo(anchor.getAttribute("href")?.slice(1) ?? "", true)) event.preventDefault();
    };
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
    };
  }, [goTo]);

  // After the render that opened the stage, so the element is visible and has its place.
  useEffect(() => {
    if (!target) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const element = document.getElementById(target.id);
    element?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    if (element && target.focus) focusTarget(element);
  }, [target]);
}
