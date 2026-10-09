/**
 * Synthetic fixture builders (TD-1: the prototype's real job is never reproduced). Everything is generated at test time
 * from a seeded faker, so names and addresses are fake and stable between runs.
 */
import { Faker, en, en_AU } from "@faker-js/faker";
import type { Agency } from "@kr/workflow";

export function syntheticFaker(seed = 20260316): Faker {
  const f = new Faker({ locale: [en_AU, en] });
  f.seed(seed);
  return f;
}

/** A condition sentence whose wording alone makes `guessAgency` answer `agency` (see the keyword rules in §10.2). */
export function conditionText(agency: Agency, f: Faker = syntheticFaker()): string {
  const lot = f.number.int({ min: 1, max: 99 });
  const street = f.location.street();
  switch (agency) {
    case "Western Power":
      return `Underground electricity being provided to Lot ${lot} ${street}`;
    case "Water Corporation":
      return `Sewer connections being provided to Lot ${lot} ${street}`;
    case "Busselton Water":
      return `Busselton water supply being extended to Lot ${lot} ${street}`;
    case "Local Government":
      return `A crossover being constructed to Lot ${lot} ${street}`;
    case "WAPC":
      return `A notification being placed on the title of Lot ${lot} advising of ${f.lorem.words(3)}`;
  }
}

export interface SyntheticCondition {
  readonly text: string;
  /** Bracketed agency text appended as "(…)"; omit it to leave the agency to be guessed. */
  readonly bracket?: string;
}

export interface DecisionLetterSpec {
  readonly letterDate?: string;
  readonly conditions: readonly SyntheticCondition[];
  readonly adviceNotes?: readonly string[];
  /** Sentence(s) after the advice notes, e.g. "This approval expires on 3 September 2027." */
  readonly closing?: readonly string[];
  /** Insert a footer ("Page n of N", "OFFICIAL") after every this many condition lines (default: never). */
  readonly footerEvery?: number;
}

/** Text lines of a Decision-Letter-like document as pdf.js would return them (page breaks are empty lines). */
export function decisionLetterLines(spec: DecisionLetterSpec, f: Faker = syntheticFaker()): string[] {
  const lines = [
    "Western Australian Planning Commission",
    spec.letterDate ?? "14 March 2026",
    f.person.fullName(),
    f.location.streetAddress(),
    `Application for subdivision approval - ${f.location.street()}`,
    "Conditional approval",
    "Conditions",
  ];
  let page = 1;
  spec.conditions.forEach((c, i) => {
    const sentence = `${c.text}${c.bracket ? ` (${c.bracket})` : ""}.`;
    // wrap like a PDF would: the first line carries the number
    const words = sentence.split(" ");
    const mid = Math.ceil(words.length / 2);
    lines.push(`${i + 1}. ${words.slice(0, mid).join(" ")}`, words.slice(mid).join(" "));
    if (spec.footerEvery && (i + 1) % spec.footerEvery === 0) {
      lines.push("", `Page ${page} of 9`, "OFFICIAL", "");
      page += 1;
    }
  });
  if (spec.adviceNotes) lines.push("Advice", ...spec.adviceNotes.map((n, i) => `${i + 1}. ${n}`));
  lines.push(...(spec.closing ?? []));
  return lines;
}
