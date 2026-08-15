/**
 * Pure logic for the faculty "Export Cue Events CSV" (internal research export).
 *
 * NO AWS calls here — the handler gathers raw rows and passes them in. This
 * module flattens SessionEvidence.rawEvidencePayload.studyTaskContext
 * .interactionEvents into one CSV row per cue_pressed event, preserving
 * repeated clicks and each event's original array index, plus one coverage
 * row per evidence submission (and per session without evidence) so missing
 * telemetry stays distinguishable from "no cue was used".
 *
 * interactionEvents holds several event types (item_tracking_started,
 * student_utterance_recorded, patient_utterance_recorded, cue_pressed, ...).
 * ONLY cue_pressed entries become row_type=cue_event rows; the others are
 * counted in interaction_event_count but never emitted. cue_press_count is
 * the number of actual cue clicks.
 *
 * Hard rules:
 *  - Never infer events from items[] summaries, transcripts, or scores.
 *  - Never emit transcript text, patient responses, cue message text, rubric
 *    output, prompts, target answers, voice settings, tokens, or secrets —
 *    only the explicitly whitelisted fields below are read from the payload.
 *  - Every field passes CSV escaping AND spreadsheet formula-injection
 *    neutralization, including student_email / source_student_id.
 */

import { asObject, normCueLevel } from "./review-package";

// Column order is the export's contract with the research team.
export const CUE_EVENTS_CSV_HEADER = [
  "row_type",
  "student_email",
  "source_student_id",
  "course_id",
  "assignment_id",
  "session_id",
  "evidence_id",
  "session_status",
  "phase_id",
  "section_id",
  "task_id",
  "item_id",
  "interaction_events_status",
  "interaction_event_count",
  "cue_press_count",
  "event_index",
  "event_type",
  "cue_level_raw",
  "cue_level_normalized",
  "event_item_id",
  "event_timestamp",
  "evidence_submitted_at",
] as const;

export type CueEventsCsvColumn = (typeof CUE_EVENTS_CSV_HEADER)[number];

/** A raw DynamoDB row (untyped attributes, accessed defensively). */
export type RawRow = Record<string, unknown>;

export interface CueEventsCsvInput {
  studentEmail: string;
  /** Cognito sub of the target student (source_student_id column). */
  studentUserId: string;
  courseId: string;
  /** assignmentIds belonging to the requested course — the course scope. */
  courseAssignmentIds: Set<string>;
  /** SimulationSession rows scanned by studentUserId (ALL statuses). */
  sessions: RawRow[];
  /** SessionEvidence rows scanned by studentUserId. */
  evidenceRows: RawRow[];
}

export type InteractionEventsStatus =
  | "present"
  | "empty"
  | "missing"
  | "invalid"
  | "no_evidence";

/**
 * Classify the telemetry state of one SessionEvidence row's
 * rawEvidencePayload.studyTaskContext.interactionEvents:
 *  - present  → array with at least one entry (events returned)
 *  - empty    → array with zero entries (telemetry ran, no events)
 *  - missing  → payload / studyTaskContext / interactionEvents absent
 *  - invalid  → payload or container exists but cannot be parsed as expected
 */
export function classifyInteractionEvents(rawEvidencePayload: unknown): {
  status: Exclude<InteractionEventsStatus, "no_evidence">;
  events: unknown[] | null;
} {
  if (rawEvidencePayload == null) return { status: "missing", events: null };
  const payload = asObject(rawEvidencePayload);
  if (!payload) return { status: "invalid", events: null };
  if (payload.studyTaskContext == null) return { status: "missing", events: null };
  const ctx = asObject(payload.studyTaskContext);
  if (!ctx) return { status: "invalid", events: null };
  const raw = ctx.interactionEvents;
  if (raw == null) return { status: "missing", events: null };
  if (!Array.isArray(raw)) return { status: "invalid", events: null };
  return { status: raw.length === 0 ? "empty" : "present", events: raw };
}

/**
 * CSV-encode one field: neutralize spreadsheet formula injection (leading
 * =, +, -, @ — also after leading whitespace — and leading tab/CR get a
 * single-quote prefix), then apply RFC 4180 quoting.
 */
