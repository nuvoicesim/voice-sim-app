# Randomizer: Consent-Aware Balanced Group Assignment

**Date:** 2026-05-23
**Status:** Approved for implementation
**Owner:** yang.fuc@northeastern.edu

## Problem

The current randomizer ModuleItem (`amplify/functions/module-item-function/handler.ts` → `handleRandomize`) assigns each student to a group using weighted random selection in isolation. There is no balancing across students and no awareness of who has signed consent.

For research validity the SLP study needs a stronger guarantee: **students who agreed to the consent form must be split 1:1 across the two groups**. Students who did not sign (declined, or no decision yet) do not need a strict 1:1 guarantee, but a near-even split is preferred.

## Goals

1. Strict 1:1 (or as close as integer arithmetic permits) balance across groups for consented students within a randomizer's scope.
2. Best-effort even balance for non-consented students, independent of the consented bucket.
3. Faculty configurability: faculty selects which consent ModuleItem the randomizer is bound to when authoring the randomizer.
4. Backward compatibility: existing randomizers using `strategy: "uniform" | "weighted"` keep their current behavior.
5. Race-free under concurrent student arrivals.

## Non-Goals

- Re-balancing a student's group after they later change consent decision. Once assigned, the assignment stands (intentional — preserves research integrity).
- Supporting "true random within the constraint of 1:1" (which would require batch assignment and delayed UX). We use deterministic round-robin within each bucket, which is sufficient for a balanced study design.
- Enforcing module ordering (consent before randomizer). That is the faculty's responsibility via module item ordering — out of scope for this design.

## Design

### Data model

No new tables. Two additions to existing schema:

**1. `ModuleItem.payload` for `itemType === "randomizer"`** gains:

```ts
{
  groups: Array<{ key: string; label?: string; weight?: number }>; // existing
  scope: "course" | "module";                                       // existing
  strategy: "uniform" | "weighted" | "balanced";                    // NEW value "balanced"
  consentItemId?: string;                                           // NEW
}
```

- `strategy === "balanced"` activates the new logic.
- `consentItemId` is the `moduleItemId` of a `consent`-type ModuleItem in the same course. Optional. When unset under `balanced` strategy, all students fall into the non-consented bucket.

**2. `ModuleItem` row gains two internal counter attributes** (managed only by `handleRandomize`):

- `_balancedConsentedCount: number` (default treated as 0 if absent)
- `_balancedNonConsentedCount: number` (default treated as 0 if absent)

Underscore prefix marks them as backend-internal — not exposed in API responses, not edited by faculty UI.

### Algorithm

In `handleRandomize`:

```
if item.payload.strategy !== "balanced":
    fall through to existing uniform/weighted logic (unchanged)
    return

# balanced branch
1. lookup existing StudentGroupAssignment(courseId, "studentUserId#scopeKey")
   if found → return { assignment, alreadyAssigned: true }  (unchanged, idempotent)

2. determine bucket:
   if payload.consentItemId is set:
     decision = ConsentDecision.get(consentItemId, callerUserId)
     bucket = "consented" if decision?.decision === "agreed" else "nonConsented"
   else:
     bucket = "nonConsented"

3. atomic increment counter on ModuleItem row:
   DDB UpdateItem(
     Key={moduleItemId: itemId},
     UpdateExpression="ADD #c :one",
     ExpressionAttributeNames={"#c": "_balancedConsentedCount" if bucket=="consented" else "_balancedNonConsentedCount"},
     ExpressionAttributeValues={":one": 1},
     ReturnValues="UPDATED_NEW"
   )
   new_count = response.Attributes[#c]   # 1, 2, 3, ...

4. groupIndex = (new_count - 1) % groups.length
   groupKey = groups[groupIndex].key

5. write StudentGroupAssignment (unchanged shape, same composite sort key)

6. write progress completed + emit "group_assigned" event (unchanged)
```

### Why this is race-free

The only contended write is the counter on a single DDB row. DynamoDB serializes `UpdateItem` operations on the same item, and `ReturnValues: "UPDATED_NEW"` returns the post-increment value of the very increment this caller performed. So two concurrent consented students get distinct values (e.g. 1 and 2), and `(n - 1) % 2` maps them to different groups.

### Strict-1:1 property

For the consented bucket, after k consented students have been assigned, group `i` has `ceil(k / G)` or `floor(k / G)` members where `G = groups.length`. For G=2 this is exactly `|countA - countB| ≤ 1` at all times, becoming 0 every time k is even.

For non-consented, the same property holds inside the non-consented bucket. The combined (consented + non-consented) per-group count is *not* guaranteed even — that's intentional, per the user's requirement.

### Faculty UI changes

