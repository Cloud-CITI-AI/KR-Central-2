import { describe, expect, it } from "vitest";
import { groupPickerJobs } from "./pickerGroups";
import { syntheticCard, syntheticJob } from "./test-fixtures";

const job = (jobNumber: string, extra = {}) => syntheticJob({ fields: { jobNumber, clientName: null, ...extra } });

describe("groupPickerJobs", () => {
  it("groups In progress and Complete with counts and sorts job numbers naturally", () => {
    const current = job("S-0420");
    const listed = [
      syntheticCard(job("S-1000")),
      syntheticCard(job("S-0099")),
      syntheticCard(job("S-0007"), true),
      syntheticCard(current),
    ];
    const groups = groupPickerJobs(listed, current);
    expect(groups.map((g) => g.label)).toEqual(["In progress (3)", "Complete (1)"]);
    expect(groups[0]?.entries.map((e) => e.jobNumber)).toEqual(["S-0099", "S-0420", "S-1000"]);
    expect(groups[1]?.entries.map((e) => e.jobNumber)).toEqual(["S-0007"]);
  });

  it("includes the open job even when the list has not loaded, using its text and live completeness", () => {
    const current = job("S-0001", { address: "1 Example Rd" });
    const groups = groupPickerJobs([], current);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("In progress (1)");
    expect(groups[0]?.entries[0]?.text).toBe("S-0001 – 1 Example Rd (Survey-Strata)");
  });

  it("puts the open job in Complete when 12.3 is completed, whatever the stale list says", () => {
    const current = syntheticJob({ statuses: { i13_2: "completed" } });
    const groups = groupPickerJobs([syntheticCard(current, false)], current);
    expect(groups.map((g) => g.label)).toEqual(["Complete (1)"]);
  });
});
