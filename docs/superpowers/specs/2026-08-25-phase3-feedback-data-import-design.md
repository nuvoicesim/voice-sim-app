# Phase 3 Feedback Data Import

**Date:** 2026-08-25
**Status:** Implemented (pending live tester validation)
**Scope:** `feature/phase3-feedback-data-import-17-students`

## Problem

Phase 3 feedback cards could only be loaded by `scripts/seed-phase3.mjs`, run from an
operator's laptop against production credentials. The research team needs to load
tester data repeatedly during rehearsal and then load the frozen 17-student cohort,
from the Module Editor, without AWS credentials in a browser and without any way to
half-import a cohort.

The cohort also moved from 14 students / 42 rows to **17 students / 51 rows**, with the
frozen six-way counterbalancing allocation **3 / 3 / 3 / 3 / 2 / 3**.

## Infrastructure constraint

`api-stack` (the main `NurseTownAPI`) is at CloudFormation's 500-resource limit. Adding
`GET /sessions/{sessionId}/evidence` previously broke `backend synth` outright. So this
feature adds **no** API Gateway Resource / Method / Integration / Lambda Permission, no
Lambda, no DynamoDB table, no GSI and no IAM resource. It reuses
`POST /modules/{moduleId}/items?operation=...`, the same trick Phase 3 setup already uses.

`__tests__/api-stack-route-guard.test.ts` freezes the measured baseline
(82 `addResource`, 108 `addMethod`, 22 `LambdaIntegration`, 1 `RestApi`, 1 authorizer,
4 `createStack`) so any regression fails CI.

## Operations

| operation | writes |
|---|---|
| `phase3-status` | no |
| `phase3-import-preview` | no |
| `phase3-import-commit` (`mode: tester \| formal`) | yes |
| `phase3-purge-tester` (`scope: one \| all`) | yes on commit |

Authorization is unchanged: `requireRole` then `requireCourseInstructor` — faculty and
simulation_designer must be an instructor of the course, admin passes globally, students
are rejected.

## Invariants

1. **The server owns the binding.** Parts A–C / Part D item ids are discovered from the
   module on every request. A client-supplied item id is never used.
2. **Accounts come from the course roster.** `email → studentUserId` resolves from active
   `CourseEnrollment` rows, which also proves course membership and avoids needing
   `cognito-idp:ListUsers`. Zero matches, duplicate emails and two emails collapsing to
   one account are hard failures.
3. **Testers are permanently disqualified.** Every tester import writes a deterministic
   EventLog marker `phase3:tester-history:<partsACItemId>:<testerUserId>` that purge never
   deletes. A formal import BatchGets exactly those 17 ids and refuses on any hit. The
   lookup is an exact-key BatchGet, never a Scan — EventLog has no GSI. `UnprocessedKeys`
   is retried and, if the budget is exhausted, the import is **refused**: unprocessed means
   unknown, and a fail-closed gate may not read that as a pass.
4. **All-or-nothing.** The formal cohort is one `TransactWriteItems`: the flow guard, 51
   conditional Puts and the audit record (53 items, under the 100 limit). Preflight is
   four-way — all absent → transact; all exact → verified, zero writes; mixed or divergent
   → 409. There is no resume and no stitching, in either mode, in the website **or the CLI**.

5. **Confirmation is enforced on the server.** The formal phrase is rebuilt from
   `PHASE3_FORMAL_STUDENT_COUNT` / `PHASE3_FORMAL_ROW_COUNT` and compared verbatim to what
   the operator typed. Counts in the request are never used, so a direct API call cannot
   skip or weaken it.

6. **"Verified" means provenance too.** `rowMatchesExpected` compares `_importKind`,
   `_assignmentVersion` and `_randomSeed` alongside the content, in both the website and
   the CLI. A content match with the wrong or missing provenance is divergent, not exact.
   Tester cards that are all exact but have no permanent marker are not reported as
   verified either: the marker is backfilled in a guarded transaction, or the request fails
   closed if the marker cannot be checked.

7. **Tester and formal imports are mutually exclusive at the transaction level** — see
   below. A pre-flight scan alone would let two concurrent requests both succeed.

8. **A duplicated roster row fails closed.** Active `CourseEnrollment` rows are counted per
   normalized email; two rows are rejected even when both name the same account.
9. **Purge cannot reach formal data.** Each ReviewerFeedback delete carries
   `_importKind = phase3_tester AND moduleItemId AND studentUserId AND displayKey`. Those
   conditional deletes ride in the same transaction as the unconditional SurveyInstance /
   StudentItemProgress deletes, so they authorize the whole purge: if any condition fails,
   nothing is deleted. At least one conditional delete is required, so a transaction is
   never built without a guard. Purge-all runs one transaction per tester, which is why the
   number of testers is unbounded.
10. **Tester count is dynamic.** "One tester, three rows" is the shape of a single import,
   not a cap. Nothing anywhere limits how many testers a flow may hold.
11. **No polling.** Purge is a genuine two-phase server flow: the UI asks for a plan with
    `commit: false`, renders exactly what came back (including honest
    `present`/`absent`/`unknown` existence per target), collects the confirmation, then
    sends `commit: true`, at which point the server recomputes the plan and the conditions
    from scratch.

12. **No polling.** Status loads on mount, after each mutation and on Refresh.

## Flow-level mutual exclusion

Three attributes live on the Parts A–C ModuleItem row — the same place and mechanism the
randomizer already uses for `_balancedConsentedCount`:

| attribute | meaning |
|---|---|
| `_phase3TesterGeneration` | monotonic count of tester-set *events* (imports and purges) |
| `_phase3FormalImportedAt` | set once, when the cohort lands |
| `_phase3FormalBatchId` | which batch landed |

