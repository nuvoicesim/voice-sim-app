import type {
  CuePressedInteractionEvent,
  SessionEvidenceRow,
} from "../../../api/sessionEvidenceApi";

/**
 * Cue Support Access event helpers.
 *
 * Extracts cue_pressed entries from SessionEvidence.rawEvidencePayload so the
 * faculty session/transcript view can render them as System Event rows
 * alongside transcript turns.
 *
 * Important terminology used by the rendering layer:
 *   - "Cue Support Access" — student clicked or viewed a system cue button.
 *   - "Transcript-Detected Cue Use" — NOT implemented in this round.
 *
 * Cue Support Access does NOT prove actual cue use. We never label cue
 * button clicks as "cue used", "correct cue", "hierarchy followed", etc.
 */

export interface CueSupportAccessEvent {
  /** Stable key for React; not from backend. */
  key: string;
  /** Source evidence row this event was extracted from. */
  evidenceId: string;
  /**
   * First valid ISO timestamp found on the cue_pressed entry. The Unity
   * client has used `timestamp` in some builds and `occurredAt` in others,
   * with `clientTimestamp` / `serverTimestamp` reserved for future builds.
   * We accept the first valid one rather than fabricating a value when all
   * are missing.
   */
  timestamp: string | null;
  /** Normalized cue level: "Semantic" | "Phonemic" | "Model" | null. */
  cueLevel: CueLevelLabel | null;
  /** Original cueLevel string as written by Unity, for defensive rendering. */
  rawCueLevel: string | null;
  /**
   * sectionId/taskId/itemId fall back to the parent SessionEvidence row's
   * fields when the cue_pressed entry omits them. Event-level identifiers
   * always win when present. We never fabricate identifiers if neither
   * level supplies them.
   */
  sectionId: string | null;
  taskId: string | null;
  itemId: string | null;
  cueText: string | null;
}

export type CueLevelLabel = "Semantic" | "Phonemic" | "Model";

const KNOWN_CUE_LEVELS: Record<string, CueLevelLabel> = {
  semantic: "Semantic",
  phonemic: "Phonemic",
  model: "Model",
};

function normalizeCueLevel(raw: unknown): {
  cueLevel: CueLevelLabel | null;
  rawCueLevel: string | null;
} {
  if (typeof raw !== "string") return { cueLevel: null, rawCueLevel: null };
  const trimmed = raw.trim();
  if (!trimmed) return { cueLevel: null, rawCueLevel: null };
  const lower = trimmed.toLowerCase();
  return {
    cueLevel: KNOWN_CUE_LEVELS[lower] ?? null,
    rawCueLevel: trimmed,
  };
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/**
 * Returns the first non-empty string value from `candidates`, treated as a
 * potential ISO-8601 timestamp. Empty / whitespace-only strings are skipped.
 * We do NOT validate that the string parses as a date here — that's the
 * timeline-merging layer's job (tsToMs in AssignmentItemDetail). This helper
 * is just "pick the first thing that looks like a timestamp string".
 */
function firstTimestamp(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    const s = asString(c);
    if (s) return s;
  }
  return null;
}

/**
 * Extracts the interactionEvents array from one evidence row's
 * rawEvidencePayload. Defensive against missing / malformed payloads — the
 * Unity client may evolve this shape over time.
 */
function readInteractionEvents(
  rawPayload: Record<string, unknown> | null
): unknown[] {
  if (!rawPayload || typeof rawPayload !== "object") return [];
  const studyCtx = (rawPayload as Record<string, unknown>).studyTaskContext;
  if (!studyCtx || typeof studyCtx !== "object") return [];
  const events = (studyCtx as Record<string, unknown>).interactionEvents;
  return Array.isArray(events) ? events : [];
}

/**
 * Extract cue_pressed events from one SessionEvidence row.
 *
 * Timestamp priority: event.timestamp → event.occurredAt →
 * event.clientTimestamp → event.serverTimestamp. Multiple Unity builds have
 * shipped under different field names; we accept all four so any one of them
 * is enough to land the event on the chronological timeline.
 *
 * Identifier fallback: event-level sectionId/taskId/itemId always wins. When
 * an event omits one of those identifiers, we fall back to the parent
 * SessionEvidence row's sectionId/taskId (the parent row has no itemId
 * column, so itemId stays event-level only). We never fabricate identifiers
 * if both levels are missing.
 */
export function extractCueEventsFromRow(
  row: SessionEvidenceRow
): CueSupportAccessEvent[] {
  const out: CueSupportAccessEvent[] = [];
  const events = readInteractionEvents(row.rawEvidencePayload);
  let localIndex = 0;
  const rowSectionId = asString(row.sectionId);
  const rowTaskId = asString(row.taskId);
  for (const raw of events) {
    if (!raw || typeof raw !== "object") continue;
    const ev = raw as CuePressedInteractionEvent;
    if (ev.eventType !== "cue_pressed") continue;
    const { cueLevel, rawCueLevel } = normalizeCueLevel(ev.cueLevel);
    out.push({
      key: `${row.evidenceId}:${localIndex++}`,
      evidenceId: row.evidenceId,
      timestamp: firstTimestamp(
        ev.timestamp,
        ev.occurredAt,
        ev.clientTimestamp,
        ev.serverTimestamp
      ),
      cueLevel,
      rawCueLevel,
      sectionId: asString(ev.sectionId) ?? rowSectionId,
      taskId: asString(ev.taskId) ?? rowTaskId,
      itemId: asString(ev.itemId),
      cueText: asString(ev.cueText),
    });
  }
  return out;
}

/**
 * Extract and flatten cue events across all evidence rows for a session.
 * Stable sort by timestamp ascending where present; timestamp-less events
 * preserve their evidence-row + array order so faculty don't see them slot
 * into the wrong chronological position.
 */
export function extractCueEvents(
  evidenceRows: SessionEvidenceRow[]
): CueSupportAccessEvent[] {
  const flat: CueSupportAccessEvent[] = [];
  for (const row of evidenceRows) {
    for (const ev of extractCueEventsFromRow(row)) flat.push(ev);
  }
  // Two-bucket sort: events with timestamps go first, in chronological order;
  // events without timestamps follow in insertion order.
  const withTs = flat.filter((e) => !!e.timestamp);
  const withoutTs = flat.filter((e) => !e.timestamp);
  withTs.sort((a, b) =>
    (a.timestamp ?? "").localeCompare(b.timestamp ?? "")
  );
  return [...withTs, ...withoutTs];
}

/**
 * Faculty-facing label for a single cue event row. Never claims actual
 * cue use; always frames the event as Cue Support Access.
 */
export function formatCueEventLabel(ev: CueSupportAccessEvent): string {
  if (ev.cueLevel) return `Student clicked ${ev.cueLevel} Cue`;
  if (ev.rawCueLevel) return `Student clicked cue: ${ev.rawCueLevel}`;
  return "Student clicked Cue (Cue Support Access)";
}
