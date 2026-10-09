import { AGENCIES, type Agency } from "@kr/workflow";
import { describe, expect, it } from "vitest";
import { conditionText, decisionLetterLines, syntheticFaker } from "../../test/fixtures/builders.js";
import { agencyFrom, guessAgency, parseConditions } from "./conditions.js";

describe("agencyFrom (bracketed group)", () => {
  it.each<[string, Agency | null]>([
    ["Western Power", "Western Power"],
    ["WESTERN POWER", "Western Power"],
    ["Water Corporation", "Water Corporation"],
    ["Water Corp", "Water Corporation"],
    ["Busselton Water", "Busselton Water"],
    ["Western Australian Planning Commission", "WAPC"],
    ["WAPC", "WAPC"],
    ["Local Government", "Local Government"],
    ["City of Stirling", "Local Government"],
    ["Town of Vincent", "Local Government"],
    ["Shire of Augusta", "Local Government"],
    ["Council", "Local Government"],
    ["see attached plan", null],
    ["wapcx", null],
  ])("%j -> %s", (text, expected) => {
    expect(agencyFrom(text)).toBe(expected);
  });

  it("checks Busselton Water before Water Corporation", () => {
    expect(agencyFrom("Busselton Water Corp")).toBe("Busselton Water");
  });
});

describe("guessAgency (keyword rules, PRODUCT_SPEC §10.2)", () => {
  it.each<[string, Agency]>([
    ["Underground electricity to each lot", "Western Power"],
    ["a power supply being provided", "Western Power"],
    ["arrangements with Western Power", "Western Power"],
    ["Busselton Water to confirm", "Busselton Water"],
    ["sewer connection", "Water Corporation"],
    ["wastewater disposal", "Water Corporation"],
    ["the Water Corporation requirements", "Water Corporation"],
    ["a water supply being provided", "Water Corporation"],
    ["potable water to each lot", "Water Corporation"],
    ["a potable supply in Busselton", "Busselton Water"],
    ["water supply in Busselton", "Busselton Water"],
    ["crossover to each lot", "Local Government"],
    ["drainage being provided", "Local Government"],
    ["the verge being reinstated", "Local Government"],
    ["kerb and footpath", "Local Government"],
    ["a new road", "Local Government"],
    ["the local government being satisfied", "Local Government"],
    ["the council being satisfied", "Local Government"],
    ["the shire being satisfied", "Local Government"],
    ["a notification on the title", "WAPC"],
    ["", "WAPC"],
  ])("%j -> %s", (text, expected) => {
    expect(guessAgency(text)).toBe(expected);
  });

  it("applies the rules in order: electricity beats a road", () => {
    expect(guessAgency("electricity along the road")).toBe("Western Power");
    expect(guessAgency("sewer under the road")).toBe("Water Corporation");
  });
});

