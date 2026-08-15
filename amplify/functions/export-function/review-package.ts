/**
 * Pure logic for the faculty Review Package export.
 *
 * NO AWS calls here — the handler gathers raw rows and passes them in. This
 * module computes display-only metrics, selects the recommended attempt per
 * assignment, parses cue evidence, groups transcript turns by task, and shapes
 * the data the HTML renderer consumes.
 *
 * Mirrors the faculty page's verbal-engagement thresholds and the shared
 * transcript-grouping precedence (ported from
 * src/portals/shared/sessionDetail/transcriptGrouping.ts; the frontend module
 * cannot be imported across the src/ ↔ amplify/ boundary).
 */

// ───────────── Constants (kept in sync with the faculty page) ─────────────

// Verbal-engagement thresholds on AVERAGE words per student response.
export const ENGAGEMENT_THRESHOLDS = { briefMax: 3, extendedMin: 9 };
// A single student response of this many words or fewer counts as "short".
export const SHORT_RESPONSE_MAX_WORDS = 3;

export const LEGACY_TRANSCRIPT_GROUP_KEY = "legacy";
export const LEGACY_TRANSCRIPT_GROUP_LABEL = "Legacy / Ungrouped Conversation";

const TRANSCRIPT_LABELS: Record<string, string> = {
  "phase1#phase1-section-a": "Phase 1 Section A: Object Naming",
  "phase1#phase1-section-b": "Phase 1 Section B: Word Fluency",
  "phase1#phase1-section-c": "Phase 1 Section C: Sentence Completion",
  "phase1#phase1-section-d": "Phase 1 Section D: Responsive Speech",
  "phase2#phase2-ben-object-naming": "Phase 2 Ben: Object Naming with Cueing Practice",
  "phase2#phase2-ben-sentence-completion": "Phase 2 Ben: Sentence Completion Practice",
  "phase2#phase2-maria-object-naming": "Phase 2 Maria: Object Naming with Cueing Practice",
  "phase2#phase2-maria-sentence-completion": "Phase 2 Maria: Sentence Completion Practice",
};

// ───────────── Types ─────────────

export interface TurnLike {
  userText?: string | null;
  modelText?: string | null;
  userSpeechStartAt?: string | null;
  patientSpeechStartAt?: string | null;
  timestamp?: string | null;
  progressKey?: string | null;
  phaseId?: string | null;
  taskId?: string | null;
  sectionId?: string | null;
  taskType?: string | null;
  patientPersonaId?: string | null;
  [k: string]: unknown;
}

export interface CueSummary {
  /** Required human wording (already chosen per the evidence state). */
  text: string;
  semantic: number;
  phonemic: number;
  model: number;
  /** True when at least one evidence item[] entry was found. */
  hasItems: boolean;
  /** Per-item breakdown (only populated when item evidence exists). */
  items: Array<{ itemId: string; level: string | null; hasCue: boolean }>;
}

export interface AttemptMetrics {
  durationLabel: string;
  durationMs: number | null;
  totalTurns: number;
  studentResponses: number;
  totalStudentWords: number;
  avgWordsPerResponse: number | null;
  avgWordsPerResponseLabel: string;
  shortResponses: number;
  longestResponseWords: number;
  engagementLabel: string | null;
}

export interface TaskBlock {
  key: string;
  label: string;
  itemsSubmittedLabel: string;
  studentResponses: number;
  avgWordsPerResponseLabel: string;
  cue: CueSummary;
  turns: TurnLike[];
}

export interface AttemptView {
  sessionId: string;
  attemptNo: number;
  status: string;
  startedAt: string;
  endedAt: string | null;
  recommended: boolean;
  recommendReason: string | null;
  metrics: AttemptMetrics;
  cue: CueSummary;
  completionCheck: string;
  taskBlocks: TaskBlock[];
}

export interface AssignmentView {
  assignmentId: string;
  title: string;
  completedAttemptCount: number;
  attempts: AttemptView[]; // recommended first, then others
}

export interface ModuleView {
  moduleId: string;
  title: string;
  position: number;
  hasCompleted: boolean;
  assignments: AssignmentView[];
}

export interface ReviewPackage {
  studentEmail: string;
  modules: ModuleView[];
}

export interface BuildInput {
  studentEmail: string;
  modules: any[];
  moduleItems: any[];
  assignmentsById: Map<string, any>;
  completedSessionsByAssignment: Map<string, any[]>;
  turnsBySession: Map<string, TurnLike[]>;
  evidenceBySession: Map<string, any[]>;
}

