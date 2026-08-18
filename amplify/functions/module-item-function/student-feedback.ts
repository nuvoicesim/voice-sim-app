/**
 * Projection for the legacy student feedback REST endpoint.
 *
 * Phase 3 stores the true source in fields that the legacy Phase 2 projection
 * intentionally exposes (`displayLabel`, and later `contentHash`). Those rows
 * must only travel through survey-instance-function's strict card whitelist.
 *
 * Two independent guards, because either one alone can fail open:
 *
 *  1. ITEM GUARD — the queried ModuleItem declares `feedbackCardsFromItemId`.
 *     Cheap, and lets the caller refuse before scanning.
 *  2. ROW GUARD — any returned row carries Phase 3 markers. The item guard
 *     inspects the item being *queried*, but Phase 3 rows are filed under the
 *     *scope* item named by `feedbackCardsFromItemId`. Those are the same item
 *     under the documented wiring, but nothing structural enforces that: point
 *     the scope at, say, the Maria assignment item and the rows would live
 *     under an item whose payload has no marker, so the item guard alone would
 *     hand a student `displayLabel` ("AI" / "Faculty 1" / "Faculty 2") and
 *     `contentHash`. The row guard makes the block independent of configuration.
 *
 * Legacy Phase 1/2 rows (written by module-item-function's own feedback
 * endpoint and by llm-scoring-function) never carry any of these fields, so
 * their masking behaviour is unchanged.
 */
interface FeedbackItem {
  payload?: { feedbackCardsFromItemId?: unknown };
}

interface FeedbackRow extends Record<string, unknown> {
  revealed?: boolean;
  reviewerUserId?: unknown;
  source?: unknown;
  displayKey?: unknown;
  dimensionScores?: unknown;
  contentHash?: unknown;
}

/** Structural marker: only Phase 3 seeded cards carry these columns. */
function isPhase3Row(row: FeedbackRow): boolean {
  if (!row) return false;
  return (
    row.displayKey !== undefined ||
    row.dimensionScores !== undefined ||
    row.contentHash !== undefined
  );
}

export function projectStudentFeedback(
  item: FeedbackItem,
  rows: FeedbackRow[]
) {
  const rowList = rows || [];
  if (item?.payload?.feedbackCardsFromItemId || rowList.some(isPhase3Row)) {
    return { allowed: false as const, feedback: [] };
  }
  return {
    allowed: true as const,
    feedback: rowList.map((row) =>
      row.revealed
        ? row
        : {
            ...row,
            reviewerUserId: undefined,
            source: undefined,
          }
    ),
  };
}
