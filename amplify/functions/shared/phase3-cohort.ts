/**
 * Phase 3 ingestion contract — the single source of truth for cohort shape,
 * frozen provenance, deterministic ids and the canonical artifact hash.
 *
 * Deliberately NOT re-exported from ./index so the other Lambda bundles stay
 * unchanged; import it by path.
 *
 * Two independent writers exist and must never drift:
 *   - this module (module-item-function, the web import)
 *   - scripts/seed-phase3.mjs (the operator CLI)
 * `.mjs` cannot import `.ts` at runtime, so the CLI keeps literal copies of the
 * values below. scripts/phase3-cohort-parity.test.ts imports BOTH and asserts
 * they are equal, which is what actually prevents the drift.
 */

import { createHash } from "node:crypto";

/** Display positions, in the order students see them. */
export const PHASE3_DISPLAY_KEYS = ["A", "B", "C"] as const;
export type Phase3DisplayKey = (typeof PHASE3_DISPLAY_KEYS)[number];

/** D1-D3 are clinical ratings; "N/A" is a real value, never a parse fallback. */
export const PHASE3_VALID_SCORES: readonly string[] = ["1", "2", "3", "4", "N/A"];

/** The frozen ingestion template header, in order. Any deviation is rejected. */
export const PHASE3_TEMPLATE_COLUMNS: readonly string[] = [
  "review_id",
  "study_id",
  "student_email",
  "display_key",
  "source_internal",
  "d1",
  "d2",
  "d3",
  "narrative",
  "selected_source",
  "session",
  "student_turns",
];

/**
 * Allowed `source_internal` values and how each maps onto the reused
 * ReviewerFeedback row. `source` drives the student-visible reveal; the
 * Faculty 1 / Faculty 2 distinction lives in `displayLabel` for analysis only
 * and is never disclosed to a student.
 */
export const PHASE3_SOURCE_MAP: Readonly<
  Record<string, { source: "ai" | "reviewer"; displayLabel: string }>
> = {
  ai: { source: "ai", displayLabel: "AI" },
  faculty_1: { source: "reviewer", displayLabel: "Faculty 1" },
  faculty_2: { source: "reviewer", displayLabel: "Faculty 2" },
};

// ───────────────────────── formal cohort ─────────────────────────

export const PHASE3_FORMAL_STUDENT_COUNT = 17;
export const PHASE3_FORMAL_ROW_COUNT = 51;

/**
 * Counterbalancing allocation frozen by the research team before launch.
 * The website validates against these totals; it never re-randomizes and never
 * hard-codes which student gets which order — that comes only from the CSV.
 */
export const PHASE3_EXPECTED_SOURCE_ORDERS: Readonly<Record<string, number>> = {
  "AI→F1→F2": 3,
  "AI→F2→F1": 3,
  "F1→AI→F2": 3,
  "F1→F2→AI": 3,
  "F2→AI→F1": 2,
  "F2→F1→AI": 3,
};

/** Canonical display order for the six-way distribution report. */
export const PHASE3_SOURCE_ORDER_KEYS: readonly string[] = Object.keys(
  PHASE3_EXPECTED_SOURCE_ORDERS
);

/**
 * Frozen provenance for the formal cohort. Derived from the frozen filename
 * `..._FROZEN_v1_seed20260825.csv`; these are NOT columns of the CSV and are
 * NEVER parsed from an uploaded filename (a filename is not trusted input).
 * Server-side constants, echoed back by the operator for confirmation.
 */
export const PHASE3_FORMAL_ASSIGNMENT_VERSION = "v1";
export const PHASE3_FORMAL_RANDOM_SEED = "20260825";

/**
 * The phrase an operator must type to commit the formal cohort. Derived from
 * the cohort constants so the SERVER can rebuild and compare it verbatim — the
 * counts in a client-supplied phrase are never trusted.
 */
export function phase3FormalConfirmPhrase(
  studentCount: number = PHASE3_FORMAL_STUDENT_COUNT,
  rowCount: number = PHASE3_FORMAL_ROW_COUNT
): string {
  return `IMPORT ${studentCount} STUDENTS / ${rowCount} ROWS`;
}

// ───────────────────── flow-level concurrency state ─────────────────────