// ───────────── Small helpers ─────────────

export function wordCount(text: string | null | undefined): number {
  return (text ?? "").trim().split(/\s+/).filter(Boolean).length;
}

function normId(value?: string | null): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatDurationMs(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  return `${m}m ${pad(s)}s`;
}

/** Wall-clock time-of-day label for a transcript line, e.g. "1:23:21 PM" (UTC). */
export function formatClockTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  try {
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "UTC",
    });
  } catch {
    return "";
  }
}

function engagementLabel(avg: number | null): string | null {
  if (avg == null) return null;
  if (avg <= ENGAGEMENT_THRESHOLDS.briefMax) return "Brief responses";
  if (avg >= ENGAGEMENT_THRESHOLDS.extendedMin) return "Extended responses";
  return "Moderate responses";
}

// ───────────── Metrics ─────────────

interface RawEngagement {
  totalTurns: number;
  studentResponses: number;
  totalStudentWords: number;
  avgWordsPerResponse: number | null;
  shortResponses: number;
  longestResponseWords: number;
}

function computeEngagement(turns: TurnLike[]): RawEngagement {
  let studentResponses = 0;
  let totalStudentWords = 0;
  let shortResponses = 0;
  let longestResponseWords = 0;
  for (const t of turns) {
    const text = (t.userText ?? "").trim();
    if (text === "") continue;
    const wc = wordCount(text);
    studentResponses += 1;
    totalStudentWords += wc;
    if (wc <= SHORT_RESPONSE_MAX_WORDS) shortResponses += 1;
    if (wc > longestResponseWords) longestResponseWords = wc;
  }
  return {
    totalTurns: turns.length,
    studentResponses,
    totalStudentWords,
    avgWordsPerResponse: studentResponses > 0 ? totalStudentWords / studentResponses : null,
    shortResponses,
    longestResponseWords,
  };
}

function attemptDurationMs(session: any, turns: TurnLike[]): number | null {
  const start = session?.startedAt ? new Date(session.startedAt).getTime() : NaN;
  const end = session?.endedAt ? new Date(session.endedAt).getTime() : NaN;
  if (!isNaN(start) && !isNaN(end) && end >= start) return end - start;
  // Fallback: last turn timestamp (only used for the display label, never for
  // the recommended-attempt "valid duration" ranking).
  if (!isNaN(start) && turns.length > 0) {
    const lastTs = turns[turns.length - 1]?.timestamp;
    const last = lastTs ? new Date(lastTs).getTime() : NaN;
    if (!isNaN(last) && last >= start) return last - start;
  }
  return null;
}

function buildMetrics(session: any, turns: TurnLike[]): AttemptMetrics {
  const eng = computeEngagement(turns);
  const hasEnd = Boolean(session?.endedAt);
  const validDurationMs =
    hasEnd && session?.startedAt
      ? new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()
      : null;
  const displayMs = attemptDurationMs(session, turns);
  const durationLabel =
    displayMs != null && displayMs >= 0
      ? `${formatDurationMs(displayMs)}${hasEnd ? "" : " (approx — no end time recorded)"}`
      : "Duration unavailable (no end time recorded)";
  const avg = eng.avgWordsPerResponse;
  return {
    durationLabel,
    durationMs: validDurationMs != null && validDurationMs >= 0 ? validDurationMs : null,
    totalTurns: eng.totalTurns,
    studentResponses: eng.studentResponses,
    totalStudentWords: eng.totalStudentWords,
    avgWordsPerResponse: avg,
    avgWordsPerResponseLabel: avg == null ? "—" : avg.toFixed(1),
    shortResponses: eng.studentResponses === 0 ? 0 : eng.shortResponses,
    longestResponseWords: eng.longestResponseWords,
    engagementLabel: engagementLabel(avg),
  };
}

// ───────────── Cue parsing (from SessionEvidence) ─────────────

export function normCueLevel(v: unknown): "Semantic" | "Phonemic" | "Model" | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (s.startsWith("sem")) return "Semantic";
  if (s.startsWith("phon")) return "Phonemic";
  if (s.startsWith("mod")) return "Model";
  return null;
}

export function asObject(value: unknown): any | null {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return null;
}

interface CueAccumulator {
  semantic: number;
  phonemic: number;
  model: number;
  hasItems: boolean;
  hasEvidence: boolean;
  eventLevel: boolean;
  items: Array<{ itemId: string; level: string | null; hasCue: boolean }>;
}

