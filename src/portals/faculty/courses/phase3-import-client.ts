/**
 * Client-side state and helpers for the Phase 3 Feedback Data Import panel.
 *
 * VALIDATION BOUNDARY — the rule this file exists to keep honest:
 *
 *   The browser does exactly three things: pick a file, POST its RAW TEXT, and
 *   render whatever the server says. Every check here is ADVISORY: it exists to
 *   fail fast on an obviously wrong file, never to authorize a write.
 *
 *   Parsing, cohort validation, account resolution, the tester gates, the
 *   provenance constants, idempotency and the atomic write all live in
 *   amplify/functions/module-item-function/phase3-import.ts, and the server
 *   re-evaluates all of them on commit — it does not trust that a preview
 *   happened, which is what `planHash` proves.
 *
 * The panel also never holds AWS credentials: every call goes through
 * src/api/apiClient.ts with the caller's Cognito token.
 */

/** Advisory upload ceiling; the server enforces the real one. */
export const PHASE3_MAX_CSV_BYTES = 1_000_000;

export type Phase3ImportMode = "tester" | "formal";

export type Phase3ImportPhase =
  | "idle"
  | "fileSelected"
  | "previewing"
  | "previewFailed"
  | "previewOk"
  | "committing"
  | "committed"
  | "commitFailed";

export interface Phase3PreviewCard {
  displayKey: string;
  sourceLabel: string;
  d1: string;
  d2: string;
  d3: string;
  contentHash: string;
  narrativePreview: string;
}

export interface Phase3PreviewStudent {
  reviewId: string;
  studyId: string;
  studentEmail: string;
  studentUserId: string;
  sourceOrder: string;
  cards: Phase3PreviewCard[];
}

export interface Phase3PreviewBody {
  mode: Phase3ImportMode;
  partsACItemId: string;
  partDItemId: string;
  planHash: string;
  batchId: string;
  sourceCsvSha256: string;
  studentCount: number;
  rowCount: number;
  provenance: { assignmentVersion: string; randomSeed: string };
  orderDistribution: Array<{
    order: string;
    actual: number;
    expected: number | null;
  }>;
  counts: {
    absent: number;
    exact: number;
    divergent: number;
    unexpected: number;
  };
  alreadyImported: boolean;
  /** Server-built; the browser echoes what was typed, it never builds this. */
  confirmPhrase: string | null;
  flowState: { testerGeneration: number | null; formalImportedAt: string | null };
  plan: Phase3PreviewStudent[];
  committed?: boolean;
  written?: number;
  verified?: boolean;
  markerBackfilled?: boolean;
}

export type PurgeExistence = "present" | "absent" | "unknown";

export interface PurgeTargetRef {
  moduleItemId: string;
  targeted: true;
  existence: PurgeExistence;
}

export interface PurgePlanEntry {
  studentUserId: string;
  studentEmail: string | null;
  feedbackIds: string[];
  displayKeys: string[];
  surveyInstances: PurgeTargetRef[];
  itemProgress: PurgeTargetRef[];
}

export interface PurgePreviewBody {
  scope: "one" | "all";
  partsACItemId: string;
  partDItemId: string;
  testerCount: number;
  plans: PurgePlanEntry[];
  retained: Record<string, boolean>;
  confirmPhrase: string | null;
  committed?: boolean;
  purged?: number;
  failed?: Array<{ studentUserId: string; reason: string }>;
}

/** How to describe one delete target without dressing a guess up as a fact. */
export function describeExistence(ref: PurgeTargetRef): string {
  if (ref.existence === "present") return "exists — will be deleted";
  if (ref.existence === "absent") return "not present — delete is a no-op";
  return "existence unknown — delete will be attempted";
}

export interface Phase3Tester {
  studentUserId: string;
  studentEmail: string | null;
  displayKeys: string[];
  rowCount: number;
  importedAt: string | null;
  batchId: string | null;
  revealed: boolean;
}

export interface Phase3Status {
  partsACItemId: string;
  partDItemId: string;
  provenance: { assignmentVersion: string; randomSeed: string };
  formal: {
    studentCount: number;
    rowCount: number;
    batchIds: string[];
    importedAt: string | null;
    batchId: string | null;
    complete: boolean;
    inconsistent: boolean;
    inconsistencyReason: string | null;
  };
  testers: Phase3Tester[];
  unknownRows: Array<{ feedbackId: string; studentUserId: string }>;
  formalImportUnlocked: boolean;
  expected: {
    studentCount: number;
    rowCount: number;
    sourceOrders: Record<string, number>;
  };
}

