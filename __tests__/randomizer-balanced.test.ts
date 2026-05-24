import { describe, it, expect, vi } from "vitest";
import { chooseGroupBalanced } from "../amplify/functions/module-item-function/balanced";

const TWO_GROUPS = [{ key: "GROUP_A" }, { key: "GROUP_B" }];
const FOUR_GROUPS = [
  { key: "G1" },
  { key: "G2" },
  { key: "G3" },
  { key: "G4" },
];

function makeIncrementer() {
  const counters: Record<string, number> = {
    consented: 0,
    nonConsented: 0,
  };
  return vi.fn(async ({ bucket }: { itemId: string; bucket: "consented" | "nonConsented" }) => {
    counters[bucket] += 1;
    return counters[bucket];
  });
}

describe("chooseGroupBalanced", () => {
  it("rotates consented students 1:1 across two groups", async () => {
    const increment = makeIncrementer();
    const resolveBucket = vi.fn(async () => "consented" as const);

    const results: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await chooseGroupBalanced({
        groups: TWO_GROUPS,
        consentItemId: "consent-1",
        callerUserId: `user-${i}`,
        itemId: "item-1",
        resolveBucket,
        incrementCounter: increment,
      });
      results.push(r.groupKey);
    }

    expect(results).toEqual([
      "GROUP_A",
      "GROUP_B",
      "GROUP_A",
      "GROUP_B",
      "GROUP_A",
      "GROUP_B",
    ]);
  });

  it("rotates consented and non-consented in separate buckets", async () => {
    const increment = makeIncrementer();
    const buckets: Array<"consented" | "nonConsented"> = [
      "consented",
      "nonConsented",
      "consented",
      "nonConsented",
      "nonConsented",
      "consented",
      "consented",
    ];
    const resolveBucket = vi.fn(async () => buckets.shift()!);

    const results: { bucket: string; group: string }[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await chooseGroupBalanced({
        groups: TWO_GROUPS,
        consentItemId: "consent-1",
        callerUserId: `u${i}`,
        itemId: "item-1",
        resolveBucket,
        incrementCounter: increment,
      });
      results.push({ bucket: r.bucket, group: r.groupKey });
    }

    const consentedGroups = results.filter((r) => r.bucket === "consented").map((r) => r.group);
    const nonConsentedGroups = results.filter((r) => r.bucket === "nonConsented").map((r) => r.group);

    expect(consentedGroups).toEqual(["GROUP_A", "GROUP_B", "GROUP_A", "GROUP_B"]);
    expect(nonConsentedGroups).toEqual(["GROUP_A", "GROUP_B", "GROUP_A"]);
  });

  it("buckets everyone as non-consented when consentItemId is omitted", async () => {
    const increment = makeIncrementer();
    const resolveBucket = vi.fn(async () => "nonConsented" as const);

    const r = await chooseGroupBalanced({
      groups: TWO_GROUPS,
      callerUserId: "u1",
      itemId: "item-1",
      resolveBucket,
      incrementCounter: increment,
    });

    expect(r.bucket).toBe("nonConsented");
    expect(r.groupKey).toBe("GROUP_A");
    expect(resolveBucket).toHaveBeenCalledWith({
      consentItemId: undefined,
      callerUserId: "u1",
    });
  });

  it("rotates across 4 groups for 12 consented students (3:3:3:3)", async () => {
    const increment = makeIncrementer();
    const resolveBucket = vi.fn(async () => "consented" as const);

    const counts: Record<string, number> = { G1: 0, G2: 0, G3: 0, G4: 0 };
    for (let i = 0; i < 12; i++) {
      const r = await chooseGroupBalanced({
        groups: FOUR_GROUPS,
        consentItemId: "consent-1",
        callerUserId: `u${i}`,
        itemId: "item-1",
        resolveBucket,
        incrementCounter: increment,
      });
      counts[r.groupKey] += 1;
    }

    expect(counts).toEqual({ G1: 3, G2: 3, G3: 3, G4: 3 });
  });

  it("calls incrementCounter exactly once per call and uses returned value for index", async () => {
    const increment = vi.fn(async () => 7);
    const resolveBucket = vi.fn(async () => "consented" as const);

    const r = await chooseGroupBalanced({
      groups: TWO_GROUPS,
      consentItemId: "consent-1",
      callerUserId: "u",
      itemId: "item-1",
      resolveBucket,
      incrementCounter: increment,
    });

    expect(increment).toHaveBeenCalledTimes(1);
    // (7 - 1) % 2 === 0 → GROUP_A
    expect(r.groupKey).toBe("GROUP_A");
    expect(r.count).toBe(7);
  });

  it("routes non-consented to defaultGroupKey without incrementing counter", async () => {
    const increment = vi.fn();
    const resolveBucket = vi.fn(async () => "nonConsented" as const);

    const r = await chooseGroupBalanced({
      groups: TWO_GROUPS,
      consentItemId: "consent-1",
      defaultGroupKey: "GROUP_B",
      callerUserId: "u1",
      itemId: "item-1",
      resolveBucket,
      incrementCounter: increment,
    });

    expect(r.bucket).toBe("nonConsented");
    expect(r.groupKey).toBe("GROUP_B");
    expect(r.count).toBeNull();
    expect(increment).not.toHaveBeenCalled();
  });

  it("still increments the counter for consented students when defaultGroupKey is set", async () => {
    const increment = makeIncrementer();
    const resolveBucket = vi.fn(async () => "consented" as const);

    const r = await chooseGroupBalanced({
      groups: TWO_GROUPS,
      consentItemId: "consent-1",
      defaultGroupKey: "GROUP_B",
      callerUserId: "u1",
      itemId: "item-1",
      resolveBucket,
      incrementCounter: increment,
    });

    expect(r.bucket).toBe("consented");
    expect(r.groupKey).toBe("GROUP_A");
    expect(r.count).toBe(1);
    expect(increment).toHaveBeenCalledTimes(1);
  });

  it("falls back to non-consented bucket round-robin when defaultGroupKey is omitted", async () => {
    const increment = makeIncrementer();
    const resolveBucket = vi.fn(async () => "nonConsented" as const);

    const first = await chooseGroupBalanced({
      groups: TWO_GROUPS,
      consentItemId: "consent-1",
      callerUserId: "u1",
      itemId: "item-1",
      resolveBucket,
      incrementCounter: increment,
    });
    const second = await chooseGroupBalanced({
      groups: TWO_GROUPS,
      consentItemId: "consent-1",
      callerUserId: "u2",
      itemId: "item-1",
      resolveBucket,
      incrementCounter: increment,
    });

    expect(first.groupKey).toBe("GROUP_A");
    expect(second.groupKey).toBe("GROUP_B");
    expect(increment).toHaveBeenCalledTimes(2);
  });

  it("six declined students all land in defaultGroupKey and counter never moves", async () => {
    const increment = vi.fn();
    const resolveBucket = vi.fn(async () => "nonConsented" as const);

    for (let i = 0; i < 6; i++) {
      const r = await chooseGroupBalanced({
        groups: TWO_GROUPS,
        consentItemId: "consent-1",
        defaultGroupKey: "GROUP_A",
        callerUserId: `u${i}`,
        itemId: "item-1",
        resolveBucket,
        incrementCounter: increment,
      });
      expect(r.groupKey).toBe("GROUP_A");
      expect(r.count).toBeNull();
    }

    expect(increment).not.toHaveBeenCalled();
  });

  it("throws when defaultGroupKey does not match any group key in groups[]", async () => {
    const increment = vi.fn();
    const resolveBucket = vi.fn(async () => "nonConsented" as const);

    await expect(
      chooseGroupBalanced({
        groups: TWO_GROUPS,
        consentItemId: "consent-1",
        defaultGroupKey: "GROUP_TYPO",
        callerUserId: "u1",
        itemId: "item-1",
        resolveBucket,
        incrementCounter: increment,
      })
    ).rejects.toThrow(/defaultGroupKey/i);

    expect(increment).not.toHaveBeenCalled();
  });

  it("throws when groups array is empty", async () => {
    const increment = vi.fn();
    const resolveBucket = vi.fn(async () => "consented" as const);

    await expect(
      chooseGroupBalanced({
        groups: [],
        consentItemId: "consent-1",
        callerUserId: "u",
        itemId: "item-1",
        resolveBucket,
        incrementCounter: increment,
      })
    ).rejects.toThrow(/groups/i);

    expect(increment).not.toHaveBeenCalled();
  });
});
