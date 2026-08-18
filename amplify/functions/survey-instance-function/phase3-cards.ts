/**
 * Phase 3 feedback-card projection — the blinding boundary.
 *
 * VOICE does not score anything in Phase 3. Two faculty reviewers and an AI
 * judge grade the same frozen Maria case OUTSIDE the system, and the finished
 * artifacts (D1-D3 + one integrated narrative each) are seeded into
 * ReviewerFeedback by scripts/seed-phase3.mjs. This module is the single place
 * that decides what a student is allowed to see about those artifacts.
 *
 * Two rules are enforced here and nowhere else:
 *
 *  1. WHITELIST PROJECTION. Cards are rebuilt field by field. Stored rows are
 *     never spread into the response, so a future column added to
 *     ReviewerFeedback cannot silently leak `source`, `displayLabel`,
 *     `reviewerUserId`, or `contentHash` to a student.
 *
 *  2. FAIL-CLOSED REVEAL. Source labels appear only when ALL THREE of a
 *     student's cards are `revealed`. A partially-revealed state (a crashed
 *     reveal loop, a manual DB edit) keeps every card blind rather than
 *     disclosing a subset, which would let a student infer the rest.
 *
 * Kept pure so the blinding behaviour is unit-testable without DynamoDB,
 * mirroring export-function/cue-events-csv.ts.
 */

import { createHash } from "node:crypto";

/** Display positions, in the order students see them. */
export const PHASE3_DISPLAY_KEYS = ["A", "B", "C"] as const;

export type Phase3DisplayKey = (typeof PHASE3_DISPLAY_KEYS)[number];

/** The only two source strings a student may ever see. Faculty 1 vs Faculty 2
 *  is retained internally for analysis but is never disclosed (design §7/§11:
 *  reveal source type only, never professor identity). */
export const SOURCE_LABEL_AI = "AI-generated";
export const SOURCE_LABEL_FACULTY = "Faculty-generated";

/** Shape of a stored ReviewerFeedback row, read defensively. */
export interface ReviewerFeedbackRow {
  feedbackId?: string;
  studentUserId?: string;
  source?: string;
  displayLabel?: string | null;
  reviewerUserId?: string | null;
  body?: string;
  dimensionScores?: unknown;
  displayKey?: string;
  contentHash?: string;
  revealed?: boolean;
  locked?: boolean;
}

/** Blind-safe card handed to the client. This is the complete set of fields a
 *  student ever receives; there is intentionally no `source` field. */
export interface Phase3Card {
  displayKey: Phase3DisplayKey;
  d1: string;
  d2: string;
  d3: string;
  narrative: string;
  /** null while blind; set only once every card in the set is revealed. */
  sourceType: typeof SOURCE_LABEL_AI | typeof SOURCE_LABEL_FACULTY | null;
}

export interface Phase3Eligibility {
  eligible: boolean;
  /** Machine-readable reason, safe to return to the client. */
  reason:
    | "ok"
    | "no_cards"
    | "incomplete_card_set"
    | "duplicate_display_key"
    | "invalid_display_key"
    | "invalid_card_content"
    | "invalid_source_set";
  cardCount: number;
}

const VALID_SCORES = new Set(["1", "2", "3", "4", "N/A"]);

/**
 * Parse one stored D1/D2/D3 value. N/A is a real clinical rating, so malformed,
 * missing, or out-of-range data must not be silently converted to N/A. A null
 * result makes the entire card set ineligible instead.
 */
function parseScore(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  const upper = s.toUpperCase();
  if (upper === "N/A" || upper === "NA") return "N/A";
  return VALID_SCORES.has(s) ? s : null;
}

/**
 * dimensionScores round-trips through DynamoDB's document client as a native
 * object, but tolerate a JSON string in case a row was written by hand.
 */
function readDimensionScores(
  raw: unknown
): { d1: string; d2: string; d3: string } | null {
  let obj: Record<string, unknown> | null =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      obj =
        parsed && typeof parsed === "object"
          ? (parsed as Record<string, unknown>)
          : null;
    } catch {
      obj = null;
    }
  }
  if (!obj || typeof obj !== "object") {
    return null;
  }
  const d1 = parseScore(obj.d1);
  const d2 = parseScore(obj.d2);
  const d3 = parseScore(obj.d3);
  return d1 && d2 && d3 ? { d1, d2, d3 } : null;
}

function isValidDisplayKey(v: unknown): v is Phase3DisplayKey {
  return (
    typeof v === "string" &&
    (PHASE3_DISPLAY_KEYS as readonly string[]).includes(v)
  );
}

/**
 * Keep only the rows belonging to one student. Callers already query by
 * studentUserId, but Phase 3 cross-contamination is the failure mode the study
 * cannot recover from, so the ownership check is repeated here rather than
 * trusted from the query.
 */