/**
 * Phase 3 import state lives as top-level, non-key attributes on the Parts A–C
 * ModuleItem row — the same place and mechanism the randomizer already uses for
 * `_balancedConsentedCount` (module-item-function/handler.ts). No new table, no
 * schema change, and because it is ONE DynamoDB item every import and purge can
 * take a conditional write on it inside its own transaction, which is what makes
 * tester and formal imports mutually exclusive rather than merely
 * "checked beforehand".
 *
 * It holds no tester identity, no email and no roster: only a monotonic
 * generation counter and the fact that the formal cohort has landed.
 */
export const PHASE3_TESTER_GENERATION_ATTR = "_phase3TesterGeneration";
export const PHASE3_FORMAL_IMPORTED_AT_ATTR = "_phase3FormalImportedAt";
export const PHASE3_FORMAL_BATCH_ATTR = "_phase3FormalBatchId";

// ───────────────────────── row markers ─────────────────────────

export const PHASE3_IMPORT_KIND_FORMAL = "phase3_formal";
export const PHASE3_IMPORT_KIND_TESTER = "phase3_tester";

/** EventLog eventType of the permanent tester-history marker. */
export const PHASE3_TESTER_HISTORY_EVENT_TYPE = "phase3_tester_history";
export const PHASE3_TESTER_IMPORTED_EVENT_TYPE = "phase3_tester_imported";
export const PHASE3_TESTER_PURGED_EVENT_TYPE = "phase3_tester_purged";
export const PHASE3_FORMAL_IMPORTED_EVENT_TYPE = "phase3_formal_imported";

/**
 * ReviewerFeedback.identifier(["feedbackId"]) is a single partition key with no
 * sort key, so this value IS the full primary key and
 * attribute_not_exists(feedbackId) is a correct idempotency guard.
 */
export function phase3FeedbackId(
  studentUserId: string,
  displayKey: string
): string {
  return `phase3:${studentUserId}:${displayKey}`;
}

/**
 * Deterministic EventLog primary key for the permanent tester-history marker.
 *
 * EventLog.identifier(["eventId"]) is likewise a single partition key, so this
 * value is the complete key and the marker can be looked up with an exact
 * BatchGet instead of a table Scan. The marker is written inside the tester
 * import transaction and is NEVER deleted — purge removes the tester's study
 * data, but the account must stay permanently disqualified from the formal
 * cohort, and the analysis exclusion list is derived from these rows.
 */
export function phase3TesterHistoryEventId(
  partsACItemId: string,
  testerUserId: string
): string {
  return `phase3:tester-history:${partsACItemId}:${testerUserId}`;
}

// ───────────────────── canonical artifact hashing ─────────────────────

/** NUL separator; cannot occur in the source fields, so boundaries are exact. */
const FIELD_SEPARATOR = "\u0000";

/**
 * Canonical serialization hashed at import time and re-hashed at read time.
 * Must stay byte-identical to scripts/seed-phase3.mjs `canonicalCardContent`
 * and survey-instance-function/phase3-cards.ts `canonicalCardContent`.
 */
export function phase3CanonicalCardContent(
  d1: string,
  d2: string,
  d3: string,
  narrative: string
): string {
  return [d1, d2, d3, narrative]
    .map((s) => String(s).normalize("NFC"))
    .join(FIELD_SEPARATOR);
}

export function phase3ContentHash(
  d1: string,
  d2: string,
  d3: string,
  narrative: string
): string {
  return createHash("sha256")
    .update(phase3CanonicalCardContent(d1, d2, d3, narrative), "utf8")
    .digest("hex");
}

/** Normalize one stored/uploaded D1-D3 value. Never coerces junk into "N/A". */
export function phase3NormalizeScore(raw: unknown): string {
  const s = String(raw ?? "").trim();
  const upper = s.toUpperCase();
  if (upper === "NA" || upper === "N/A") return "N/A";
  return s;
}

/** "AI→F1→F2" style order label for one student's three rows. */
export function phase3SourceOrderLabel(
  sourceByDisplayKey: Record<string, string>
): string {
  const label: Record<string, string> = {
    ai: "AI",
    faculty_1: "F1",
    faculty_2: "F2",
  };
  return PHASE3_DISPLAY_KEYS.map(
    (k) => label[sourceByDisplayKey[k]] ?? "?"
  ).join("→");
}
