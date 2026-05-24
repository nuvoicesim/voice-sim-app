import { describe, it, expect } from "vitest";
import {
  consentBadgeProps,
  groupBadgeProps,
  progressStateBadgeProps,
} from "./studentProgressDisplay";

describe("consentBadgeProps", () => {
  it("renders 'agreed' as filled terracotta", () => {
    const p = consentBadgeProps({ decision: "agreed" } as any);
    expect(p).toEqual({ label: "agreed", color: "terracotta", variant: "filled" });
  });

  it("renders 'declined' as outline terracotta", () => {
    const p = consentBadgeProps({ decision: "declined" } as any);
    expect(p).toEqual({ label: "declined", color: "terracotta", variant: "outline" });
  });

  it("renders dash when null", () => {
    expect(consentBadgeProps(null)).toEqual({
      label: "—",
      color: "parchment",
      variant: "light",
    });
  });
});

describe("groupBadgeProps", () => {
  it("renders groupKey when present", () => {
    expect(groupBadgeProps({ groupKey: "A" } as any)).toEqual({
      label: "A",
      color: "terracotta",
      variant: "light",
    });
  });

  it("renders dash when null", () => {
    expect(groupBadgeProps(null)).toEqual({
      label: "—",
      color: "parchment",
      variant: "light",
    });
  });
});

describe("progressStateBadgeProps", () => {
  it("renders 'completed' as filled terracotta", () => {
    expect(progressStateBadgeProps({ state: "completed" } as any)).toMatchObject({
      label: "completed",
      color: "terracotta",
      variant: "filled",
    });
  });

  it("renders 'in_progress' as light terracotta", () => {
    expect(progressStateBadgeProps({ state: "in_progress" } as any)).toMatchObject({
      label: "in progress",
    });
  });

  it("renders 'locked' as outline parchment", () => {
    expect(progressStateBadgeProps({ state: "locked" } as any)).toMatchObject({
      label: "locked",
      color: "parchment",
    });
  });

  it("renders 'not started' for null progress", () => {
    expect(progressStateBadgeProps(null)).toMatchObject({
      label: "not started",
      color: "parchment",
      variant: "outline",
    });
  });
});