export function selectRowsForStudent(
  rows: ReviewerFeedbackRow[],
  studentUserId: string
): ReviewerFeedbackRow[] {
  return (rows || []).filter((r) => r && r.studentUserId === studentUserId);
}

/**
 * A student may take Phase 3 only when they hold a complete, well-formed set of
 * three cards keyed A/B/C. This is the eligibility rule: it admits exactly the
 * seeded participants without a hard-coded roster, and it keeps anyone without
 * a full stimulus set from creating a Phase 3 submission at all.
 */
export function assessPhase3Eligibility(
  rows: ReviewerFeedbackRow[]
): Phase3Eligibility {
  const list = rows || [];
  if (list.length === 0) {
    return { eligible: false, reason: "no_cards", cardCount: 0 };
  }
  if (list.length !== PHASE3_DISPLAY_KEYS.length) {
    return {
      eligible: false,
      reason: "incomplete_card_set",
      cardCount: list.length,
    };
  }
  const seen = new Set<string>();
  for (const row of list) {
    if (!isValidDisplayKey(row?.displayKey)) {
      return {
        eligible: false,
        reason: "invalid_display_key",
        cardCount: list.length,
      };
    }
    if (seen.has(row.displayKey)) {
      return {
        eligible: false,
        reason: "duplicate_display_key",
        cardCount: list.length,
      };
    }
    seen.add(row.displayKey);
    const scores = readDimensionScores(row.dimensionScores);
    if (
      !scores ||
      typeof row.body !== "string" ||
      row.body.trim() === "" ||
      row.locked !== true ||
      typeof row.contentHash !== "string" ||
      !/^[a-f0-9]{64}$/i.test(row.contentHash) ||
      row.contentHash.toLowerCase() !==
        hashCanonicalCardContent(scores.d1, scores.d2, scores.d3, row.body)
    ) {
      return {
        eligible: false,
        reason: "invalid_card_content",
        cardCount: list.length,
      };
    }
  }
  const sources = list.map((row) => row.source).sort();
  if (sources.join(",") !== "ai,reviewer,reviewer") {
    return {
      eligible: false,
      reason: "invalid_source_set",
      cardCount: list.length,
    };
  }
  // Set equality: three unique valid keys is necessarily exactly {A, B, C}.
  return { eligible: true, reason: "ok", cardCount: list.length };
}

/**
 * True only when every card in the set has been unblinded. Reveal is all-or-
 * nothing so an inconsistent DB state degrades to "still blind".
 */
export function isFullyRevealed(rows: ReviewerFeedbackRow[]): boolean {
  const list = rows || [];
  if (list.length !== PHASE3_DISPLAY_KEYS.length) return false;
  return list.every((r) => r?.revealed === true);
}

/**
 * Build the blind-safe card set for one student, ordered A, B, C.
 *
 * Returns null when the student does not hold a complete set — callers treat
 * that as "not eligible for Phase 3" rather than rendering a partial stimulus.
 */
export function buildPhase3Cards(
  rows: ReviewerFeedbackRow[],
  studentUserId: string
): Phase3Card[] | null {
  const mine = selectRowsForStudent(rows, studentUserId);
  if (!assessPhase3Eligibility(mine).eligible) return null;

  const revealed = isFullyRevealed(mine);
  const byKey = new Map<string, ReviewerFeedbackRow>();
  for (const row of mine) byKey.set(row.displayKey as string, row);

  return PHASE3_DISPLAY_KEYS.map((displayKey) => {
    const row = byKey.get(displayKey) as ReviewerFeedbackRow;
    // Eligibility above guarantees this parse succeeds.
    const { d1, d2, d3 } = readDimensionScores(row.dimensionScores)!;
    // Explicit whitelist — never spread `row`.
    return {
      displayKey,
      d1,
      d2,
      d3,
      narrative: typeof row.body === "string" ? row.body : "",
      sourceType: revealed
        ? row.source === "ai"
          ? SOURCE_LABEL_AI
          : SOURCE_LABEL_FACULTY
        : null,
    };
  });
}

/**
 * Canonical serialization hashed at seed time and re-hashed by --verify.
 * Must stay byte-identical to scripts/seed-phase3.mjs. NUL separators cannot
 * occur in the source fields, so no field-boundary ambiguity is possible.
 */
export function canonicalCardContent(
  d1: string,
  d2: string,
  d3: string,
  narrative: string
): string {
  return [d1, d2, d3, narrative]
    .map((s) => String(s).normalize("NFC"))
    .join("\u0000");
}

/** Recompute the frozen artifact digest at read time, not only during seeding. */
export function hashCanonicalCardContent(
  d1: string,
  d2: string,
  d3: string,
  narrative: string
): string {
  return createHash("sha256")
    .update(canonicalCardContent(d1, d2, d3, narrative), "utf8")
    .digest("hex");
}
