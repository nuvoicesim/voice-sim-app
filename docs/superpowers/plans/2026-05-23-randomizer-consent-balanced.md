# Randomizer Consent-Aware Balanced Assignment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `"balanced"` strategy to the randomizer ModuleItem that splits consented students 1:1 across groups via atomic counter + round-robin, with faculty selecting the bound consent ModuleItem at authoring time.

**Architecture:** Pure decision helper (`chooseGroupBalanced`) takes injected `resolveBucket` (ConsentDecision lookup) and `incrementCounter` (DDB `UpdateItem ADD`); `handleRandomize` branches on `strategy === "balanced"` and otherwise falls through to the existing uniform/weighted code path. Counters live as `_balancedConsentedCount` / `_balancedNonConsentedCount` attributes on the ModuleItem row itself.

**Tech Stack:** TypeScript (strict, `noUnusedLocals`/`noUnusedParameters`), AWS SDK v3 (`@aws-sdk/lib-dynamodb` `UpdateCommand`), Vitest, React + Mantine.

**Spec:** [docs/superpowers/specs/2026-05-23-randomizer-consent-balanced-design.md](../specs/2026-05-23-randomizer-consent-balanced-design.md)

---

## File Structure

**New files:**
- `vitest.config.ts` — Vitest config at repo root, includes `__tests__/**/*.test.ts`.
- `__tests__/randomizer-balanced.test.ts` — Unit tests for the pure decision helper.
- `amplify/functions/module-item-function/balanced.ts` — Pure `chooseGroupBalanced` + types.

**Modified files:**
- `amplify/functions/module-item-function/handler.ts` — extend payload validator; add balanced branch in `handleRandomize`; add `UpdateCommand` import.
- `src/portals/faculty/courses/ModuleItemEditorPage.tsx` — extend `RandomizerPayloadEditor` with `"balanced"` strategy option, consent-item `Select`, hide weight under balanced.
- `package.json` — no edits expected (vitest already a devDep, `test` script already present).

---

## Task 1: Bootstrap test scaffold

**Files:**
- Create: `vitest.config.ts`
- Create: `__tests__/.gitkeep` (placeholder so the directory commits)

- [ ] **Step 1: Write vitest.config.ts**

Create `vitest.config.ts` at repo root:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["__tests__/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 2: Create the tests directory**

Create empty `__tests__/.gitkeep` so the directory survives in git.

- [ ] **Step 3: Run the test command to verify scaffold**

Run: `npm test`
Expected: vitest reports `No test files found` (or similar; non-zero exit is OK as long as the failure is "no tests" not "config error").

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts __tests__/.gitkeep
git commit -m "test: bootstrap vitest scaffold for app-level tests"
```

---

## Task 2: Write failing unit tests for chooseGroupBalanced

**Files:**
- Create: `__tests__/randomizer-balanced.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/randomizer-balanced.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- __tests__/randomizer-balanced.test.ts`
Expected: All 6 tests FAIL with a module-not-found error for `../amplify/functions/module-item-function/balanced`.

- [ ] **Step 3: Commit**

```bash
git add __tests__/randomizer-balanced.test.ts
git commit -m "test: failing tests for chooseGroupBalanced helper"
```

---

## Task 3: Implement chooseGroupBalanced helper

**Files:**
- Create: `amplify/functions/module-item-function/balanced.ts`

- [ ] **Step 1: Write minimal implementation**

Create `amplify/functions/module-item-function/balanced.ts`:

```ts
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
    throw new Error("balanced randomizer requires at least one group");
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
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test -- __tests__/randomizer-balanced.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add amplify/functions/module-item-function/balanced.ts
git commit -m "feat: pure chooseGroupBalanced helper with injected dependencies"
```

---

## Task 4: Extend backend payload validation

**Files:**
- Modify: `amplify/functions/module-item-function/handler.ts:297-300`
- Create: `__tests__/randomizer-payload-validation.test.ts`

- [ ] **Step 1: Write failing validation tests**

Create `__tests__/randomizer-payload-validation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateRandomizerPayload } from "../amplify/functions/module-item-function/balanced";