In `src/portals/faculty/courses/ModuleItemEditorPage.tsx`, `RandomizerPayloadEditor`:

1. Strategy `Select`: add option `{ value: "balanced", label: "Balanced (1:1 for consented students)" }`.
2. When `strategy === "balanced"`:
   - Render a new `Select` labeled **"Bind consent item"** whose options are all `itemType === "consent"` ModuleItems in the same course (drawn from the already-loaded `allItemsByModule`), value bound to `payload.consentItemId`. Include a `(none)` choice.
   - Hide or disable the `Weight` input on each group row (weight is meaningless under balanced).
3. Default payload for new randomizer items stays unchanged (`strategy: "uniform"`).

### Backend validation

In `validateModuleItemPayload` (handler.ts `case "randomizer"`):

- `strategy`, if present, must be one of `"uniform" | "weighted" | "balanced"`.
- `consentItemId`, if present, must be a non-empty string.

No deeper validation (e.g., verifying the consentItemId actually points to a consent item in the same course) — if it points to nothing, the bucket falls through to non-consented at runtime. Hardening that is a follow-up if needed.

### Edge cases

| Case | Behavior |
|------|----------|
| Student triggers randomizer before deciding consent | Goes into non-consented bucket. |
| `consentItemId` references a deleted / cross-course consent item | `ConsentDecision.get` returns null → non-consented bucket. |
| Student has `decision === "declined"` | Non-consented bucket. |
| Faculty switches strategy from uniform → balanced after some students were already assigned | Existing assignments stay; new arrivals use balanced. Counters start from 0, so the *post-switch* distribution is internally balanced but the global distribution may not be. Documented limitation. |
| `groups.length === 0` under balanced | Same 400 error as today: `"randomizer has no groups configured"`. |
| Existing randomizer with `strategy: undefined` or `"uniform"` / `"weighted"` | Untouched — old code path runs. |

## Testing strategy

The repo currently has no app-level tests (only node_modules). This work introduces the test scaffold:

1. Add `vitest.config.ts` at repo root, configured for the `__tests__/` directory.
2. Extract the pure decision logic from `handleRandomize` into a helper module `amplify/functions/module-item-function/balanced.ts` exposing:

   ```ts
   export type BucketResolver = (input: {
     consentItemId?: string;
     callerUserId: string;
   }) => Promise<"consented" | "nonConsented">;

   export type AtomicCounterIncrement = (input: {
     itemId: string;
     bucket: "consented" | "nonConsented";
   }) => Promise<number>; // returns post-increment count

   export async function chooseGroupBalanced(args: {
     groups: Array<{ key: string }>;
     consentItemId?: string;
     callerUserId: string;
     itemId: string;
     resolveBucket: BucketResolver;
     incrementCounter: AtomicCounterIncrement;
   }): Promise<{ groupKey: string; bucket: "consented" | "nonConsented"; count: number }>;
   ```

3. `handleRandomize` calls `chooseGroupBalanced` with DDB-backed implementations of `resolveBucket` and `incrementCounter`.

4. Unit tests in `__tests__/randomizer-balanced.test.ts`:
   - 6 consented students arriving in order → A,B,A,B,A,B (counts 3:3).
   - Mixed: 4 consented + 3 declined → consented split 2:2, declined split 2:1 (with first declined going to A by virtue of separate counter).
   - No `consentItemId` configured → all bucketed as non-consented, round-robin across the full population.
   - 4 groups + 12 consented → counts 3:3:3:3.
   - Existing assignment found → not exercised by `chooseGroupBalanced` (the early return lives in the caller); covered by an integration-style test against a fake DDB layer if cheap, otherwise documented.
   - Counter increment is the single point of contention; the unit test asserts `chooseGroupBalanced` calls `incrementCounter` exactly once and computes group from the returned value.

5. A lightweight component test for the new consent-item `Select` is optional; can be skipped if test scaffolding for React proves heavy.

## Work breakdown (preview for writing-plans)

1. Add vitest config + `__tests__/` directory; verify `npm test` runs and reports zero tests.
2. Write unit tests for `chooseGroupBalanced` (red).
3. Create `balanced.ts` with pure `chooseGroupBalanced`; tests go green.
4. Extend backend `validateModuleItemPayload` for the new fields; add a small unit test.
5. Wire `chooseGroupBalanced` into `handleRandomize` with DDB-backed `resolveBucket` (ConsentDecision lookup) and `incrementCounter` (UpdateItem ADD).
6. Faculty UI: add `"balanced"` strategy option + consent ModuleItem `Select` in `RandomizerPayloadEditor`; hide weight under balanced.
7. Manual smoke walkthrough (read-only — no sandbox deploys, per project memory): step through code paths, confirm types compile, confirm no regression in uniform/weighted branch.