export function csvField(value: string): string {
  let v = value;
  if (/^[\t\r]/.test(v) || /^\s*[=+\-@]/.test(v)) v = `'${v}`;
  if (/[",\r\n]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

/** Stringify a whitelisted scalar; anything non-scalar becomes "". */
function scalarString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return "";
}

function firstScalar(obj: RawRow, keys: string[]): string {
  for (const k of keys) {
    const s = scalarString(obj?.[k]);
    if (s !== "") return s;
  }
  return "";
}

/**
 * Collapse an event-type value to a comparable key: lowercase, alphanumerics
 * only — so "cue_pressed", "CuePressed", and "cue-pressed" all match while
 * "cue_shown", "item_tracking_started", or "student_utterance_recorded"
 * never do. Strict equality, not substring matching, so unrelated events can
 * never be classified as cue clicks.
 */
function canonicalEventType(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isCuePressed(ev: RawRow): boolean {
  return canonicalEventType(firstScalar(ev, ["eventType", "type"])) === "cuepressed";
}

type RowValues = Partial<Record<CueEventsCsvColumn, string>>;

function makeRow(values: RowValues): string[] {
  return CUE_EVENTS_CSV_HEADER.map((col) => values[col] ?? "");
}

function bySubmittedAtThenId(a: RawRow, b: RawRow): number {
  const sa = scalarString(a?.submittedAt);
  const sb = scalarString(b?.submittedAt);
  if (sa !== sb) return sa < sb ? -1 : 1;
  const ia = scalarString(a?.evidenceId);
  const ib = scalarString(b?.evidenceId);
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

function byStartedAtThenId(a: RawRow, b: RawRow): number {
  const sa = scalarString(a?.startedAt);
  const sb = scalarString(b?.startedAt);
  if (sa !== sb) return sa < sb ? -1 : 1;
  const ia = scalarString(a?.sessionId);
  const ib = scalarString(b?.sessionId);
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

export function buildCueEventsCsv(input: CueEventsCsvInput): string {
  // ── Scope guards (defense in depth on top of the handler's scans) ──
  // Only THIS student's rows, and only sessions/evidence attributable to THIS
  // course via its assignmentIds. Rows for any other student or course are
  // dropped even if the caller passed them in.
  const inCourse = (row: RawRow): boolean => {
    const assignmentId = row?.assignmentId;
    return typeof assignmentId === "string" && input.courseAssignmentIds.has(assignmentId);
  };
  const sessions = (input.sessions ?? []).filter(
    (s) => s?.studentUserId === input.studentUserId && inCourse(s)
  );
  const sessionIds = new Set(sessions.map((s) => scalarString(s?.sessionId)));

  const evidenceBySession = new Map<string, RawRow[]>();
  const orphanEvidence: RawRow[] = [];
  for (const e of input.evidenceRows ?? []) {
    if (e?.studentUserId !== input.studentUserId) continue;
    const sid = scalarString(e?.sessionId);
    if (sid && sessionIds.has(sid)) {
      const list = evidenceBySession.get(sid) ?? [];
      list.push(e);
      evidenceBySession.set(sid, list);
    } else if (inCourse(e)) {
      // Evidence submitted for this course whose session row is not visible
      // (or belongs to no scanned session). Kept, flagged via session_status.
      orphanEvidence.push(e);
    }
    // else: another course's evidence — excluded.
  }

  // Identity guard: never represent the student's opaque id as their email.
  // A missing email must be explicit and must never look like a valid email.
  const trimmedEmail = (input.studentEmail || "").trim();
  const studentEmail =
    trimmedEmail !== "" && trimmedEmail !== input.studentUserId
      ? trimmedEmail
      : "email_unavailable";

  const base: RowValues = {
    student_email: studentEmail,
    source_student_id: input.studentUserId,
    course_id: input.courseId,
  };

  const rows: string[][] = [];

  const emitEvidenceRows = (evidence: RawRow, sessionStatus: string): void => {
    const { status, events } = classifyInteractionEvents(evidence?.rawEvidencePayload);
    // Only actual cue_pressed entries become cue_event rows. Tracking and
    // utterance events, and unparseable entries, are counted in
    // interaction_event_count but never emitted. event_index stays the
    // entry's original position in the raw interactionEvents array.
    const cuePresses: Array<{ index: number; ev: RawRow }> = [];
    if (events) {
      events.forEach((rawEvent, index) => {
        const ev = asObject(rawEvent);
        if (ev && isCuePressed(ev)) cuePresses.push({ index, ev });
      });
    }
    const evidenceBase: RowValues = {
      ...base,
      assignment_id: scalarString(evidence?.assignmentId),
      session_id: scalarString(evidence?.sessionId),
      evidence_id: scalarString(evidence?.evidenceId),
      session_status: sessionStatus,
      phase_id: scalarString(evidence?.phaseId),
      section_id: scalarString(evidence?.sectionId),
      task_id: scalarString(evidence?.taskId),
      item_id: scalarString(evidence?.itemId),
      interaction_events_status: status,
      interaction_event_count: events ? String(events.length) : "",
      cue_press_count: events ? String(cuePresses.length) : "",
      evidence_submitted_at: scalarString(evidence?.submittedAt),
    };
    rows.push(makeRow({ ...evidenceBase, row_type: "coverage" }));
    for (const { index, ev } of cuePresses) {
      const cueRaw = firstScalar(ev, ["cueLevel", "cueType", "level"]);
      rows.push(
        makeRow({
          ...evidenceBase,
          row_type: "cue_event",
          event_index: String(index),
          event_type: firstScalar(ev, ["eventType", "type"]).trim(),
          cue_level_raw: cueRaw,
          cue_level_normalized: normCueLevel(cueRaw) ?? "",
          event_item_id: scalarString(ev.itemId).trim(),
          event_timestamp: firstScalar(ev, [
            "occurredAt",
            "timestamp",
            "eventTimestamp",
            "clientTimestamp",
            "at",
            "time",
          ]),
        })
      );
    }
  };

  for (const session of [...sessions].sort(byStartedAtThenId)) {
    const sid = scalarString(session?.sessionId);
    const evidenceRows = [...(evidenceBySession.get(sid) ?? [])].sort(bySubmittedAtThenId);
    const sessionStatus = scalarString(session?.status);
    if (evidenceRows.length === 0) {
      // Session happened (any status) but nothing was submitted — explicit,
      // so absence of evidence is distinguishable from absence of telemetry.
      rows.push(
        makeRow({
          ...base,
          row_type: "coverage",
          assignment_id: scalarString(session?.assignmentId),
          session_id: sid,
          session_status: sessionStatus,
          interaction_events_status: "no_evidence",
        })
      );
      continue;
    }
    for (const evidence of evidenceRows) emitEvidenceRows(evidence, sessionStatus);
  }

  for (const evidence of [...orphanEvidence].sort(bySubmittedAtThenId)) {
    emitEvidenceRows(evidence, "session_not_found");
  }

  const lines = [CUE_EVENTS_CSV_HEADER.map(csvField).join(",")];
  for (const row of rows) lines.push(row.map(csvField).join(","));
  return lines.join("\r\n") + "\r\n";
}