function emptyCueAcc(): CueAccumulator {
  return {
    semantic: 0,
    phonemic: 0,
    model: 0,
    hasItems: false,
    hasEvidence: false,
    eventLevel: false,
    items: [],
  };
}

/** Fold one SessionEvidence row's cue data into the accumulator (defensive). */
function accumulateEvidence(acc: CueAccumulator, evidenceRow: any): void {
  acc.hasEvidence = true;
  const payload = asObject(evidenceRow?.rawEvidencePayload);
  const ctx = asObject(payload?.studyTaskContext);
  if (!ctx) return;

  const items = Array.isArray(ctx.items) ? ctx.items : null;
  if (items) {
    for (const raw of items) {
      const item = asObject(raw);
      if (!item) continue;
      acc.hasItems = true;
      const level = normCueLevel(item.cueLevel);
      const hasCue = item.cueUsed === true || level !== null;
      if (hasCue) {
        if (level === "Semantic") acc.semantic += 1;
        else if (level === "Phonemic") acc.phonemic += 1;
        else if (level === "Model") acc.model += 1;
      }
      acc.items.push({
        itemId: String(item.itemId ?? "").trim() || "(unlabeled item)",
        level,
        hasCue,
      });
    }
  }

  // Optional event-level cue presses — only used if present and safely parsed.
  const events = Array.isArray(ctx.interactionEvents) ? ctx.interactionEvents : null;
  if (events && !items) {
    for (const raw of events) {
      const ev = asObject(raw);
      if (!ev) continue;
      const type = String(ev.type ?? ev.eventType ?? "").trim().toLowerCase();
      if (type && !type.includes("cue")) continue;
      const level = normCueLevel(ev.cueLevel ?? ev.cueType ?? ev.level);
      if (level === "Semantic") acc.semantic += 1;
      else if (level === "Phonemic") acc.phonemic += 1;
      else if (level === "Model") acc.model += 1;
      if (level || type.includes("cue")) acc.eventLevel = true;
    }
  }
}

function finalizeCue(acc: CueAccumulator): CueSummary {
  const total = acc.semantic + acc.phonemic + acc.model;
  let text: string;
  if (acc.hasItems && total > 0) {
    text = `Recorded cue use by item: Semantic ${acc.semantic}, Phonemic ${acc.phonemic}, Model ${acc.model}.`;
  } else if (acc.eventLevel) {
    text = `Recorded cue presses: Semantic ${acc.semantic}, Phonemic ${acc.phonemic}, Model ${acc.model}.`;
  } else if (acc.hasItems) {
    text = "No cue recorded in submitted evidence.";
  } else {
    text = "Cue data unavailable for this attempt.";
  }
  return {
    text,
    semantic: acc.semantic,
    phonemic: acc.phonemic,
    model: acc.model,
    hasItems: acc.hasItems,
    items: acc.items,
  };
}

function cueForEvidenceRows(rows: any[]): CueSummary {
  const acc = emptyCueAcc();
  for (const row of rows) accumulateEvidence(acc, row);
  return finalizeCue(acc);
}

/** Normalized `${phaseId}#${taskId||sectionId}` identity for an evidence row. */
function evidenceTaskIdentity(row: any): string {
  const phase = normId(row?.phaseId);
  const taskOrSection = normId(row?.taskId) || normId(row?.sectionId);
  if (!phase && !taskOrSection) return "";
  return `${phase}#${taskOrSection}`;
}

// ───────────── Transcript grouping (ported from the shared frontend util) ─────────────

function knownTranscriptLabel(turn: TurnLike): string | null {
  const candidates: string[] = [];
  const progressKey = normId(turn.progressKey);
  if (progressKey) candidates.push(progressKey);
  const phaseId = normId(turn.phaseId);
  const taskId = normId(turn.taskId);
  if (phaseId && taskId) candidates.push(`${phaseId}#${taskId}`);
  const sectionId = normId(turn.sectionId);
  if (phaseId && sectionId) candidates.push(`${phaseId}#${sectionId}`);
  for (const c of candidates) {
    if (TRANSCRIPT_LABELS[c]) return TRANSCRIPT_LABELS[c];
  }
  return null;
}

