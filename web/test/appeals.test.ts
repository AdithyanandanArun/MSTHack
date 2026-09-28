import { describe, expect, it } from "vitest";
import { canDecideAppeal, canFileAppeal } from "@/lib/appeals";

const room = { developer: "0xdev", moderator: "0xroommod" };
const finding = { author: "0xauthor", status: "committed", verdict: "valid" };

describe("appeal eligibility", () => {
  it("lets the author or developer appeal a verdict once during review", () => {
    for (const address of [finding.author, room.developer]) {
      expect(canFileAppeal({ address, room, finding, phase: "review", existingAppeal: null })).toEqual({ ok: true });
    }
    expect(canFileAppeal({ address: finding.author, room, finding, phase: "review", existingAppeal: { status: "upheld" } }).ok).toBe(false);
  });

  it("refuses appeals from others, before a verdict, or outside review", () => {
    expect(canFileAppeal({ address: "0xother", room, finding, phase: "review", existingAppeal: null }).ok).toBe(false);
    expect(canFileAppeal({ address: finding.author, room, finding: { ...finding, verdict: null }, phase: "review", existingAppeal: null }).ok).toBe(false);
    expect(canFileAppeal({ address: finding.author, room, finding: { ...finding, status: "draft" }, phase: "review", existingAppeal: null }).ok).toBe(false);
    expect(canFileAppeal({ address: finding.author, room, finding, phase: "disclosure", existingAppeal: null }).ok).toBe(false);
    expect(canFileAppeal({ address: null, room, finding, phase: "review", existingAppeal: null }).ok).toBe(false);
  });

  it("only a different registered moderator may decide an open appeal", () => {
    const appeal = { appellant: finding.author, status: "open" };
    expect(canDecideAppeal({ address: "0xreviewer", isModerator: true, room, finding, appeal, phase: "review" })).toEqual({ ok: true });
    for (const address of [room.moderator, finding.author, room.developer]) {
      expect(canDecideAppeal({ address, isModerator: true, room, finding, appeal, phase: "review" }).ok).toBe(false);
    }
    expect(canDecideAppeal({ address: "0xreviewer", isModerator: false, room, finding, appeal, phase: "review" }).ok).toBe(false);
    expect(canDecideAppeal({ address: "0xreviewer", isModerator: true, room, finding, appeal: { ...appeal, status: "upheld" }, phase: "review" }).ok).toBe(false);
    expect(canDecideAppeal({ address: "0xreviewer", isModerator: true, room, finding, appeal, phase: "expired" }).ok).toBe(false);
  });
});