describe("parseConditions", () => {
  it("numbers conditions and keeps wrapped lines together", () => {
    const lines = ["Conditions", "1. First condition", "continues here.", "2) Second", "3.Third"];
    expect(parseConditions(lines).map((c) => [c.number, c.text])).toEqual([
      [1, "First condition continues here."],
      [2, "Second"],
      [3, "Third"],
    ]);
  });

  it("returns the agency named in the last bracketed group and does not mark it guessed", () => {
    const [c] = parseConditions([
      "Conditions",
      "1. Power being arranged (Western Power) (see Note 4) (Water Corporation) trailing text",
    ]);
    expect(c).toMatchObject({ number: 1, agency: "Water Corporation", agencyGuessed: false });
  });

  it("ignores bracketed groups that name no agency and guesses from the keywords", () => {
    const [c] = parseConditions(["Conditions", "1. A crossover being built (see plan A) (ab)"]);
    expect(c).toMatchObject({ agency: "Local Government", agencyGuessed: true });
  });

  it.each(AGENCIES)("guesses %s from the wording of a synthetic condition", (agency) => {
    const f = syntheticFaker();
    const lines = decisionLetterLines({ conditions: [{ text: conditionText(agency, f) }] }, f);
    expect(parseConditions(lines)).toMatchObject([{ number: 1, agency, agencyGuessed: true }]);
  });

  it.each(AGENCIES)("takes %s from its bracket even when the wording suggests another agency", (agency) => {
    const f = syntheticFaker();
    const bracket: Record<string, string> = {
      "Local Government": "City of Stirling",
      WAPC: "Western Australian Planning Commission",
    };
    const lines = decisionLetterLines(
      { conditions: [{ text: "A crossover being built", bracket: bracket[agency] ?? agency }] },
      f,
    );
    expect(parseConditions(lines)).toMatchObject([{ agency, agencyGuessed: false }]);
  });

  it("starts after the Conditions heading and stops at the advice notes", () => {
    const f = syntheticFaker();
    const lines = decisionLetterLines(
      {
        conditions: [{ text: "First thing", bracket: "Western Power" }, { text: "Second thing" }],
        adviceNotes: ["This is advice, not a condition", "Another note"],
        closing: ["3. A numbered line after the advice"],
      },
      f,
    );
    expect(parseConditions(lines).map((c) => c.number)).toEqual([1, 2]);
    expect(parseConditions(lines).some((c) => c.text.includes("advice"))).toBe(false);
  });

  it("accepts 'Condition' (singular), any case, and only a short heading line", () => {
    expect(parseConditions(["CONDITION", "1. Only"])).toHaveLength(1);
    const long = `Conditions ${"x".repeat(60)}`;
    // a long line is not the heading, so parsing starts at the top
    expect(parseConditions(["1. Early", long, "2. Late"]).map((c) => c.text)).toEqual([`Early ${long}`, "Late"]);
  });

  it("parses from the top when there is no Conditions heading", () => {
    expect(parseConditions(["1. A", "2. B"]).map((c) => c.number)).toEqual([1, 2]);
  });

  it("skips page footers between and inside conditions", () => {
    const lines = [
      "Conditions",
      "1. Alpha beta",
      "Page 1 of 3",
      "OFFICIAL",
      "gamma",
      "UNOFFICIAL: Sensitive",
      "3",
      "12 OFFICIAL",
      "page 2",
      "2. Delta",
    ];
    expect(parseConditions(lines).map((c) => c.text)).toEqual(["Alpha beta gamma", "Delta"]);
  });

  it("removes footer remnants glued into the text and collapses whitespace", () => {
    const [c] = parseConditions(["Conditions", "1.  Alpha   beta 12 OFFICIAL gamma", "delta 3 UNOFFICIAL: Sensitive"]);
    expect(c?.text).toBe("Alpha beta gamma delta");
  });

  it("starts condition n only when n is the previous number plus one", () => {
    const lines = ["Conditions", "1. One", "3. not a start", "2. Two", "2. repeated", "10) skipped"];
    const parsed = parseConditions(lines);
    expect(parsed.map((c) => c.number)).toEqual([1, 2]);
    expect(parsed[0]?.text).toBe("One 3. not a start");
    expect(parsed[1]?.text).toBe("Two 2. repeated 10) skipped");
  });

  it("does not treat a decimal such as 2.5 as the start of condition 2", () => {
    const parsed = parseConditions(["Conditions", "1. Width", "2.5 metres minimum", "2. Next"]);
    expect(parsed.map((c) => c.text)).toEqual(["Width 2.5 metres minimum", "Next"]);
  });

  it("ignores text before condition 1 and returns nothing when there are no numbered conditions", () => {
    expect(parseConditions(["Conditions", "Some preamble", "1. Real"]).map((c) => c.text)).toEqual(["Real"]);
    expect(parseConditions(["Conditions", "no numbers here"])).toEqual([]);
    expect(parseConditions([])).toEqual([]);
  });

  it("round-trips a multi-page synthetic letter with footers", () => {
    const f = syntheticFaker(7);
    const specs = AGENCIES.flatMap((a) => [
      { text: conditionText(a, f) },
      { text: conditionText(a, f), bracket: a === "Local Government" ? "Shire of Augusta" : a },
    ]);
    const parsed = parseConditions(
      decisionLetterLines({ conditions: specs, footerEvery: 3, adviceNotes: ["Note"] }, f),
    );
    expect(parsed.map((c) => c.number)).toEqual(specs.map((_, i) => i + 1));
    expect(parsed.map((c) => c.agencyGuessed)).toEqual(specs.map((s) => !s.bracket));
  });
});
