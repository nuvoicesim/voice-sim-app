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
  callerUserId: string;
  itemId: string;
  resolveBucket: BucketResolver;
  incrementCounter: AtomicCounterIncrement;
}

export interface ChooseGroupBalancedResult {
  groupKey: string;
  bucket: BalancedBucket;
  count: number;
}

export async function chooseGroupBalanced(
  args: ChooseGroupBalancedArgs
): Promise<ChooseGroupBalancedResult> {
  if (args.groups.length === 0) {
    throw new Error("balanced randomizer requires non-empty groups array");
  }
  const bucket = await args.resolveBucket({
    consentItemId: args.consentItemId,
    callerUserId: args.callerUserId,
  });
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
  return null;
}