describe("validateRandomizerPayload", () => {
  it("accepts undefined payload fields", () => {
    expect(validateRandomizerPayload({})).toBeNull();
  });

  it("accepts valid groups + strategy + consentItemId", () => {
    expect(
      validateRandomizerPayload({
        groups: [{ key: "A" }, { key: "B" }],
        strategy: "balanced",
        consentItemId: "ci-1",
      })
    ).toBeNull();
  });

  it("rejects non-array groups", () => {
    expect(validateRandomizerPayload({ groups: "nope" })).toMatch(/groups/);
  });

  it("rejects unknown strategy values", () => {
    expect(validateRandomizerPayload({ strategy: "round-robin" })).toMatch(/strategy/);
  });

  it("accepts the three known strategy values", () => {
    for (const s of ["uniform", "weighted", "balanced"]) {
      expect(validateRandomizerPayload({ strategy: s })).toBeNull();
    }
  });

  it("rejects non-string consentItemId", () => {
    expect(validateRandomizerPayload({ consentItemId: 5 })).toMatch(/consentItemId/);
  });

  it("rejects empty-string consentItemId", () => {
    expect(validateRandomizerPayload({ consentItemId: "" })).toMatch(/consentItemId/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- __tests__/randomizer-payload-validation.test.ts`
Expected: All tests FAIL — `validateRandomizerPayload` not exported from `balanced.ts`.

- [ ] **Step 3: Add validator to balanced.ts**

Append to `amplify/functions/module-item-function/balanced.ts`:

```ts
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
```

- [ ] **Step 4: Wire validator into handler.ts**

Find the `case "randomizer":` block at handler.ts:297-300:

```ts
    case "randomizer":
      if (payload.groups !== undefined && !Array.isArray(payload.groups))
        return "randomizer.payload.groups must be an array";
      return null;
```

Replace with:

```ts
    case "randomizer":
      return validateRandomizerPayload(payload);
```

Add the import at the top of handler.ts (near other module-local imports):

```ts
import { validateRandomizerPayload } from "./balanced";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: All tests PASS (both files).

- [ ] **Step 6: Commit**

```bash
git add __tests__/randomizer-payload-validation.test.ts amplify/functions/module-item-function/balanced.ts amplify/functions/module-item-function/handler.ts
git commit -m "feat: validate strategy and consentItemId in randomizer payload"
```

---

## Task 5: Wire balanced branch into handleRandomize

**Files:**
- Modify: `amplify/functions/module-item-function/handler.ts:499-581` (the `handleRandomize` function)

- [ ] **Step 1: Add UpdateCommand import**

In handler.ts line 2 (currently `import { ScanCommand, GetCommand } from "@aws-sdk/lib-dynamodb";`), change to:

```ts
import { ScanCommand, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
```

- [ ] **Step 2: Import the helper**

Confirm `import { validateRandomizerPayload } from "./balanced";` from Task 4 exists. Change it to also import `chooseGroupBalanced`:

```ts
import { chooseGroupBalanced, validateRandomizerPayload } from "./balanced";
```

- [ ] **Step 3: Add CONSENT_DECISION_TABLE env var binding**

handler.ts already has `const CONSENT_DECISION_TABLE = process.env.CONSENT_DECISION_TABLE_NAME!;` at line 44 — verify it's there. If absent, add it next to the other table-name bindings near line 30-44.

- [ ] **Step 4: Insert the balanced branch in handleRandomize**

In handler.ts, find this block inside `handleRandomize` (around lines 532-548):

```ts
  if (existing) {
    return createResponse(HTTP_STATUS.OK, { assignment: existing, alreadyAssigned: true });
  }

  // Weighted random.
  const weights = groups.map((g) => Math.max(0, g.weight ?? 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let pick = Math.random() * total;
  let chosenIndex = 0;
  for (let i = 0; i < weights.length; i++) {
    pick -= weights[i];
    if (pick <= 0) {
      chosenIndex = i;
      break;
    }
  }
  const groupKey = groups[chosenIndex].key;
```

Replace with:

```ts
  if (existing) {
    return createResponse(HTTP_STATUS.OK, { assignment: existing, alreadyAssigned: true });
  }

  let groupKey: string;
  if (item.payload?.strategy === "balanced") {
    const consentItemId: string | undefined = item.payload?.consentItemId;
    const balancedResult = await chooseGroupBalanced({
      groups: groups.map((g) => ({ key: g.key })),
      consentItemId,
      callerUserId: caller.userId,
      itemId,
      resolveBucket: async ({ consentItemId: cid, callerUserId }) => {
        if (!cid) return "nonConsented";
        const decision = await getItem(
          CONSENT_DECISION_TABLE,
          { consentItemId: cid, studentUserId: callerUserId },
          dynamo
        );
        return decision?.decision === "agreed" ? "consented" : "nonConsented";
      },
      incrementCounter: async ({ itemId: id, bucket }) => {
        const attr =
          bucket === "consented"
            ? "_balancedConsentedCount"
            : "_balancedNonConsentedCount";
        const result = await dynamo.send(
          new UpdateCommand({
            TableName: MODULE_ITEM_TABLE,
            Key: { moduleItemId: id },
            UpdateExpression: "ADD #c :one",
            ExpressionAttributeNames: { "#c": attr },
            ExpressionAttributeValues: { ":one": 1 },
            ReturnValues: "UPDATED_NEW",
          })
        );
        const newValue = result.Attributes?.[attr];
        if (typeof newValue !== "number") {
          throw new Error("balanced counter increment returned non-numeric value");
        }
        return newValue;
      },
    });
    groupKey = balancedResult.groupKey;
  } else {
    // Weighted / uniform random (existing behavior).
    const weights = groups.map((g) => Math.max(0, g.weight ?? 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let pick = Math.random() * total;
    let chosenIndex = 0;
    for (let i = 0; i < weights.length; i++) {
      pick -= weights[i];
      if (pick <= 0) {
        chosenIndex = i;
        break;
      }
    }
    groupKey = groups[chosenIndex].key;
  }
```

The rest of `handleRandomize` (the `row = {...}; await putItem(GROUP_TABLE, row, dynamo); ...`) is unchanged because `groupKey` is now declared above.

- [ ] **Step 5: Verify the rest of the function still compiles**

The existing code below the replaced block reads:

```ts
  const groupKey = groups[chosenIndex].key;
  const now = generateTimestamp();
  const row = { ... };
```

After the replacement, `const groupKey =` already exists above, so the next lines must not redeclare it. Make sure the line `const groupKey = groups[chosenIndex].key;` is REMOVED (it now lives inside the else branch) and the subsequent code starts at `const now = generateTimestamp();`.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit -p amplify`
If a `tsconfig` for amplify isn't present, run `npx tsc --noEmit` from repo root and ignore unrelated pre-existing errors.
Expected: no new errors introduced by the changes in this task.

- [ ] **Step 7: Run all tests**

Run: `npm test`
Expected: all tests still PASS.

- [ ] **Step 8: Commit**

```bash
git add amplify/functions/module-item-function/handler.ts
git commit -m "feat: balanced strategy branch in handleRandomize using atomic counter"
```

---

## Task 6: Faculty UI — strategy option, consent dropdown, hide weight under balanced

**Files:**
- Modify: `src/portals/faculty/courses/ModuleItemEditorPage.tsx:460-538` (`RandomizerPayloadEditor`)
- Modify: `src/portals/faculty/courses/ModuleItemEditorPage.tsx:167-178` (`candidateGroups` block — to also expose consent items)

- [ ] **Step 1: Add a derived list of consent items in the same course**

In `ModuleItemEditorPage.tsx`, locate the `candidateGroups` block (lines 167-178):

```ts
  const candidateGroups = (() => {
    const set = new Set<string>();
    for (const list of Object.values(allItemsByModule || {})) {
      for (const it of (list as any[]) || []) {
        if (it.itemType === "randomizer") {
          const groups = (it.payload as any)?.groups || [];
          for (const g of groups) if (g?.key) set.add(g.key);
        }
      }
    }
    return Array.from(set).map((g) => ({ value: g, label: g }));
  })();
```

Immediately after the `candidateGroups` declaration, add:

```ts
  const consentItems = (() => {
    const items: Array<{ value: string; label: string }> = [];
    for (const list of Object.values(allItemsByModule || {})) {
      for (const it of (list as any[]) || []) {
        if (it.itemType === "consent") {
          items.push({
            value: it.moduleItemId,
            label: it.title || it.moduleItemId,
          });
        }
      }
    }
    return items;
  })();
```

- [ ] **Step 2: Pass consentItems into RandomizerPayloadEditor**

Find the call site (around line 296-297):

```ts
    case "randomizer":
      return <RandomizerPayloadEditor payload={draft.payload} onChange={setPayload} />;
```

Change to:

```ts
    case "randomizer":
      return (
        <RandomizerPayloadEditor
          payload={draft.payload}
          onChange={setPayload}
          consentItems={consentItems}
        />
      );
```

- [ ] **Step 3: Extend the editor component signature and strategy option**

Find `function RandomizerPayloadEditor({ payload, onChange }:` (around line 460). Replace its signature and body up through the strategy `Select`:

```tsx
function RandomizerPayloadEditor({
  payload,
  onChange,
  consentItems,
}: {
  payload: any;
  onChange: (v: any) => void;
  consentItems: Array<{ value: string; label: string }>;
}) {
  const groups: Array<{ key: string; label?: string; weight?: number }> = payload.groups || [];
  const strategy = payload.strategy || "uniform";
  const isBalanced = strategy === "balanced";
  return (
    <Stack gap="xs">
      <Select
        label="Strategy"
        data={[
          { value: "uniform", label: "Uniform random" },
          { value: "weighted", label: "Weighted" },
          { value: "balanced", label: "Balanced (1:1 for consented students)" },
        ]}
        value={strategy}
        onChange={(v) => onChange({ strategy: v })}
      />
      {isBalanced && (
        <Select
          label="Bind consent item"
          placeholder="(none — treat all students as non-consented)"
          clearable
          data={consentItems}
          value={payload.consentItemId || null}
          onChange={(v) => onChange({ consentItemId: v || undefined })}
        />
      )}
```

- [ ] **Step 4: Hide weight input under balanced**

The current per-group `Group` block (lines ~485-527) renders a `NumberInput label="Weight"`. Wrap that `NumberInput` so it only renders when `!isBalanced`:

Find:

```tsx
          <NumberInput
            label="Weight"
            value={g.weight ?? 1}
            onChange={(v) => {
              const next = [...groups];
              next[i] = { ...next[i], weight: Number(v) || 1 };
              onChange({ groups: next });
            }}
            min={0.1}
            step={0.1}
            style={{ width: 100 }}
          />
```

Wrap it:

```tsx
          {!isBalanced && (
            <NumberInput
              label="Weight"
              value={g.weight ?? 1}
              onChange={(v) => {
                const next = [...groups];
                next[i] = { ...next[i], weight: Number(v) || 1 };
                onChange({ groups: next });
              }}
              min={0.1}
              step={0.1}
              style={{ width: 100 }}
            />
          )}
```

- [ ] **Step 5: Confirm the editor still closes its tags**

The original component ends with the `</Stack>` matching the opening `<Stack gap="xs">`. The structural changes above only insert/wrap children — verify the `</Stack>` and trailing `)` / `}` are still present and balanced.

- [ ] **Step 6: Type-check the frontend**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: no new errors. (If `tsconfig.app.json` doesn't exist, fall back to `npx tsc -p tsconfig.json --noEmit`.)

- [ ] **Step 7: Commit**

```bash
git add src/portals/faculty/courses/ModuleItemEditorPage.tsx
git commit -m "feat(ui): faculty can pick balanced strategy and bind consent item"
```

---

## Task 7: Final verification

**Files:** (none modified)

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: all tests in `__tests__/` PASS, none skipped.

- [ ] **Step 2: Type-check both halves**

Run: `npx tsc -p tsconfig.app.json --noEmit` (frontend) — no new errors.
Run: `npx tsc --noEmit amplify/functions/module-item-function/handler.ts amplify/functions/module-item-function/balanced.ts` — no errors on the touched files. (If the command rejects loose-file mode, use the closest amplify tsconfig if present, otherwise inspect the output and confirm the only errors are in unrelated files.)

- [ ] **Step 3: Trace the legacy code path mentally**

Open handler.ts, locate `handleRandomize`. Walk through with payload `strategy: "uniform"`, `strategy: undefined`, and `strategy: "weighted"`. Confirm none of them enter the new branch and that the original `weights / pick / chosenIndex` logic still computes `groupKey`.

- [ ] **Step 4: No commit needed if verification passes**

If anything failed in steps 1-3, raise it as a follow-up task rather than amending earlier commits.

---

## Out-of-scope follow-ups (do NOT include in this plan)

- Deeper validation that `consentItemId` references a consent item in the same course.
- Backfill logic for randomizers whose strategy was switched from uniform → balanced after some assignments already existed.
- Admin UI to reset / inspect `_balancedConsentedCount` / `_balancedNonConsentedCount`.
- Re-assigning students who change consent decision after randomization (intentionally excluded — preserves research integrity).