export interface Phase3ImportState {
  phase: Phase3ImportPhase;
  fileName: string | null;
  csvText: string | null;
  preview: Phase3PreviewBody | null;
  error: string | null;
  errorDetails: string[];
  result: Phase3PreviewBody | null;
}

export const initialImportState: Phase3ImportState = {
  phase: "idle",
  fileName: null,
  csvText: null,
  preview: null,
  error: null,
  errorDetails: [],
  result: null,
};

/**
 * Choosing a different file always discards the previous plan hash. A preview
 * confirms ONE exact upload; the server refuses a commit whose recomputed hash
 * differs, so letting a stale hash linger in the UI would only produce a
 * confusing 409.
 */
export function selectFile(
  fileName: string,
  csvText: string
): Phase3ImportState {
  return {
    ...initialImportState,
    phase: "fileSelected",
    fileName,
    csvText,
  };
}

/** Advisory only. A `null` result does not authorize anything. */
export function advisoryFileError(
  fileName: string,
  byteLength: number
): string | null {
  if (byteLength === 0) return "That file is empty.";
  if (byteLength > PHASE3_MAX_CSV_BYTES) {
    return `That file is ${Math.round(byteLength / 1024)} KB; the limit is ${
      PHASE3_MAX_CSV_BYTES / 1024
    } KB.`;
  }
  if (!/\.csv$/i.test(fileName)) {
    return "Choose the .csv ingestion file.";
  }
  return null;
}

/** Flatten a server error body into a headline plus detail lines. */
export function describeServerError(error: unknown): {
  message: string;
  details: string[];
} {
  const message =
    error instanceof Error ? error.message : "The request failed.";
  let details: string[] = [];
  const payload = (error as { details?: unknown })?.details;
  if (payload && typeof payload === "object") {
    const d = payload as Record<string, unknown>;
    if (Array.isArray(d.errors)) details = d.errors.map(String);
    else if (Array.isArray(d.divergent))
      details = (d.divergent as unknown[]).map(String);
    else if (Array.isArray(d.unknownRows))
      details = (d.unknownRows as Array<{ feedbackId?: string }>).map((r) =>
        String(r?.feedbackId ?? r)
      );
    else if (Array.isArray(d.studentUserIds))
      details = (d.studentUserIds as unknown[]).map(String);
  }
  return { message, details };
}

/**
 * The formal confirmation phrase, for DISPLAY ONLY.
 *
 * Built from the counts the server reported so the label matches what the server
 * will check — but the server rebuilds the phrase from its own constants and
 * compares verbatim, so this function has no authority. Calling the API directly
 * with a wrong (or missing) phrase is rejected there, not here.
 */
export function formalConfirmPhrase(expected: {
  studentCount: number;
  rowCount: number;
}): string {
  return `IMPORT ${expected.studentCount} STUDENTS / ${expected.rowCount} ROWS`;
}

/** Purge-all phrase, built from the server's live tester count. */
export function purgeAllConfirmPhrase(testerCount: number): string {
  return `PURGE ALL ${testerCount} TESTERS`;
}

export function matchesConfirmation(typed: string, expected: string): boolean {
  return typed.trim() === expected;
}

export function matchesEmail(typed: string, expected: string | null): boolean {
  if (!expected) return false;
  return typed.trim().toLowerCase() === expected.trim().toLowerCase();
}

/**
 * Why the formal import is locked, in the operator's terms. Derived purely
 * from the server's status — the browser never computes eligibility itself.
 */
export function formalLockReason(status: Phase3Status | null): string | null {
  if (!status) return "Loading the current import state…";
  // A flow whose stored rows and flow marker disagree is reported before the
  // tester gate: it is the more serious condition and the one an operator is
  // least likely to expect.
  if (status.formal.inconsistent && !status.formalImportUnlocked) {
    return status.formal.inconsistencyReason;
  }
  if (status.unknownRows.length > 0) {
    return `${status.unknownRows.length} Phase 3 row(s) under this flow cannot be classified as tester or formal data. Resolve them off the website before importing.`;
  }
  if (status.testers.length > 0) {
    return `${status.testers.length} tester${
      status.testers.length === 1 ? "" : "s"
    } still hold Phase 3 data. Run “Purge All Tester Data” first.`;
  }
  return null;
}

/** True when every card of every tester has been unblinded. */
export function testerRevealSummary(tester: Phase3Tester): string {
  return tester.revealed ? "revealed" : "blind";
}
