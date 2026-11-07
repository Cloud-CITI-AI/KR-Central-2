import { describe, expect, it } from "vitest";
import { CHANNEL_NAME_MAX, channelNameFor, channelNameWithSuffix } from "./presentation.js";

describe("channelNameFor (ADR-0015 A5)", () => {
  it("builds S-<number>_<ADDRESS IN CAPS> (<client>) from synthetic job details", () => {
    expect(channelNameFor({ jobNumber: "0042", address: "1 Example Rd, Suburb", clientName: "Client" })).toBe(
      "S-0042_1 EXAMPLE RD, SUBURB (CLIENT)".replace("(CLIENT)", "(Client)"),
    );
    expect(channelNameFor({ jobNumber: "0042", address: "1 Example Rd", clientName: null })).toBe(
      "S-0042_1 EXAMPLE RD",
    );
  });
  it("turns / in the job number into -, drops characters Teams refuses and collapses spaces", () => {
    expect(channelNameFor({ jobNumber: "24/118", address: "Lot 3  Smith  St", clientName: "A & B #1" })).toBe(
      "S-24-118_LOT 3 SMITH ST (A B 1)",
    );
    expect(channelNameFor({ jobNumber: "x", address: 'Q: "quoted"', clientName: "" })).toBe("S-x_Q QUOTED");
  });
  it("shortens the client first, then the address, and never exceeds 50 characters", () => {
    const long = channelNameFor({
      jobNumber: "0042",
      address: "12 Long Street, Town",
      clientName: "The Longest Client Name Pty Ltd",
    });
    expect(long).toBe("S-0042_12 LONG STREET, TOWN (The Longest Client…)");
    expect(long.length).toBeLessThanOrEqual(CHANNEL_NAME_MAX);
    const noRoom = channelNameFor({
      jobNumber: "0042",
      address: "1 Really Really Really Long Address Line Here In Town",
      clientName: "Client",
    });
    expect(noRoom.length).toBeLessThanOrEqual(CHANNEL_NAME_MAX);
    expect(noRoom.includes("(")).toBe(false);
    for (const [n, a, c] of [
      ["1", "a", null],
      ["0042/1", "x".repeat(200), "y".repeat(200)],
      ["", "", ""],
    ] as const) {
      expect(channelNameFor({ jobNumber: n, address: a, clientName: c }).length).toBeLessThanOrEqual(CHANNEL_NAME_MAX);
    }
    expect(channelNameFor({ jobNumber: "", address: "", clientName: "" })).toBe("S-job");
  });
  it("suffixes a clash within the limit", () => {
    expect(channelNameWithSuffix("S-0042_1 EXAMPLE RD", 2)).toBe("S-0042_1 EXAMPLE RD (2)");
    const long = channelNameWithSuffix("x".repeat(50), 3);
    expect(long.length).toBeLessThanOrEqual(CHANNEL_NAME_MAX);
    expect(long.endsWith(" (3)")).toBe(true);
  });
});
