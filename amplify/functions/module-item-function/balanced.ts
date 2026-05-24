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
