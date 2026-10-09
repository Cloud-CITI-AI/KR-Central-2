#!/usr/bin/env python3
"""Validate LESSONS.md (schema + append-only) and produce digests / promotion candidates.

  validate-lessons.py --file LESSONS.md [--base SHA --head SHA]       # CI validation
  validate-lessons.py --file LESSONS.md --digest [--since-days 7]     # weekly digest (markdown)
"""
from __future__ import annotations

import argparse
import datetime as dt
import re
import subprocess
import sys
from collections import Counter, defaultdict

try:
    import yaml  # PyYAML is preinstalled on GitHub-hosted runners
except ImportError:  # pragma: no cover
    sys.exit("PyYAML required: pip install pyyaml")

MARK = "<!-- ENTRIES-START -->"
REQUIRED = {"id", "date", "trigger", "agent", "pr", "area", "what_happened", "root_cause",
            "existing_rule", "proposed_rule", "check", "severity", "supersedes"}
ENUMS = {
    "trigger": {"review-comment", "correction", "revert", "rewrite", "incident", "eval-failure"},
    "root_cause": {"missing-context", "ignored-rule", "ambiguous-brief", "wrong-pattern", "tool-limitation", "unknown"},
    "severity": {"low", "medium", "high", "security"},
}
BLOCK = re.compile(r"```yaml\n(.*?)```", re.S)
SECRETISH = re.compile(r"(AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY|xox[baprs]-|sk-[A-Za-z0-9]{20,})")


def entries_text(text: str) -> str:
    return text.split(MARK, 1)[1] if MARK in text else ""


def parse(text: str) -> list[dict]:
    out = []
    for raw in BLOCK.findall(entries_text(text)):
        out.append(yaml.safe_load(raw) or {})
    return out


def validate(entries: list[dict]) -> list[str]:
    errs, seen = [], set()
    for i, e in enumerate(entries, 1):
        missing = REQUIRED - set(e)
        if missing:
            errs.append(f"entry {i} ({e.get('id', '?')}): missing fields {sorted(missing)}")
        for k, allowed in ENUMS.items():
            if k in e and e[k] not in allowed:
                errs.append(f"entry {i}: {k}={e[k]!r} not in {sorted(allowed)}")
        if e.get("id") in seen:
            errs.append(f"duplicate id {e.get('id')}")
        seen.add(e.get("id"))
        if SECRETISH.search(yaml.safe_dump(e)):
            errs.append(f"entry {i}: looks like it contains a secret — remove it and rotate the credential")
    return errs


def git_show(sha: str, path: str) -> str:
    try:
        return subprocess.run(["git", "show", f"{sha}:{path}"], check=True, capture_output=True, text=True).stdout
    except subprocess.CalledProcessError:
        return ""


def norm_rule(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", (s or "").lower()).strip()[:80]


def digest(entries: list[dict], since_days: int) -> str:
    today = dt.date.today()
    recent = [e for e in entries if (today - dt.date.fromisoformat(str(e["date"]))).days <= since_days]
    window30 = [e for e in entries if (today - dt.date.fromisoformat(str(e["date"]))).days <= 30]
    if not recent:
        return "No new lessons in this period.\n"
    lines = [f"# Lessons digest ({len(recent)} new in last {since_days} days)", ""]
    lines += ["| id | trigger | area | root cause | proposed rule |", "|---|---|---|---|---|"]
    for e in recent:
        lines.append(f"| {e['id']} | {e['trigger']} | `{e['area']}` | {e['root_cause']} | {str(e['proposed_rule'])[:90]} |")
    lines += ["", "## Counts (last 30 days)", ""]
    for field in ("root_cause", "existing_rule", "agent"):
        c = Counter(str(e.get(field)) for e in window30)
        lines.append(f"- **{field}**: " + ", ".join(f"{k}={v}" for k, v in c.most_common()))
    groups: dict[str, list[str]] = defaultdict(list)
    for e in window30:
        key = e.get("existing_rule") if e.get("existing_rule") not in (None, "none") else norm_rule(e.get("proposed_rule"))
        if key and key != "none":
            groups[key].append(e["id"])
    cands = [(k, v) for k, v in groups.items() if len(v) >= 3]
    sec = [e["id"] for e in window30 if e.get("severity") in ("security", "high")]
    lines += ["", "## Promotion candidates (docs/10 §10.2: ≥3 in 30 days, or any high/security)", ""]
    for k, ids in cands:
        lines.append(f"- `{k}` — {len(ids)} occurrences: {', '.join(ids)}")
    for i in sec:
        lines.append(f"- {i} (high/security severity)")
    if not cands and not sec:
        lines.append("- none")
    return "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", default="LESSONS.md")
    ap.add_argument("--base")
    ap.add_argument("--head")
    ap.add_argument("--digest", action="store_true")
    ap.add_argument("--since-days", type=int, default=7)
    a = ap.parse_args()
    try:
        text = open(a.file).read()
    except FileNotFoundError:
        print(f"::error::{a.file} missing (N10)")
        return 1
    entries = parse(text)
    if a.digest:
        sys.stdout.write(digest(entries, a.since_days))
        return 0
    errs = validate(entries)
    if a.base:
        old = entries_text(git_show(a.base, a.file))
        new = entries_text(text)
        if old.strip() and not new.startswith(old.rstrip("\n")):
            errs.append("existing LESSONS.md entries were modified or reordered; entries are append-only (N10)")
    for e in errs:
        print(f"::error file={a.file}::{e}")
    print(f"LESSONS.md: {len(entries)} entries, {len(errs)} error(s)")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