Every tester import, formal commit and purge — from the website **and** the CLI — carries a
conditional `Update` on that one item inside its own transaction:

- tester import: `SET #gen = :next` if `attribute_not_exists(#formalAt) AND #gen = :observed`
- formal commit: `SET #formalAt = :now, #formalBatch = :batch` if
  `attribute_not_exists(#formalAt) AND #gen = :observed`
- purge: `SET #gen = :next` if `#gen = :observed`

Because all three touch the same DynamoDB item, two concurrent transactions cannot both
commit — the loser is cancelled and writes nothing. The generation counts events rather
than live testers, so it cannot drift out of agreement with reality, and every write sets
an absolute value derived from the observed generation, so a retry is a no-op instead of a
double count. `attribute_not_exists(#gen)` and `#gen = 0` are distinguished, so "never
written" is never a wildcard.

## Provenance

`assignmentVersion = "v1"`, `randomSeed = "20260825"` are server constants in
`amplify/functions/shared/phase3-cohort.ts`, derived from the frozen filename
`..._FROZEN_v1_seed20260825.csv`. They are not CSV columns and are never parsed from an
uploaded filename. The UI displays them read-only; commit must echo them back.
Tester rows never carry them.

## Audit columns without a schema change

Rows carry `_importKind`, `_importBatchId`, `_importedByUserId`, `_importedAt`,
`_sourceCsvSha256` and (formal only) `_assignmentVersion`, `_randomSeed` as plain DynamoDB
non-key attributes. `amplify/data/resource.ts` is untouched. This is the pattern the repo
already uses for `ModuleItem._balancedConsentedCount`; nothing reads ReviewerFeedback over
AppSync, `buildPhase3Cards` is a strict whitelist projection, and
`rowMatchesExpected` ignores extra attributes so CLI `--verify` still passes.

## CLI parity

`scripts/seed-phase3.mjs` writes through the same rules, not a weaker set:

- **Formal is one transaction**: flow guard + 51 conditional Puts + the audit record. There
  is no row-by-row write path left.
- **No resume**: a partial overlap is a hard failure in both modes.
- **Provenance is frozen**: `--assignment-version` / `--random-seed` are accepted only if
  they repeat `v1` / `20260825` exactly, and must not be supplied for a tester import.
- **Same gates**: formal refuses while testers or unclassifiable rows exist, and refuses if
  the cohort already landed.
- **Same exact-match rule**, including `_importKind` and provenance, so CLI `--verify` and
  the website agree.
- Tester import still writes the three cards, the permanent marker and the audit event in
  one transaction.

`EVENT_LOG_TABLE_NAME` and `MODULE_ITEM_TABLE_NAME` are required for `--tester` and for any
`--commit`, checked before any AWS call: without them the CLI refuses rather than leaving a
marker-less or unguarded write path. `--purge-student` never deletes the marker.

`.mjs` cannot import the `.ts` contract at runtime, so the CLI keeps literal copies and
`scripts/phase3-cohort-parity.test.ts` asserts CLI and website agree on the cohort size,
the allocation, the provenance, the import kinds and the marker id.

## What purge removes, and what it does not

Removed: the tester's feedback cards, and their Parts A–C / Part D `SurveyInstance` and
`StudentItemProgress` rows.

**Retained:** the account's behaviour EventLog (`survey_started`, `survey_submitted`,
`module_item_progress` — none of which carry answer text, narrative, D1–D3 or email), the
admin audit records, and the permanent tester-history marker. **Course enrollment is not
changed** — purge never unenrolls.

EventLog is retained deliberately: it has no GSI, so a delete would need a full-table scan
that may not finish inside the API Gateway timeout, and a delete that can time out
half-way is worse than no delete. The marker is also the only thing keeping the account out
of the formal cohort. The UI says this explicitly and does not claim every trace is gone.

### Analysis-time exclusion (owner: research team — see open items)

```
exclusionSet = { e.studentUserId
                 for e in EventLog
                 where e.eventType == "phase3_tester_history"
                   and e.moduleItemId == <partsACItemId> }
```

Every Phase 3 analysis must filter `exclusionSet` out of EventLog, SurveyInstance and
ReviewerFeedback before use. Offline analysis is not bound by the Lambda timeout, so a
filtered scan is fine there. Invariant 3 guarantees
`exclusionSet ∩ formalCohort = ∅`, so this can never drop a real participant.

**This procedure has not been written into the research analysis materials.** It does not
belong in `IUI2027_OUTPUTS/` — Phase 3 is Module 4 / CHI material, and the project
CLAUDE.md keeps Module 3/4 out of the IUI outputs. It belongs with the CHI Phase 3 design
package. Placement needs a research-team decision.

## Files

New: `amplify/functions/shared/phase3-cohort.ts`,
`amplify/functions/module-item-function/phase3-import.ts` (+ test),
`src/portals/faculty/courses/phase3-import-client.ts` (+ test),
`src/portals/faculty/courses/components/Phase3FeedbackDataImport.tsx` (+ test),
`scripts/phase3-cohort-parity.test.ts`, `__tests__/api-stack-route-guard.test.ts`.

Changed: `amplify/functions/shared/database.ts` (`transactWriteItems` now preserves
`CancellationReasons`; it had no callers before), `module-item-function/handler.ts`
(dispatch + three handlers), `src/api/moduleItemApi.ts`, `Phase3SurveyFlowSetup.tsx`
(mounts the panel inside the Configured branch), `scripts/seed-phase3.mjs`.

Untouched: `amplify/backend.ts`, `amplify/data/resource.ts`,
`survey-instance-function/*`, `phase3-cards.ts`, `student-feedback.ts`, `phase3-setup.ts`.
