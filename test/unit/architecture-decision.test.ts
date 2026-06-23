import { describe, expect, it } from "vitest";
import { approveArchitecture, requireApprovedArchitecture } from "../../src/core/architecture/architecture-decision.js";
import { hollowSkinnyProfile } from "../../src/profiles/hollow-skinny/hollow-skinny.profile.js";

describe("architecture decision gate", () => {
  it("blocks execution until a candidate is explicitly approved", () => {
    expect(() => requireApprovedArchitecture(undefined)).toThrow("Architecture approval is required");
    const decision = approveArchitecture(hollowSkinnyProfile, "gaosong", "2026-06-23T00:00:00.000Z");
    expect(requireApprovedArchitecture(decision)).toBe(hollowSkinnyProfile.id);
    expect(decision).toMatchObject({ approvedBy: "gaosong", profileId: "hollow-skinny-v1", revision: 1 });
  });

  it("rejects empty approvers", () => {
    expect(() => approveArchitecture(hollowSkinnyProfile, " ", "2026-06-23T00:00:00.000Z")).toThrow("approvedBy");
  });

  it("rejects invalid profile ids", () => {
    expect(() =>
      approveArchitecture({ ...hollowSkinnyProfile, id: " " }, "gaosong", "2026-06-23T00:00:00.000Z"),
    ).toThrow("profile.id");
  });

  it("rejects invalid approval timestamps", () => {
    expect(() => approveArchitecture(hollowSkinnyProfile, "gaosong", "2026-06-23")).toThrow("approvedAt");
  });

  it("rejects malformed loaded decisions", () => {
    expect(() =>
      requireApprovedArchitecture({
        id: "",
        profileId: "",
        revision: 0,
        approvedBy: "",
        approvedAt: "not-a-date",
      }),
    ).toThrow("Invalid architecture decision");
  });
});