function titleFromIdentifier(value: string): string {
  return value
    .replace(/^phase(\d+)/, "phase $1")
    .split(/[-_#\s]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function groupKeyFor(turn: TurnLike): string {
  const progressKey = normId(turn.progressKey);
  if (progressKey) return `progress:${progressKey}`;
  const phaseId = normId(turn.phaseId);
  const taskId = normId(turn.taskId);
  if (phaseId && taskId) return `task:${phaseId}#${taskId}`;
  const sectionId = normId(turn.sectionId);
  if (phaseId && sectionId) return `section:${phaseId}#${sectionId}`;
  return LEGACY_TRANSCRIPT_GROUP_KEY;
}

function groupLabelFor(turn: TurnLike): string {
  const known = knownTranscriptLabel(turn);
  if (known) return known;
  const phaseId = normId(turn.phaseId);
  const taskId = normId(turn.taskId);
  const sectionId = normId(turn.sectionId);
  const taskType = normId(turn.taskType);
  const persona = normId(turn.patientPersonaId);
  if (!phaseId && !taskId && !sectionId) return LEGACY_TRANSCRIPT_GROUP_LABEL;
  const phaseLabel = phaseId ? titleFromIdentifier(phaseId) : "Session";
  let taskLabel = "Conversation";
  if (taskId || sectionId) taskLabel = titleFromIdentifier(taskId || sectionId);
  else if (taskType) taskLabel = titleFromIdentifier(taskType);
  const personaLabel = persona ? `${titleFromIdentifier(persona)}: ` : "";
  return `${phaseLabel} ${personaLabel}${taskLabel}`;
}

/** The set of normalized identities a group can be matched against evidence by. */
function groupTaskIdentities(turn: TurnLike): Set<string> {
  const out = new Set<string>();
  const progressKey = normId(turn.progressKey);
  if (progressKey) out.add(progressKey);
  const phaseId = normId(turn.phaseId);
  const taskId = normId(turn.taskId);
  const sectionId = normId(turn.sectionId);
  if (phaseId && taskId) out.add(`${phaseId}#${taskId}`);
  if (phaseId && sectionId) out.add(`${phaseId}#${sectionId}`);
  return out;
}

// ───────────── Build one attempt ─────────────

function buildAttempt(
  session: any,
  turns: TurnLike[],
  evidenceRows: any[]
): AttemptView {
  const metrics = buildMetrics(session, turns);
  const sessionCue = cueForEvidenceRows(evidenceRows);

  // Completion check wording.
  const isCompleted = session?.status === "completed";
  let completionCheck: string;
  if (!isCompleted) {
    completionCheck = "Session not marked completed. Review with caution.";
  } else if (sessionCue.hasItems) {
    const n = sessionCue.items.length;
    completionCheck = `Session marked completed. Items submitted: ${n}. Item-level transcript completion is not automatically verified.`;
  } else {
    completionCheck =
      "Session marked completed. Item-level evidence unavailable; item-level transcript completion is not automatically verified.";
  }

  // Group transcript by task (insertion order), and pre-bucket evidence rows by
  // their normalized task identity so each task block gets its own cue summary.
  const groups = new Map<string, { label: string; turns: TurnLike[]; ids: Set<string> }>();
  for (const t of turns) {
    const key = groupKeyFor(t);
    const existing = groups.get(key);
    if (existing) {
      existing.turns.push(t);
      for (const id of groupTaskIdentities(t)) existing.ids.add(id);
      continue;
    }
    groups.set(key, { label: groupLabelFor(t), turns: [t], ids: groupTaskIdentities(t) });
  }

  const evidenceByIdentity = new Map<string, any[]>();
  for (const row of evidenceRows) {
    const id = evidenceTaskIdentity(row);
    if (!id) continue;
    const list = evidenceByIdentity.get(id) ?? [];
    list.push(row);
    evidenceByIdentity.set(id, list);
  }

  const taskBlocks: TaskBlock[] = [];
  for (const [key, g] of groups) {
    const matchedEvidence: any[] = [];
    for (const id of g.ids) {
      const rows = evidenceByIdentity.get(id);
      if (rows) matchedEvidence.push(...rows);
    }
    const cue = matchedEvidence.length > 0 ? cueForEvidenceRows(matchedEvidence) : finalizeCue(emptyCueAcc());
    const eng = computeEngagement(g.turns);
    const itemsSubmittedLabel = cue.hasItems ? String(cue.items.length) : "—";
    taskBlocks.push({
      key,
      label: g.label,
      itemsSubmittedLabel,
      studentResponses: eng.studentResponses,
      avgWordsPerResponseLabel:
        eng.avgWordsPerResponse == null ? "—" : eng.avgWordsPerResponse.toFixed(1),
      cue,
      turns: g.turns,
    });
  }

  return {
    sessionId: String(session?.sessionId ?? ""),
    attemptNo: Number(session?.attemptNo ?? 0),
    status: String(session?.status ?? "unknown"),
    startedAt: String(session?.startedAt ?? ""),
    endedAt: session?.endedAt ? String(session.endedAt) : null,
    recommended: false,
    recommendReason: null,
    metrics,
    cue: sessionCue,
    completionCheck,
    taskBlocks,
  };
}

// ───────────── Recommended attempt ─────────────

function startedAtMs(a: AttemptView): number {
  const t = a.startedAt ? new Date(a.startedAt).getTime() : NaN;
  return isNaN(t) ? 0 : t;
}

/**
 * Rank attempts per the recommended-attempt rule:
 *  1. completed first  2. longest valid duration  3. more student responses
 *  4. more total turns  5. (fallback) longest available, flagged not completed
 *  6. attemptNo unreliable → startedAt used for stable ordering/tie-break.
 * Mutates the chosen attempt's `recommended`/`recommendReason` and returns the
 * list ordered recommended-first then by startedAt ascending.
 */
function orderWithRecommended(attempts: AttemptView[]): AttemptView[] {
  if (attempts.length === 0) return [];
  const score = (a: AttemptView): [number, number, number, number, number] => [
    a.status === "completed" ? 1 : 0,
    a.metrics.durationMs ?? -1,
    a.metrics.studentResponses,
    a.metrics.totalTurns,
    -startedAtMs(a), // earlier first on full tie
  ];
  const ranked = [...attempts].sort((x, y) => {
    const sx = score(x);
    const sy = score(y);
    for (let i = 0; i < sx.length; i++) {
      if (sy[i] !== sx[i]) return sy[i] - sx[i];
    }
    return 0;
  });

  const best = ranked[0];
  best.recommended = true;
  best.recommendReason = buildRecommendReason(best, attempts.length);

  // Display order: recommended first, then the rest by startedAt ascending.
  const rest = attempts
    .filter((a) => a.sessionId !== best.sessionId)
    .sort((a, b) => startedAtMs(a) - startedAtMs(b));
  return [best, ...rest];
}

function buildRecommendReason(best: AttemptView, totalCompleted: number): string {
  if (best.status !== "completed") {
    return "No completed attempt found — longest available attempt shown; review with caution (not completed).";
  }
  if (totalCompleted === 1) {
    return "Only completed attempt for this assignment.";
  }
  const parts: string[] = [];
  if (best.metrics.durationMs != null) {
    parts.push(`longest completed attempt (${best.metrics.durationLabel})`);
  } else {
    parts.push("most complete attempt");
  }
  parts.push(`${best.metrics.studentResponses} student responses`);
  parts.push(`${best.metrics.totalTurns} turns`);
  return `Recommended: ${parts.join(", ")}.`;
}

// ───────────── Build the whole package ─────────────

export function buildReviewPackage(input: BuildInput): ReviewPackage {
  const modulesSorted = [...input.modules].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0)
  );

  const itemsByModuleId = new Map<string, any[]>();
  for (const it of input.moduleItems) {
    const list = itemsByModuleId.get(it.moduleId) ?? [];
    list.push(it);
    itemsByModuleId.set(it.moduleId, list);
  }

  const moduleViews: ModuleView[] = [];
  for (const mod of modulesSorted) {
    const items = (itemsByModuleId.get(mod.moduleId) ?? [])
      .filter((it) => it.itemType === "assignment")
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

    // Modules with NO assignment items are not relevant to a review package.
    if (items.length === 0) continue;

    const assignments: AssignmentView[] = [];
    for (const it of items) {
      const payload = asObject(it.payload) ?? {};
      const assignmentId = String(payload.assignmentId ?? "").trim();
      if (!assignmentId) continue;
      const assignment = input.assignmentsById.get(assignmentId);
      const completed = input.completedSessionsByAssignment.get(assignmentId) ?? [];
      if (completed.length === 0) continue;

      const attempts = completed.map((session) =>
        buildAttempt(
          session,
          input.turnsBySession.get(session.sessionId) ?? [],
          input.evidenceBySession.get(session.sessionId) ?? []
        )
      );
      const ordered = orderWithRecommended(attempts);
      assignments.push({
        assignmentId,
        title: String(assignment?.title ?? it.title ?? "Assignment"),
        completedAttemptCount: ordered.length,
        attempts: ordered,
      });
    }

    moduleViews.push({
      moduleId: mod.moduleId,
      title: String(mod.title ?? "Module"),
      position: mod.position ?? 0,
      hasCompleted: assignments.length > 0,
      assignments,
    });
  }

  return { studentEmail: input.studentEmail, modules: moduleViews };
}
