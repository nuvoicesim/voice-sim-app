export type BalancedBucket = "consented" | "nonConsented";

export interface BalancedGroup {
  key: string;
}

export type BucketResolver = (input: {
  consentItemId: string | undefined;
  callerUserId: string;
}) => Promise<BalancedBucket>;

export type AtomicCounterIncrement = (input: {
  itemId: string;
  bucket: BalancedBucket;
}) => Promise<number>;

export interface ChooseGroupBalancedArgs {
  groups: BalancedGroup[];
  consentItemId?: string;
  /**
   * Group key that non-consented (declined or undecided) students are
   * assigned to without participating in the round-robin counter. When
   * omitted, non-consented students fall into the legacy nonConsented
   * counter bucket. When set, it MUST match one of the keys in `groups`;
   * otherwise the helper throws to prevent silent ghost-group assignments.
   */
  defaultGroupKey?: string;
  callerUserId: string;
  itemId: string;
  resolveBucket: BucketResolver;
  incrementCounter: AtomicCounterIncrement;
}

export interface ChooseGroupBalancedResult {
  groupKey: string;
  bucket: BalancedBucket;
  /**
   * The post-increment counter value, or null when the student was routed
   * to defaultGroupKey and the counter was intentionally not advanced.
   */
  count: number | null;
}

export async function chooseGroupBalanced(
  args: ChooseGroupBalancedArgs
): Promise<ChooseGroupBalancedResult> {
  if (args.groups.length === 0) {
    throw new Error("balanced randomizer requires non-empty groups array");
  }
  if (
    args.defaultGroupKey &&
    !args.groups.some((g) => g.key === args.defaultGroupKey)
  ) {
    throw new Error(
      `defaultGroupKey "${args.defaultGroupKey}" does not match any key in groups[]`
    );
  }
  const bucket = await args.resolveBucket({
    consentItemId: args.consentItemId,
    callerUserId: args.callerUserId,
  });
  if (bucket === "nonConsented" && args.defaultGroupKey) {
    return {
      groupKey: args.defaultGroupKey,
      bucket,
      count: null,
    };
  }
  const count = await args.incrementCounter({
    itemId: args.itemId,
    bucket,
  });
  const groupIndex = (count - 1) % args.groups.length;
  return {
    groupKey: args.groups[groupIndex].key,
    bucket,
    count,
  };
}

export function validateRandomizerPayload(payload: any): string | null {
  if (payload.groups !== undefined && !Array.isArray(payload.groups)) {
    return "randomizer.payload.groups must be an array";
  }
  if (payload.strategy !== undefined) {
    const allowed = ["uniform", "weighted", "balanced"];
    if (!allowed.includes(payload.strategy)) {
      return `randomizer.payload.strategy must be one of ${allowed.join(", ")}`;
    }
  }
  if (payload.consentItemId !== undefined) {
    if (typeof payload.consentItemId !== "string" || payload.consentItemId.length === 0) {
      return "randomizer.payload.consentItemId must be a non-empty string";
    }
  }
  if (payload.defaultGroupKey !== undefined) {
    if (
      typeof payload.defaultGroupKey !== "string" ||
      payload.defaultGroupKey.length === 0
    ) {
      return "randomizer.payload.defaultGroupKey must be a non-empty string";
    }
    if (
      Array.isArray(payload.groups) &&
      !payload.groups.some(
        (g: any) => g && g.key === payload.defaultGroupKey
      )
    ) {
      return "randomizer.payload.defaultGroupKey must reference an existing group key";
    }
  }
  return null;
}
