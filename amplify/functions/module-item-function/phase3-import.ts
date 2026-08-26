/**
 * Phase 3 feedback data import — server-side, fail-closed, atomic.
 *
 * Reuses POST /modules/{moduleId}/items?operation=... (see handler.ts) so no
 * API Gateway Resource/Method/Integration/Permission is added: api-stack sits
 * at CloudFormation's 500-resource limit.
 *
 * Design rules enforced here and nowhere else:
 *
 *  1. THE SERVER OWNS THE BINDING. Parts A-C / Part D item ids are discovered
 *     from the module every request. A client-supplied item id is never used.
 *
 *  2. ACCOUNTS COME FROM THE COURSE ROSTER. email -> studentUserId is resolved
 *     from active CourseEnrollment rows, which also proves the student is in
 *     this course. Zero matches, duplicate emails and two emails collapsing to
 *     one account are all hard failures.
 *
 *  3. TESTERS ARE PERMANENTLY DISQUALIFIED. Every tester import writes a
 *     deterministic EventLog marker that purge never deletes. A formal import
 *     BatchGets the 17 deterministic marker ids and refuses on any hit, so a
 *     tester account can never enter the formal cohort and the analysis
 *     exclusion list can never remove a real participant.
 *
 *  4. ALL-OR-NOTHING. The formal cohort is one TransactWriteItems (51 rows +
 *     the audit record). There is no resume, no stitching and no partial state:
 *     a mixed absent/exact preflight is a 409 that must be investigated off the
 *     website.
 *
 *  5. PURGE CANNOT REACH FORMAL DATA. Each ReviewerFeedback delete carries a
 *     four-part condition (_importKind/moduleItemId/studentUserId/displayKey).
 *     Those conditional deletes sit in the same transaction as the unconditional
 *     SurveyInstance / StudentItemProgress deletes, so they act as the
 *     authorization guard for the whole purge.
 *
 * Kept pure (storage injected) so every rule above is unit-testable without
 * DynamoDB, mirroring phase3-setup.ts and phase3-cards.ts.
 */

import { createHash } from "node:crypto";
import {
  PHASE3_DISPLAY_KEYS,
  PHASE3_EXPECTED_SOURCE_ORDERS,
  PHASE3_FORMAL_ASSIGNMENT_VERSION,
  PHASE3_FORMAL_BATCH_ATTR,
  PHASE3_FORMAL_IMPORTED_AT_ATTR,
  PHASE3_FORMAL_IMPORTED_EVENT_TYPE,
  PHASE3_FORMAL_RANDOM_SEED,
  PHASE3_FORMAL_ROW_COUNT,
  PHASE3_FORMAL_STUDENT_COUNT,
  PHASE3_IMPORT_KIND_FORMAL,
  PHASE3_IMPORT_KIND_TESTER,
  PHASE3_SOURCE_MAP,
  PHASE3_SOURCE_ORDER_KEYS,
  PHASE3_TEMPLATE_COLUMNS,
  PHASE3_TESTER_HISTORY_EVENT_TYPE,
  PHASE3_TESTER_IMPORTED_EVENT_TYPE,
  PHASE3_TESTER_PURGED_EVENT_TYPE,
  PHASE3_TESTER_GENERATION_ATTR,
  PHASE3_VALID_SCORES,
  phase3FormalConfirmPhrase,
  phase3ContentHash,
  phase3FeedbackId,
  phase3NormalizeScore,
  phase3SourceOrderLabel,
  phase3TesterHistoryEventId,
} from "../shared/phase3-cohort";
import {
  findPartDCandidates,
  findPartsACCandidates,
  PHASE3_FLOW_PART_D,
  PHASE3_FLOW_PARTS_AC,
  hasStrictCardSections,
  type ModuleItemRow,
} from "./phase3-setup";

// ───────────────────────── types ─────────────────────────

export type Phase3ImportMode = "tester" | "formal";

export interface Phase3TableNames {
  feedback: string;
  surveyInstance: string;
  studentItemProgress: string;
  eventLog: string;
  /** Host of the flow-state attributes used for cross-import mutual exclusion. */
  moduleItem: string;
}

export interface EnrollmentRow {
  studentUserId?: string;
  studentEmail?: string | null;
  status?: string;
}

export interface FeedbackRow extends Record<string, unknown> {
  feedbackId?: string;
  moduleItemId?: string;
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
  _importKind?: string;
  _importBatchId?: string;
  _importedAt?: string;
  _assignmentVersion?: string;
  _randomSeed?: string;
}

export interface Phase3ImportDeps {
  listModuleItems(moduleId: string): Promise<ModuleItemRow[]>;
  /** Every ReviewerFeedback row filed under the Parts A-C scope item. */
  scanFeedbackByItem(partsACItemId: string): Promise<FeedbackRow[]>;
  /** Every CourseEnrollment row for the course (status filtering happens here). */
  scanEnrollments(courseId: string): Promise<EnrollmentRow[]>;
  /**
   * Exact-key BatchGet against EventLog. MUST retry UnprocessedKeys and MUST
   * throw rather than return a partial answer — an unprocessed key means
   * "unknown", and a fail-closed gate may never read that as "absent".
   */
  batchGetEventIds(eventIds: string[]): Promise<Set<string>>;
  /** Exact key read, so a purge preview reports real existence, never a guess. */
  getSurveyInstance(
    moduleItemId: string,
    studentUserId: string
  ): Promise<Record<string, unknown> | null>;
  getStudentItemProgress(
    moduleItemId: string,
    studentUserId: string
  ): Promise<Record<string, unknown> | null>;
  transactWrite(
    transactItems: unknown[],
    clientRequestToken?: string
  ): Promise<void>;
  now(): string;
  tables: Phase3TableNames;
}

export interface Phase3TesterSummary {
  studentUserId: string;
  studentEmail: string | null;
  displayKeys: string[];
  rowCount: number;
  importedAt: string | null;
  batchId: string | null;
  revealed: boolean;
}

export interface Phase3StatusBody {
  partsACItemId: string;
  partDItemId: string;
  provenance: { assignmentVersion: string; randomSeed: string };
  formal: {
    studentCount: number;
    rowCount: number;
    batchIds: string[];
    importedAt: string | null;
    batchId: string | null;
    /** Rows AND flow marker both say the cohort landed. */
    complete: boolean;
    /** Rows and flow marker disagree — blocked until a human resolves it. */
    inconsistent: boolean;
    inconsistencyReason: string | null;
  };
  testers: Phase3TesterSummary[];
  unknownRows: Array<{ feedbackId: string; studentUserId: string }>;
  formalImportUnlocked: boolean;
  expected: {
    studentCount: number;
    rowCount: number;
    sourceOrders: Record<string, number>;
  };
}

export type Phase3ImportOutcome =
  | { status: 200; body: Record<string, unknown> }
  | {
      status: 400 | 403 | 404 | 409 | 500;
      body: { error: string; code?: string; details?: unknown };
    };

// ───────────────────────── CSV ─────────────────────────

/**
 * Minimal RFC4180 parser. Narratives are 100-200 words of free prose that may
 * contain commas, quotes and newlines, so naive splitting is not safe.
 * Byte-compatible with scripts/seed-phase3.mjs `parseCsv`.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let justClosedQuote = false;
  const src = String(text).replace(/^\uFEFF/, "");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
          justClosedQuote = true;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (justClosedQuote && ch !== "," && ch !== "\n" && ch !== "\r") {
      throw new Error("Malformed CSV: unexpected character after a closing quote.");
    }
    if (ch === '"') {
      if (field.length > 0) {
        throw new Error("Malformed CSV: a quoted field must begin with a quote.");
      }
      inQuotes = true;
      justClosedQuote = false;
    } else if (ch === ",") {
      row.push(field);
      field = "";
      justClosedQuote = false;
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      justClosedQuote = false;
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (inQuotes) throw new Error("Malformed CSV: unterminated quoted field.");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export interface Phase3Record {
  __line: number;
  review_id: string;
  study_id: string;
  student_email: string;
  display_key: string;
  source_internal: string;
  d1: string;
  d2: string;
  d3: string;
  /** Frozen source artifact: preserved byte-for-byte, whitespace included. */
  narrative: string;
  selected_source: string;
  session: string;
  student_turns: string;
}

/** Parse the upload and enforce the exact 12 frozen columns, in order. */
export function readTemplate(text: string): Phase3Record[] {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("The CSV has no data rows.");
  const header = rows[0].map((h) => h.trim());
  if (header.join("\u0000") !== PHASE3_TEMPLATE_COLUMNS.join("\u0000")) {
    throw new Error(
      `The ingestion template must have exactly the ${PHASE3_TEMPLATE_COLUMNS.length} frozen columns in order. ` +
        `Expected: ${PHASE3_TEMPLATE_COLUMNS.join(", ")}. Found: ${header.join(", ")}`
    );
  }
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].length !== PHASE3_TEMPLATE_COLUMNS.length) {
      throw new Error(
        `Line ${i + 1} has ${rows[i].length} columns; expected exactly ${PHASE3_TEMPLATE_COLUMNS.length}.`
      );
    }
  }
  const narrativeIdx = header.indexOf("narrative");
  return rows.slice(1).map((cells, idx) => {
    const record: Record<string, unknown> = { __line: idx + 2 };
    header.forEach((h, i) => {
      record[h] = (cells[i] ?? "").trim();
    });
    record.narrative = cells[narrativeIdx] ?? "";
    return record as unknown as Phase3Record;
  });
}

// ───────────────────────── validation ─────────────────────────

const EMAIL_RE = /^[^\s@"\\]+@[^\s@"\\]+\.[^\s@"\\]+$/;
const VALID_SCORE_SET = new Set(PHASE3_VALID_SCORES);

export function normalizeEmail(raw: unknown): string {
  return String(raw ?? "").normalize("NFC").trim().toLowerCase();
}

export function groupByEmail(
  records: Phase3Record[]
): Map<string, Phase3Record[]> {
  const byEmail = new Map<string, Phase3Record[]>();
  for (const r of records) {
    const key = normalizeEmail(r.student_email);
    if (!key) continue;
    if (!byEmail.has(key)) byEmail.set(key, []);
    byEmail.get(key)!.push(r);
  }
  return byEmail;
}

export function sourceOrderOf(rows: Phase3Record[]): string {
  const byKey: Record<string, string> = {};
  for (const r of rows) byKey[r.display_key] = r.source_internal;
  return phase3SourceOrderLabel(byKey);
}

export function orderDistribution(
  byEmail: Map<string, Phase3Record[]>
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const key of PHASE3_SOURCE_ORDER_KEYS) counts[key] = 0;
  for (const rows of byEmail.values()) {
    if (rows.length !== PHASE3_DISPLAY_KEYS.length) continue;
    if (rows.some((r) => !PHASE3_SOURCE_MAP[r.source_internal])) continue;
    const order = sourceOrderOf(rows);
    counts[order] = (counts[order] || 0) + 1;
  }
  return counts;
}

/**
 * Whole-file validation. Every problem is collected before returning so an
 * operator fixes the entire spreadsheet in one pass. Any error at all means
 * nothing is written.
 *
 * `mode` only changes the COHORT rules. Per-row and per-student rules — including
 * "narrative must not be empty" and "D1-D3 must be a real rating" — are
 * identical for testers and the formal cohort.
 */
export function validateRecords(
  records: Phase3Record[],
  mode: Phase3ImportMode
): string[] {
  const errors: string[] = [];
  const byEmail = groupByEmail(records);

  for (const r of records) {
    const where = `line ${r.__line} (${r.review_id || "no review_id"})`;
    if (!r.student_email) {
      errors.push(`${where}: student_email is empty`);
    } else if (!EMAIL_RE.test(r.student_email)) {
      errors.push(`${where}: student_email is not a safe exact email value`);
    }
    if (!(PHASE3_DISPLAY_KEYS as readonly string[]).includes(r.display_key)) {
      errors.push(
        `${where}: display_key must be A, B or C — got "${r.display_key}"`
      );
    }
    if (!PHASE3_SOURCE_MAP[r.source_internal]) {
      errors.push(
        `${where}: source_internal must be one of ai / faculty_1 / faculty_2 — got "${r.source_internal}". ` +
          `An empty value means the A/B/C counterbalancing has not been assigned yet.`
      );
    }
    for (const dim of ["d1", "d2", "d3"] as const) {
      const v = phase3NormalizeScore(r[dim]);
      if (!VALID_SCORE_SET.has(v)) {
        errors.push(
          `${where}: ${dim} must be 1, 2, 3, 4 or N/A — got "${r[dim]}"`
        );
      }
    }
    if (!String(r.narrative).trim()) {
      errors.push(`${where}: narrative is empty`);
    }
  }

  for (const [email, rows] of byEmail) {
    if (rows.length !== PHASE3_DISPLAY_KEYS.length) {
      errors.push(
        `${email}: expected exactly ${PHASE3_DISPLAY_KEYS.length} cards, found ${rows.length}`
      );
      continue;
    }
    const keys = rows.map((r) => r.display_key).sort();
    if (keys.join(",") !== "A,B,C") {
      errors.push(
        `${email}: display_key set must be exactly A,B,C — found ${keys.join(",")}`
      );
    }
    const sources = rows.map((r) => r.source_internal).sort();
    if (sources.join(",") !== "ai,faculty_1,faculty_2") {
      errors.push(
        `${email}: must have exactly 1 ai + 1 faculty_1 + 1 faculty_2 — found ${sources.join(",")}`
      );
    }
    const reviewIds = new Set(rows.map((r) => r.review_id));
    if (reviewIds.size !== 1) {
      errors.push(
        `${email}: rows span multiple review_id values (${[...reviewIds].join(", ")})`
      );
    }
  }

  // One review_id spread across two students would mean a student is about to
  // receive another participant's feedback.
  const emailsByReview = new Map<string, Set<string>>();
  for (const r of records) {
    const email = normalizeEmail(r.student_email);
    if (!r.review_id || !email) continue;
    if (!emailsByReview.has(r.review_id)) emailsByReview.set(r.review_id, new Set());
    emailsByReview.get(r.review_id)!.add(email);
  }
  for (const [reviewId, emails] of emailsByReview) {
    if (emails.size !== 1) {
      errors.push(
        `${reviewId}: maps to multiple students (${[...emails].join(", ")})`
      );
    }
  }

  if (mode === "tester") {
    // "Exactly one tester, three rows" is the shape of ONE tester import. It is
    // not a cap on how many testers a flow may hold — that is unbounded.
    if (byEmail.size !== 1) {
      errors.push(
        `A tester import must contain exactly 1 student — found ${byEmail.size}. ` +
          `Import testers one at a time; there is no limit on how many testers you may add.`
      );
    }
    if (records.length !== PHASE3_DISPLAY_KEYS.length) {
      errors.push(
        `A tester import must contain exactly ${PHASE3_DISPLAY_KEYS.length} rows (A/B/C) — found ${records.length}`
      );
    }
  } else {
    if (byEmail.size !== PHASE3_FORMAL_STUDENT_COUNT) {
      errors.push(
        `Expected ${PHASE3_FORMAL_STUDENT_COUNT} unique students, found ${byEmail.size}`
      );
    }
    if (records.length !== PHASE3_FORMAL_ROW_COUNT) {
      errors.push(
        `Expected ${PHASE3_FORMAL_ROW_COUNT} feedback rows, found ${records.length}`
      );
    }
    const actual = orderDistribution(byEmail);
    for (const order of PHASE3_SOURCE_ORDER_KEYS) {
      const expected = PHASE3_EXPECTED_SOURCE_ORDERS[order];
      const got = actual[order] || 0;
      if (got !== expected) {
        errors.push(
          `Source-order allocation ${order}: expected ${expected}, found ${got}`
        );
      }
    }
  }

  return errors;
}

// ───────────────────────── row building ─────────────────────────

export interface BuildRowContext {
  partsACItemId: string;
  studentUserId: string;
  now: string;
  importKind: string;
  importBatchId: string;
  importedByUserId: string;
  sourceCsvSha256: string;
  assignmentVersion?: string;
  randomSeed?: string;
}

/**
 * Build one ReviewerFeedback row. Audit columns are plain DynamoDB non-key
 * attributes written straight through the document client — the app never
 * reads ReviewerFeedback over AppSync, and the repo already does this for
 * ModuleItem's `_balanced*` counters, so no Amplify Data schema change is
 * needed. The `_` prefix marks them as not API-visible.
 */
export function buildRow(
  record: Phase3Record,
  ctx: BuildRowContext
): Record<string, unknown> {
  const mapping = PHASE3_SOURCE_MAP[record.source_internal];
  const d1 = phase3NormalizeScore(record.d1);
  const d2 = phase3NormalizeScore(record.d2);
  const d3 = phase3NormalizeScore(record.d3);
  const row: Record<string, unknown> = {
    feedbackId: phase3FeedbackId(ctx.studentUserId, record.display_key),
    moduleItemId: ctx.partsACItemId,
    studentUserId: ctx.studentUserId,
    source: mapping.source,
    reviewerUserId: null,
    displayLabel: mapping.displayLabel,
    body: record.narrative,
    score: null,
    // Phase 3 case selection happens outside VOICE and the template carries only
    // human-readable descriptors ("Maria Attempt 2"), never an internal session
    // id. Left null rather than fabricated.
    basedOnSessionId: null,
    dimensionScores: { d1, d2, d3 },
    displayKey: record.display_key,
    contentHash: phase3ContentHash(d1, d2, d3, record.narrative),
    revealed: false,
    locked: true,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    _importKind: ctx.importKind,
    _importBatchId: ctx.importBatchId,
    _importedByUserId: ctx.importedByUserId,
    _importedAt: ctx.now,
    _sourceCsvSha256: ctx.sourceCsvSha256,
  };
  // Formal provenance is never stamped on tester data.
  if (ctx.assignmentVersion) row._assignmentVersion = ctx.assignmentVersion;
  if (ctx.randomSeed) row._randomSeed = ctx.randomSeed;
  return row;
}

/**
 * Field-by-field equality against the frozen input, INCLUDING the import
 * provenance.
 *
 * Content equality alone is not enough to call a row "verified": a formal row
 * whose `_importKind` says tester, or whose `_assignmentVersion` is missing or
 * wrong, is not the cohort this upload describes even if every character of the
 * narrative matches. Treating it as exact would report "verified, 0 writes" over
 * mislabelled data.
 *
 * Attributes NOT in this list are still ignored, so rows written by
 * scripts/seed-phase3.mjs (or gaining new columns later) keep verifying — that
 * is what keeps the CLI `--verify` path and the website's exact check aligned.
 */
export function rowMatchesExpected(
  actual: FeedbackRow | undefined,
  expected: Record<string, unknown>
): boolean {
  if (!actual) return false;
  // Import provenance must match exactly, including "absent on both sides".
  if (actual._importKind !== expected._importKind) return false;
  if ((actual._assignmentVersion ?? null) !== (expected._assignmentVersion ?? null)) {
    return false;
  }
  if ((actual._randomSeed ?? null) !== (expected._randomSeed ?? null)) return false;
  const actualScores = (actual.dimensionScores || {}) as Record<string, unknown>;
  const expectedScores = expected.dimensionScores as Record<string, string>;
  const actualArtifactHash = phase3ContentHash(
    phase3NormalizeScore(actualScores.d1),
    phase3NormalizeScore(actualScores.d2),
    phase3NormalizeScore(actualScores.d3),
    (actual.body as string) ?? ""
  );
  return (
    actual.feedbackId === expected.feedbackId &&
    actual.moduleItemId === expected.moduleItemId &&
    actual.studentUserId === expected.studentUserId &&
    actual.source === expected.source &&
    actual.displayLabel === expected.displayLabel &&
    actual.reviewerUserId == null &&
    actual.displayKey === expected.displayKey &&
    actualScores.d1 === expectedScores.d1 &&
    actualScores.d2 === expectedScores.d2 &&
    actualScores.d3 === expectedScores.d3 &&
    actual.body === expected.body &&
    actual.contentHash === expected.contentHash &&
    actualArtifactHash === expected.contentHash &&
    actual.locked === true
  );
}

// ───────────────────────── preflight classification ─────────────────────────

export interface PreflightResult {
  absent: string[];
  exact: string[];
  divergent: string[];
  unexpected: string[];
}

/**
 * Four-way classification of what is already stored under the scope item for
 * the students in this upload. `unexpected` covers rows filed for one of THESE
 * students that the plan does not contain; other students' rows are the caller's
 * concern (see summarizeFeedbackRows).
 */
export function classifyExisting(
  expectedRows: Array<Record<string, unknown>>,
  storedRows: FeedbackRow[]
): PreflightResult {
  const expectedById = new Map<string, Record<string, unknown>>();
  for (const row of expectedRows) {
    expectedById.set(String(row.feedbackId), row);
  }
  const subjects = new Set(expectedRows.map((r) => String(r.studentUserId)));
  const storedById = new Map<string, FeedbackRow>();
  for (const row of storedRows) {
    if (!row?.feedbackId) continue;
    if (!subjects.has(String(row.studentUserId))) continue;
    storedById.set(String(row.feedbackId), row);
  }

  const result: PreflightResult = {
    absent: [],
    exact: [],
    divergent: [],
    unexpected: [],
  };
  for (const [feedbackId, expected] of expectedById) {
    const stored = storedById.get(feedbackId);
    if (!stored) result.absent.push(feedbackId);
    else if (rowMatchesExpected(stored, expected)) result.exact.push(feedbackId);
    else result.divergent.push(feedbackId);
  }
  for (const feedbackId of storedById.keys()) {
    if (!expectedById.has(feedbackId)) result.unexpected.push(feedbackId);
  }
  return result;
}

// ───────────────────────── plan hash ─────────────────────────

/**
 * Deterministic digest of the previewed plan. Commit must echo it, and the
 * server recomputes it from the RE-UPLOADED csv — so confirming a preview binds
 * the operator to exactly that content, with no server-side pending-import
 * state and no TTL.
 */
export function computePlanHash(input: {
  mode: Phase3ImportMode;
  partsACItemId: string;
  rows: Array<Record<string, unknown>>;
  assignmentVersion: string;
  randomSeed: string;
}): string {
  const rows = input.rows
    .map((r) =>
      [
        String(r.studentUserId),
        String(r.displayKey),
        String(r.source),
        String(r.displayLabel),
        String(r.contentHash),
      ].join("\u0000")
    )
    .sort();
  const canonical = JSON.stringify({
    v: 1,
    mode: input.mode,
    partsACItemId: input.partsACItemId,
    studentCount: new Set(input.rows.map((r) => String(r.studentUserId))).size,
    rowCount: input.rows.length,
    assignmentVersion: input.assignmentVersion,
    randomSeed: input.randomSeed,
    rows,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function batchIdFor(partsACItemId: string, planHash: string): string {
  return `${partsACItemId}:${planHash.slice(0, 12)}`;
}

/**
 * TransactWriteItems ClientRequestToken: <=36 chars, so a retried request that
 * already succeeded is not applied twice. Derived from the plan, never random.
 */
export function clientRequestTokenFor(planHash: string): string {
  return planHash.slice(0, 32);
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// ───────────────────────── EventLog rows ─────────────────────────

function dateKey(iso: string): string {
  return String(iso).slice(0, 10);
}

export interface EventContext {
  courseId: string;
  moduleId: string;
  partsACItemId: string;
  now: string;
}

/**
 * The permanent tester-history marker. Deterministic primary key so a formal
 * import can look it up with an exact BatchGet, and so re-importing the same
 * tester overwrites one row instead of accumulating duplicates.
 *
 * scripts/seed-phase3.mjs writes a byte-compatible row for CLI tester imports;
 * there must be no path that creates tester feedback without it.
 */
export function buildTesterHistoryMarker(
  ctx: EventContext,
  testerUserId: string,
  payload: Record<string, unknown>
): Record<string, unknown> {
  return {
    eventId: phase3TesterHistoryEventId(ctx.partsACItemId, testerUserId),
    studentUserId: testerUserId,
    studentDateKey: `${testerUserId}#${dateKey(ctx.now)}`,
    courseId: ctx.courseId,
    moduleId: ctx.moduleId,
    moduleItemId: ctx.partsACItemId,
    eventType: PHASE3_TESTER_HISTORY_EVENT_TYPE,
    payload,
    createdAt: ctx.now,
  };
}

export function buildAuditEvent(
  ctx: EventContext,
  eventId: string,
  studentUserId: string,
  eventType: string,
  payload: Record<string, unknown>
): Record<string, unknown> {
  return {
    eventId,
    studentUserId,
    studentDateKey: `${studentUserId}#${dateKey(ctx.now)}`,
    courseId: ctx.courseId,
    moduleId: ctx.moduleId,
    moduleItemId: ctx.partsACItemId,
    eventType,
    payload,
    createdAt: ctx.now,
  };
}

// ───────────────────────── transactions ─────────────────────────

// ───────────────── flow-level mutual exclusion ─────────────────

/**
 * Import state read off the Parts A–C ModuleItem row.
 *
 * `testerGeneration` is monotonic — it counts EVENTS (each tester import, each
 * tester purge), never live testers — so it can never drift out of agreement
 * with reality the way a population count would if someone edited rows outside
 * the website. Its only job is to make "the tester set has not changed since I
 * looked" a condition DynamoDB can enforce.
 */
export interface Phase3FlowState {
  /** null when the attribute has never been written. */
  testerGeneration: number | null;
  formalImportedAt: string | null;
  formalBatchId: string | null;
}

export function readFlowState(partsAC: ModuleItemRow): Phase3FlowState {
  const row = partsAC as unknown as Record<string, unknown>;
  const gen = row[PHASE3_TESTER_GENERATION_ATTR];
  const at = row[PHASE3_FORMAL_IMPORTED_AT_ATTR];
  const batch = row[PHASE3_FORMAL_BATCH_ATTR];
  return {
    testerGeneration: typeof gen === "number" ? gen : null,
    formalImportedAt: typeof at === "string" && at ? at : null,
    formalBatchId: typeof batch === "string" && batch ? batch : null,
  };
}

/**
 * The generation half of a guard condition, expressed so that "never written"
 * and "written and equal to N" are both exact matches rather than one being a
 * silent wildcard.
 */
function generationCondition(observed: number | null): {
  expression: string;
  values: Record<string, unknown>;
} {
  if (observed === null) {
    return { expression: `attribute_not_exists(#gen)`, values: {} };
  }
  return { expression: `#gen = :expectedGen`, values: { ":expectedGen": observed } };
}

/**
 * The conditional Update that every import and purge carries.
 *
 * Because all of them target the SAME DynamoDB item (the Parts A–C ModuleItem),
 * two concurrent transactions cannot both commit: DynamoDB serialises them and
 * cancels the loser. That is the mutual exclusion — the pre-flight scans are
 * only a fast, friendly failure ahead of it, never the thing being relied on.
 *
 *  - tester import: bumps the generation, and refuses once the formal cohort has
 *    landed.
 *  - formal commit: stamps the formal marker, and refuses unless the generation
 *    is exactly the one whose scan showed zero testers.
 *  - purge:         bumps the generation.
 */
export function buildFlowGuardUpdate(opts: {
  moduleItemTable: string;
  partsACItemId: string;
  observedGeneration: number | null;
  kind: "tester-import" | "formal-commit" | "purge";
  now: string;
  batchId?: string;
}): unknown {
  const gen = generationCondition(opts.observedGeneration);
  const names: Record<string, string> = {
    "#gen": PHASE3_TESTER_GENERATION_ATTR,
    "#formalAt": PHASE3_FORMAL_IMPORTED_AT_ATTR,
  };
  const values: Record<string, unknown> = { ...gen.values };

  if (opts.kind === "formal-commit") {
    names["#formalBatch"] = PHASE3_FORMAL_BATCH_ATTR;
    values[":now"] = opts.now;
    values[":batch"] = opts.batchId ?? "";
    return {
      Update: {
        TableName: opts.moduleItemTable,
        Key: { moduleItemId: opts.partsACItemId },
        UpdateExpression: "SET #formalAt = :now, #formalBatch = :batch",
        ConditionExpression: `attribute_not_exists(#formalAt) AND ${gen.expression}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      },
    };
  }

  const next = (opts.observedGeneration ?? 0) + 1;
  values[":next"] = next;
  const condition =
    opts.kind === "tester-import"
      ? `attribute_not_exists(#formalAt) AND ${gen.expression}`
      : gen.expression;
  return {
    Update: {
      TableName: opts.moduleItemTable,
      Key: { moduleItemId: opts.partsACItemId },
      UpdateExpression: "SET #gen = :next",
      ConditionExpression: condition,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    },
  };
}

export function buildImportTransactItems(opts: {
  tables: Phase3TableNames;
  rows: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  /** The flow guard. Required: an import without it is not race-safe. */
  guard: unknown;
}): unknown[] {
  return [
    opts.guard,
    ...opts.rows.map((Item) => ({
      Put: {
        TableName: opts.tables.feedback,
        Item,
        // Idempotency: a re-run writes nothing rather than duplicating, and a
        // concurrent writer loses the whole transaction instead of half of it.
        ConditionExpression: "attribute_not_exists(feedbackId)",
      },
    })),
    ...opts.events.map((Item) => ({
      Put: { TableName: opts.tables.eventLog, Item },
    })),
  ];
}

/**
 * One tester's purge, as a single atomic transaction.
 *
 * Every ReviewerFeedback delete is conditional on the row still being a tester
 * row of this student, under this scope item, at this display key. Because the
 * unconditional SurveyInstance / StudentItemProgress deletes ride in the same
 * transaction, those conditions are what authorizes the entire purge: if any of
 * them fails, nothing at all is deleted. The caller must therefore guarantee at
 * least one conditional delete is present (see executePhase3PurgeTester).
 *
 * The tester-history marker is deliberately absent from this list.
 */
export function buildPurgeTransactItems(opts: {
  tables: Phase3TableNames;
  partsACItemId: string;
  partDItemId: string;
  studentUserId: string;
  displayKeys: string[];
  auditEvent: Record<string, unknown>;
  /** The flow guard; a purge changes the tester set, so it bumps the generation. */
  guard: unknown;
}): unknown[] {
  const { tables, partsACItemId, partDItemId, studentUserId } = opts;
  return [
    opts.guard,
    ...opts.displayKeys.map((displayKey) => ({
      Delete: {
        TableName: tables.feedback,
        Key: { feedbackId: phase3FeedbackId(studentUserId, displayKey) },
        ConditionExpression:
          "#kind = :tester AND #mi = :ac AND #su = :sub AND #dk = :key",
        ExpressionAttributeNames: {
          "#kind": "_importKind",
          "#mi": "moduleItemId",
          "#su": "studentUserId",
          "#dk": "displayKey",
        },
        ExpressionAttributeValues: {
          ":tester": PHASE3_IMPORT_KIND_TESTER,
          ":ac": partsACItemId,
          ":sub": studentUserId,
          ":key": displayKey,
        },
      },
    })),
    {
      Delete: {
        TableName: tables.surveyInstance,
        Key: { moduleItemId: partsACItemId, studentUserId },
      },
    },
    {
      Delete: {
        TableName: tables.surveyInstance,
        Key: { moduleItemId: partDItemId, studentUserId },
      },
    },
    {
      Delete: {
        TableName: tables.studentItemProgress,
        Key: { moduleItemId: partsACItemId, studentUserId },
      },
    },
    {
      Delete: {
        TableName: tables.studentItemProgress,
        Key: { moduleItemId: partDItemId, studentUserId },
      },
    },
    { Put: { TableName: tables.eventLog, Item: opts.auditEvent } },
  ];
}

// ───────────────────────── flow discovery ─────────────────────────

export interface ResolvedFlow {
  partsAC: ModuleItemRow;
  partD: ModuleItemRow;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function payloadOf(item: ModuleItemRow): Record<string, unknown> {
  return isRecord(item.payload) ? item.payload : {};
}

/**
 * Discover the Phase 3 pair from the module itself. A client-supplied item id
 * is never trusted, and import is only ever offered against a flow that is
 * structurally Configured.
 */
export async function resolveConfiguredFlow(
  deps: Phase3ImportDeps,
  moduleId: string
): Promise<{ ok: true; flow: ResolvedFlow } | { ok: false; outcome: Phase3ImportOutcome }> {
  const items = await deps.listModuleItems(moduleId);
  const acCandidates = findPartsACCandidates(items, moduleId);
  if (acCandidates.length !== 1) {
    return {
      ok: false,
      outcome: {
        status: 409,
        body: {
          error:
            acCandidates.length === 0
              ? "This module has no Phase 3 Parts A–C survey. Run Phase 3 setup first."
              : `Multiple Parts A–C candidates exist in this module (${acCandidates
                  .map((c) => `"${c.title}" [${c.moduleItemId}]`)
                  .join(", ")}). Remove the duplicates first.`,
          code: "FLOW_NOT_CONFIGURED",
        },
      },
    };
  }
  const partsAC = acCandidates[0];
  const dCandidates = findPartDCandidates(items, moduleId, partsAC);
  if (dCandidates.length !== 1) {
    return {
      ok: false,
      outcome: {
        status: 409,
        body: {
          error:
            dCandidates.length === 0
              ? "This module has no Phase 3 Part D survey. Run Phase 3 setup first."
              : `Multiple Part D candidates exist in this module (${dCandidates
                  .map((c) => `"${c.title}" [${c.moduleItemId}]`)
                  .join(", ")}). Remove the duplicates first.`,
          code: "FLOW_NOT_CONFIGURED",
        },
      },
    };
  }
  const partD = dCandidates[0];

  const acPayload = payloadOf(partsAC);
  const dPayload = payloadOf(partD);
  const wired =
    acPayload.phase3Flow === PHASE3_FLOW_PARTS_AC &&
    acPayload.feedbackCardsFromItemId === partsAC.moduleItemId &&
    hasStrictCardSections(acPayload.cardSections) &&
    dPayload.phase3Flow === PHASE3_FLOW_PART_D &&
    dPayload.feedbackCardsFromItemId === partsAC.moduleItemId &&
    dPayload.requireFeedbackReveal === true;
  if (!wired) {
    return {
      ok: false,
      outcome: {
        status: 409,
        body: {
          error:
            "The Phase 3 survey flow is not fully configured. Run “Create and Connect” first, then import feedback data.",
          code: "FLOW_NOT_CONFIGURED",
        },
      },
    };
  }
  return { ok: true, flow: { partsAC, partD } };
}

// ───────────────────────── stored-state summary ─────────────────────────

export interface FeedbackSummary {
  formalStudentIds: string[];
  formalRowCount: number;
  formalBatchIds: string[];
  testers: Array<{
    studentUserId: string;
    displayKeys: string[];
    rowCount: number;
    importedAt: string | null;
    batchId: string | null;
    revealed: boolean;
  }>;
  unknownRows: Array<{ feedbackId: string; studentUserId: string }>;
}

/**
 * Classify everything stored under the scope item. A row without `_importKind`
 * is `unknown` — never silently treated as tester or formal. Unknown rows
 * block both formal import and purge-all until a human resolves them.
 */
export function summarizeFeedbackRows(rows: FeedbackRow[]): FeedbackSummary {
  const byStudent = new Map<string, FeedbackRow[]>();
  const unknownRows: Array<{ feedbackId: string; studentUserId: string }> = [];
  for (const row of rows || []) {
    const sub = String(row?.studentUserId ?? "");
    if (!sub) continue;
    if (!byStudent.has(sub)) byStudent.set(sub, []);
    byStudent.get(sub)!.push(row);
  }

  const formalStudentIds: string[] = [];
  const formalBatchIds = new Set<string>();
  let formalRowCount = 0;
  const testers: FeedbackSummary["testers"] = [];

  for (const [studentUserId, studentRows] of byStudent) {
    const kinds = new Set(studentRows.map((r) => r._importKind));
    for (const row of studentRows) {
      if (
        row._importKind !== PHASE3_IMPORT_KIND_FORMAL &&
        row._importKind !== PHASE3_IMPORT_KIND_TESTER
      ) {
        unknownRows.push({
          feedbackId: String(row.feedbackId ?? "(no feedbackId)"),
          studentUserId,
        });
      }
    }
    if (kinds.has(PHASE3_IMPORT_KIND_FORMAL)) {
      formalStudentIds.push(studentUserId);
      const formalRows = studentRows.filter(
        (r) => r._importKind === PHASE3_IMPORT_KIND_FORMAL
      );
      formalRowCount += formalRows.length;
      for (const r of formalRows) {
        if (r._importBatchId) formalBatchIds.add(String(r._importBatchId));
      }
    }
    if (kinds.has(PHASE3_IMPORT_KIND_TESTER)) {
      const testerRows = studentRows.filter(
        (r) => r._importKind === PHASE3_IMPORT_KIND_TESTER
      );
      testers.push({
        studentUserId,
        displayKeys: testerRows
          .map((r) => String(r.displayKey ?? "?"))
          .sort(),
        rowCount: testerRows.length,
        importedAt: testerRows[0]?._importedAt
          ? String(testerRows[0]._importedAt)
          : null,
        batchId: testerRows[0]?._importBatchId
          ? String(testerRows[0]._importBatchId)
          : null,
        revealed:
          testerRows.length > 0 && testerRows.every((r) => r.revealed === true),
      });
    }
  }

  return {
    formalStudentIds: formalStudentIds.sort(),
    formalRowCount,
    formalBatchIds: [...formalBatchIds].sort(),
    testers: testers.sort((a, b) =>
      a.studentUserId.localeCompare(b.studentUserId)
    ),
    unknownRows,
  };
}

// ───────────────────────── enrollment resolution ─────────────────────────

export interface EmailResolution {
  ok: boolean;
  errors: string[];
  /** normalized email -> studentUserId */
  resolved: Map<string, string>;
  /** studentUserId -> normalized email (for display) */
  emailBySub: Map<string, string>;
}

/**
 * Resolve emails through the course roster, never through a global directory
 * lookup: an account that is not actively enrolled in THIS course must not
 * receive Phase 3 material, and this also removes the need for any new Cognito
 * IAM permission.
 */
export function resolveEmailsFromEnrollments(
  emails: string[],
  enrollments: EnrollmentRow[]
): EmailResolution {
  const errors: string[] = [];
  // ROWS, not distinct accounts. Two active enrollment rows for one email are a
  // roster defect even when both point at the same sub: something wrote the
  // roster twice, and this import must not be the thing that decides which row
  // was intended. De-duplicating by account would hide exactly that.
  const rowsByEmail = new Map<string, string[]>();
  for (const row of enrollments || []) {
    if (row?.status !== "active") continue;
    const email = normalizeEmail(row.studentEmail);
    const sub = String(row.studentUserId ?? "");
    if (!email || !sub) continue;
    if (!rowsByEmail.has(email)) rowsByEmail.set(email, []);
    rowsByEmail.get(email)!.push(sub);
  }

  const resolved = new Map<string, string>();
  const emailBySub = new Map<string, string>();
  for (const email of emails) {
    const rows = rowsByEmail.get(email) ?? [];
    if (rows.length === 0) {
      errors.push(
        `${email}: no active enrollment in this course. Enroll the student first, then import.`
      );
      continue;
    }
    if (rows.length > 1) {
      const distinct = new Set(rows).size;
      errors.push(
        `${email}: ${rows.length} active enrollment rows` +
          (distinct === 1
            ? " for the same account — the roster is duplicated; remove the extra row before importing."
            : ` resolving to ${distinct} different accounts — ambiguous, refusing to guess.`)
      );
      continue;
    }
    const sub = rows[0];
    resolved.set(email, sub);
    const previous = emailBySub.get(sub);
    if (previous && previous !== email) {
      errors.push(
        `${previous} and ${email} resolve to the same VOICE account — feedback would be cross-bound.`
      );
      continue;
    }
    emailBySub.set(sub, email);
  }

  return { ok: errors.length === 0, errors, resolved, emailBySub };
}

// ───────────────────────── orchestration ─────────────────────────

function narrativePreview(narrative: string): string {
  return String(narrative).replace(/\s+/g, " ").slice(0, 60);
}

export interface Phase3StatusArgs {
  moduleId: string;
  courseId: string;
}

export async function executePhase3Status(
  deps: Phase3ImportDeps,
  args: Phase3StatusArgs
): Promise<Phase3ImportOutcome> {
  const resolvedFlow = await resolveConfiguredFlow(deps, args.moduleId);
  if (!resolvedFlow.ok) return resolvedFlow.outcome;
  const { partsAC, partD } = resolvedFlow.flow;

  const rows = await deps.scanFeedbackByItem(partsAC.moduleItemId);
  const summary = summarizeFeedbackRows(rows);
  const enrollments = await deps.scanEnrollments(args.courseId);
  const emailBySub = new Map<string, string>();
  for (const e of enrollments) {
    if (e?.status !== "active") continue;
    const sub = String(e.studentUserId ?? "");
    const email = normalizeEmail(e.studentEmail);
    if (sub && email) emailBySub.set(sub, email);
  }

  // "Complete" is a three-part claim, not a row count: the right number of
  // students, the right number of rows, AND the flow marker that stops further
  // tester imports. Any partial combination is an inconsistency to surface, not
  // a state to round up or down.
  const flowState = readFlowState(partsAC);
  const rowsComplete =
    summary.formalStudentIds.length === PHASE3_FORMAL_STUDENT_COUNT &&
    summary.formalRowCount === PHASE3_FORMAL_ROW_COUNT;
  const anyFormalRows = summary.formalRowCount > 0;
  const markerPresent = flowState.formalImportedAt !== null;
  let inconsistencyReason: string | null = null;
  if (rowsComplete && !markerPresent) {
    inconsistencyReason =
      `All ${PHASE3_FORMAL_ROW_COUNT} formal rows are stored, but this flow is not marked as imported, ` +
      `so it would still accept tester data. Run the formal import again to repair the marker (no rows are rewritten).`;
  } else if (markerPresent && !rowsComplete) {
    inconsistencyReason =
      `This flow is marked as imported on ${flowState.formalImportedAt}, but only ` +
      `${summary.formalStudentIds.length}/${PHASE3_FORMAL_STUDENT_COUNT} students and ` +
      `${summary.formalRowCount}/${PHASE3_FORMAL_ROW_COUNT} rows are stored. Investigate off the website.`;
  } else if (anyFormalRows && !rowsComplete && !markerPresent) {
    inconsistencyReason =
      `${summary.formalRowCount} formal row(s) are stored but the cohort is incomplete ` +
      `(${PHASE3_FORMAL_ROW_COUNT} expected) and the flow is not marked as imported. ` +
      `Partial cohorts are never completed by the website.`;
  }

  const body: Phase3StatusBody = {
    partsACItemId: partsAC.moduleItemId,
    partDItemId: partD.moduleItemId,
    provenance: {
      assignmentVersion: PHASE3_FORMAL_ASSIGNMENT_VERSION,
      randomSeed: PHASE3_FORMAL_RANDOM_SEED,
    },
    formal: {
      studentCount: summary.formalStudentIds.length,
      rowCount: summary.formalRowCount,
      batchIds: summary.formalBatchIds,
      importedAt: flowState.formalImportedAt,
      batchId: flowState.formalBatchId,
      complete: rowsComplete && markerPresent,
      inconsistent: inconsistencyReason !== null,
      inconsistencyReason,
    },
    testers: summary.testers.map((t) => ({
      ...t,
      studentEmail: emailBySub.get(t.studentUserId) ?? null,
    })),
    unknownRows: summary.unknownRows,
    formalImportUnlocked:
      summary.testers.length === 0 &&
      summary.unknownRows.length === 0 &&
      // A flow whose rows and marker disagree must not accept a fresh import
      // until someone has looked at it — except the one repairable case, where
      // re-running the import only stamps the missing marker.
      !(markerPresent && !rowsComplete),
    expected: {
      studentCount: PHASE3_FORMAL_STUDENT_COUNT,
      rowCount: PHASE3_FORMAL_ROW_COUNT,
      sourceOrders: { ...PHASE3_EXPECTED_SOURCE_ORDERS },
    },
  };
  return { status: 200, body: body as unknown as Record<string, unknown> };
}

export interface Phase3ImportArgs {
  moduleId: string;
  courseId: string;
  callerUserId: string;
  mode: Phase3ImportMode;
  csvText: string;
  commit: boolean;
  /** Required on commit: the planHash returned by preview. */
  expectedPlanHash?: unknown;
  /** Required on tester commit: must equal the single email in the CSV. */
  confirmTesterEmail?: unknown;
  /** Required on formal commit: must equal the server's frozen constants. */
  confirmProvenance?: unknown;
  /** Required on formal commit: must equal the server-built confirmation phrase. */
  confirmFormalPhrase?: unknown;
}

export async function executePhase3Import(
  deps: Phase3ImportDeps,
  args: Phase3ImportArgs
): Promise<Phase3ImportOutcome> {
  const resolvedFlow = await resolveConfiguredFlow(deps, args.moduleId);
  if (!resolvedFlow.ok) return resolvedFlow.outcome;
  const { partsAC, partD } = resolvedFlow.flow;
  const partsACItemId = partsAC.moduleItemId;
  // Read BEFORE the feedback scan: anything that lands afterwards either shows
  // up in the scan (and fails a gate) or changes the generation (and fails the
  // transaction condition). Both orders are covered.
  const flowState = readFlowState(partsAC);

  if (typeof args.csvText !== "string" || args.csvText.trim() === "") {
    return { status: 400, body: { error: "csv is required", code: "NO_CSV" } };
  }

  // ── Gates 1 + 2: nothing may be imported while testers or unclassifiable
  //    rows are present. Re-evaluated on commit, not just preview.
  const storedRows = await deps.scanFeedbackByItem(partsACItemId);
  const summary = summarizeFeedbackRows(storedRows);
  if (summary.unknownRows.length > 0) {
    return {
      status: 409,
      body: {
        error:
          `${summary.unknownRows.length} Phase 3 row(s) under this flow have no import type and cannot be classified. ` +
          `Resolve them off the website before importing anything else.`,
        code: "UNKNOWN_ROWS_PRESENT",
        details: { unknownRows: summary.unknownRows },
      },
    };
  }
  if (args.mode === "tester" && flowState.formalImportedAt) {
    return {
      status: 409,
      body: {
        error:
          `The formal cohort was imported into this flow on ${flowState.formalImportedAt}. ` +
          `Tester data can no longer be added — resetting the flow is a research-process decision, not a website action.`,
        code: "FORMAL_ALREADY_IMPORTED",
      },
    };
  }
  if (args.mode === "formal" && summary.testers.length > 0) {
    return {
      status: 409,
      body: {
        error:
          `${summary.testers.length} tester(s) still hold Phase 3 data in this flow. ` +
          `Run “Purge All Tester Data” before importing the formal cohort.`,
        code: "TESTER_PRESENT",
        details: {
          testers: summary.testers.map((t) => t.studentUserId),
        },
      },
    };
  }

  // ── Gate 3: structure + cohort ──
  let records: Phase3Record[];
  try {
    records = readTemplate(args.csvText);
  } catch (e) {
    return {
      status: 400,
      body: {
        error: e instanceof Error ? e.message : "The CSV could not be parsed",
        code: "CSV_INVALID",
      },
    };
  }
  const validationErrors = validateRecords(records, args.mode);
  if (validationErrors.length > 0) {
    return {
      status: 400,
      body: {
        error: `Validation failed with ${validationErrors.length} problem(s). Nothing was written.`,
        code: "VALIDATION_FAILED",
        details: {
          errorCount: validationErrors.length,
          errors: validationErrors.slice(0, 50),
          truncated: validationErrors.length > 50,
        },
      },
    };
  }

  // ── Gate 4: accounts ──
  const byEmail = groupByEmail(records);
  const enrollments = await deps.scanEnrollments(args.courseId);
  const resolution = resolveEmailsFromEnrollments([...byEmail.keys()], enrollments);
  if (!resolution.ok) {
    return {
      status: 400,
      body: {
        error: `Account resolution failed for ${resolution.errors.length} email(s). Nothing was written.`,
        code: "ACCOUNT_RESOLUTION_FAILED",
        details: { errors: resolution.errors },
      },
    };
  }

  const formalSubs = [...byEmail.keys()].map((e) => resolution.resolved.get(e)!);

  // ── Gate 5: tester history. Exact-key BatchGet, never a table scan. ──
  if (args.mode === "formal") {
    const markerIds = formalSubs.map((sub) =>
      phase3TesterHistoryEventId(partsACItemId, sub)
    );
    let present: Set<string>;
    try {
      present = await deps.batchGetEventIds(markerIds);
    } catch (e) {
      return {
        status: 409,
        body: {
          error:
            "The tester-history check could not be completed, so the formal import was refused. " +
            (e instanceof Error ? e.message : "Retry in a moment."),
          code: "TESTER_HISTORY_UNVERIFIED",
        },
      };
    }
    const hits = formalSubs.filter((sub) =>
      present.has(phase3TesterHistoryEventId(partsACItemId, sub))
    );
    if (hits.length > 0) {
      return {
        status: 409,
        body: {
          error:
            `${hits.length} account(s) in this CSV were previously imported as Phase 3 testers in this flow. ` +
            `Tester accounts are permanently excluded from the formal cohort — the research team must resolve this before importing.`,
          code: "TESTER_HISTORY",
          details: { studentUserIds: hits },
        },
      };
    }
  }

  // Tester mode: never let a formal participant be re-labelled as a tester.
  if (args.mode === "tester") {
    const formalSet = new Set(summary.formalStudentIds);
    const clash = formalSubs.filter((sub) => formalSet.has(sub));
    if (clash.length > 0) {
      return {
        status: 409,
        body: {
          error:
            "This account already holds formal Phase 3 cohort data and cannot be imported as a tester.",
          code: "FORMAL_PRESENT",
          details: { studentUserIds: clash },
        },
      };
    }
  }

  // ── Build the plan ──
  const now = deps.now();
  const sourceCsvSha256 = sha256Hex(args.csvText);
  const isFormal = args.mode === "formal";
  const assignmentVersion = isFormal ? PHASE3_FORMAL_ASSIGNMENT_VERSION : "";
  const randomSeed = isFormal ? PHASE3_FORMAL_RANDOM_SEED : "";

  const draftRows: Array<Record<string, unknown>> = [];
  for (const [email, rows] of byEmail) {
    const studentUserId = resolution.resolved.get(email)!;
    for (const record of rows) {
      draftRows.push(
        buildRow(record, {
          partsACItemId,
          studentUserId,
          now,
          importKind: isFormal
            ? PHASE3_IMPORT_KIND_FORMAL
            : PHASE3_IMPORT_KIND_TESTER,
          importBatchId: "",
          importedByUserId: args.callerUserId,
          sourceCsvSha256,
          ...(isFormal ? { assignmentVersion, randomSeed } : {}),
        })
      );
    }
  }

  const planHash = computePlanHash({
    mode: args.mode,
    partsACItemId,
    rows: draftRows,
    assignmentVersion,
    randomSeed,
  });
  const batchId = batchIdFor(partsACItemId, planHash);
  const plannedRows = draftRows.map((r) => ({ ...r, _importBatchId: batchId }));

  // ── Gate 6: preflight, four-way, no stitching ──
  const preflight = classifyExisting(plannedRows, storedRows);
  if (preflight.divergent.length > 0 || preflight.unexpected.length > 0) {
    return {
      status: 409,
      body: {
        error:
          `Existing Phase 3 rows under this flow do not match this upload ` +
          `(${preflight.divergent.length} differing, ${preflight.unexpected.length} unexpected). Nothing was written.`,
        code: "DIVERGENT_ROWS",
        details: {
          divergent: preflight.divergent,
          unexpected: preflight.unexpected,
        },
      },
    };
  }
  const allExact =
    preflight.absent.length === 0 && preflight.exact.length === plannedRows.length;
  const allAbsent = preflight.exact.length === 0;

  // The flow says the cohort landed, but the rows do not back that up. Never
  // stitch, never overwrite: this needs a human looking at where the rows went.
  if (isFormal && flowState.formalImportedAt && !allExact) {
    return {
      status: 409,
      body: {
        error:
          `This flow is marked as having imported the formal cohort on ${flowState.formalImportedAt}, ` +
          `but the stored rows are not a complete match for this file ` +
          `(${preflight.exact.length} of ${plannedRows.length} match, ${preflight.absent.length} missing). ` +
          `Investigate off the website — the import will not reconcile this automatically.`,
        code: "FORMAL_FLOW_STATE_INCONSISTENT",
        details: {
          formalImportedAt: flowState.formalImportedAt,
          formalBatchId: flowState.formalBatchId,
          exact: preflight.exact.length,
          absent: preflight.absent.length,
          expected: plannedRows.length,
        },
      },
    };
  }
  if (!allExact && !allAbsent) {
    return {
      status: 409,
      body: {
        error:
          `This flow already holds ${preflight.exact.length} of the ${plannedRows.length} rows in this upload, ` +
          `so the upload is not a complete, single-provenance import. The website will not stitch a partial ` +
          (isFormal ? "cohort" : "tester set") +
          ` together. ` +
          (isFormal
            ? `Investigate where the existing rows came from (for example a previous scripts/seed-phase3.mjs run), clear them off the website, then import all ${PHASE3_FORMAL_ROW_COUNT} rows again.`
            : `Purge this tester, then import all three rows again.`),
        code: "MIXED_STATE",
        details: {
          exact: preflight.exact,
          absent: preflight.absent,
        },
      },
    };
  }

  // ── Preview payload (also the shape returned by a verified no-op commit) ──
  const plan = [...byEmail.entries()].map(([email, rows]) => {
    const studentUserId = resolution.resolved.get(email)!;
    const cards = PHASE3_DISPLAY_KEYS.map((displayKey) => {
      const record = rows.find((r) => r.display_key === displayKey)!;
      const d1 = phase3NormalizeScore(record.d1);
      const d2 = phase3NormalizeScore(record.d2);
      const d3 = phase3NormalizeScore(record.d3);
      return {
        displayKey,
        sourceLabel: PHASE3_SOURCE_MAP[record.source_internal].displayLabel,
        d1,
        d2,
        d3,
        contentHash: phase3ContentHash(d1, d2, d3, record.narrative),
        narrativePreview: narrativePreview(record.narrative),
      };
    });
    return {
      reviewId: rows[0].review_id,
      studyId: rows[0].study_id,
      studentEmail: email,
      studentUserId,
      sourceOrder: sourceOrderOf(rows),
      cards,
    };
  });

  const distribution = orderDistribution(byEmail);
  const previewBody: Record<string, unknown> = {
    mode: args.mode,
    partsACItemId,
    partDItemId: partD.moduleItemId,
    planHash,
    batchId,
    sourceCsvSha256,
    studentCount: byEmail.size,
    rowCount: records.length,
    provenance: { assignmentVersion, randomSeed },
    orderDistribution: PHASE3_SOURCE_ORDER_KEYS.map((order) => ({
      order,
      actual: distribution[order] || 0,
      expected: isFormal ? PHASE3_EXPECTED_SOURCE_ORDERS[order] : null,
    })),
    counts: {
      absent: preflight.absent.length,
      exact: preflight.exact.length,
      divergent: 0,
      unexpected: 0,
    },
    alreadyImported: allExact,
    confirmPhrase: isFormal ? phase3FormalConfirmPhrase() : null,
    flowState: {
      testerGeneration: flowState.testerGeneration,
      formalImportedAt: flowState.formalImportedAt,
    },
    plan,
  };

  if (!args.commit) {
    return { status: 200, body: { ...previewBody, committed: false } };
  }

  // ── Commit-only confirmations ──
  if (args.expectedPlanHash !== planHash) {
    return {
      status: 409,
      body: {
        error:
          "This upload does not match the previewed plan. Preview it again and confirm the new result.",
        code: "PLAN_HASH_MISMATCH",
      },
    };
  }
  if (args.mode === "tester") {
    const confirmed = normalizeEmail(args.confirmTesterEmail);
    const only = [...byEmail.keys()][0];
    if (!confirmed || confirmed !== only) {
      return {
        status: 400,
        body: {
          error:
            "Type the tester's email exactly as it appears in the CSV to confirm the import.",
          code: "TESTER_EMAIL_MISMATCH",
        },
      };
    }
  } else {
    // Rebuilt from the cohort constants. The client sends only what was typed;
    // the expected counts are never taken from the request, so calling the API
    // directly cannot skip or weaken the confirmation.
    const expectedPhrase = phase3FormalConfirmPhrase();
    const typedPhrase =
      typeof args.confirmFormalPhrase === "string"
        ? args.confirmFormalPhrase.trim()
        : "";
    if (typedPhrase !== expectedPhrase) {
      return {
        status: 400,
        body: {
          error: `Type "${expectedPhrase}" exactly to confirm the formal cohort import.`,
          code: "CONFIRM_PHRASE_MISMATCH",
        },
      };
    }
    const provided = isRecord(args.confirmProvenance) ? args.confirmProvenance : {};
    if (
      provided.assignmentVersion !== PHASE3_FORMAL_ASSIGNMENT_VERSION ||
      provided.randomSeed !== PHASE3_FORMAL_RANDOM_SEED
    ) {
      return {
        status: 400,
        body: {
          error:
            `Confirm the frozen provenance exactly: assignmentVersion "${PHASE3_FORMAL_ASSIGNMENT_VERSION}", ` +
            `randomSeed "${PHASE3_FORMAL_RANDOM_SEED}".`,
          code: "PROVENANCE_MISMATCH",
        },
      };
    }
  }

  const eventCtx: EventContext = {
    courseId: args.courseId,
    moduleId: args.moduleId,
    partsACItemId,
    now,
  };

  if (allExact) {
    if (isFormal) {
      // rowMatchesExpected already proved kind + provenance, so the rows really
      // are this cohort. But rows and flow marker must agree: 51 stored rows
      // with no `_phase3FormalImportedAt` would leave the flow still accepting
      // tester imports, which is the inconsistency this branch exists to close.
      if (flowState.formalImportedAt) {
        return {
          status: 200,
          body: { ...previewBody, committed: true, written: 0, verified: true },
        };
      }
      // Re-assert the two gates against the same consistent scan before
      // stamping the flow: the marker must never be written over a flow that
      // still holds tester or unclassifiable data.
      if (summary.testers.length > 0 || summary.unknownRows.length > 0) {
        return {
          status: 409,
          body: {
            error:
              "The formal rows are all present, but this flow still holds tester or unclassifiable data, " +
              "so the formal marker cannot be stamped. Resolve that first.",
            code: "FORMAL_FLOW_STATE_INCONSISTENT",
            details: {
              testers: summary.testers.map((t) => t.studentUserId),
              unknownRows: summary.unknownRows,
            },
          },
        };
      }
      // Small atomic repair: stamp the flow marker and record why. The 51 cards
      // are NOT rewritten — they are already verified byte-for-byte.
      try {
        await deps.transactWrite([
          buildFlowGuardUpdate({
            moduleItemTable: deps.tables.moduleItem,
            partsACItemId,
            observedGeneration: flowState.testerGeneration,
            kind: "formal-commit",
            now,
            batchId,
          }),
          {
            Put: {
              TableName: deps.tables.eventLog,
              Item: buildAuditEvent(
                eventCtx,
                `${batchId}:formal-marker-backfill`,
                args.callerUserId,
                PHASE3_FORMAL_IMPORTED_EVENT_TYPE,
                {
                  operatorUserId: args.callerUserId,
                  studentCount: byEmail.size,
                  rowCount: records.length,
                  batchId,
                  planHash,
                  sourceCsvSha256,
                  assignmentVersion,
                  randomSeed,
                  formalMarkerBackfilled: true,
                }
              ),
            },
          },
        ]);
      } catch (e) {
        return {
          status: 409,
          body: {
            error:
              "The formal flow marker could not be written and nothing was changed — the flow state moved while you were confirming. Preview again.",
            code: "TRANSACTION_CANCELLED",
            details: {
              reasons: (e as { cancellationReasons?: unknown })?.cancellationReasons,
            },
          },
        };
      }
      return {
        status: 200,
        body: {
          ...previewBody,
          committed: true,
          written: 0,
          verified: true,
          formalMarkerBackfilled: true,
        },
      };
    }
    // Tester cards can exist without the permanent marker if they were seeded
    // before the marker existed. Reporting "verified" there would leave the
    // account able to enter the formal cohort later, so back the marker in
    // rather than passing.
    const testerUserId = formalSubs[0];
    const markerId = phase3TesterHistoryEventId(partsACItemId, testerUserId);
    let markerPresent: boolean;
    try {
      markerPresent = (await deps.batchGetEventIds([markerId])).has(markerId);
    } catch (e) {
      return {
        status: 409,
        body: {
          error:
            "This tester's cards already exist, but the permanent tester-history marker could not be checked, so the import was refused. " +
            (e instanceof Error ? e.message : "Retry in a moment."),
          code: "TESTER_HISTORY_UNVERIFIED",
        },
      };
    }
    if (markerPresent) {
      return {
        status: 200,
        body: { ...previewBody, committed: true, written: 0, verified: true },
      };
    }
    try {
      await deps.transactWrite([
        buildFlowGuardUpdate({
          moduleItemTable: deps.tables.moduleItem,
          partsACItemId,
          observedGeneration: flowState.testerGeneration,
          kind: "tester-import",
          now,
        }),
        {
          Put: {
            TableName: deps.tables.eventLog,
            Item: buildTesterHistoryMarker(eventCtx, testerUserId, {
              operatorUserId: args.callerUserId,
              batchId,
              planHash,
              sourceCsvSha256,
              lastImportedAt: now,
              backfilled: true,
            }),
          },
        },
        {
          Put: {
            TableName: deps.tables.eventLog,
            Item: buildAuditEvent(
              eventCtx,
              `${batchId}:tester-marker-backfill:${testerUserId}`,
              testerUserId,
              PHASE3_TESTER_IMPORTED_EVENT_TYPE,
              {
                operatorUserId: args.callerUserId,
                batchId,
                planHash,
                rowCount: 0,
                sourceCsvSha256,
                markerBackfilled: true,
              }
            ),
          },
        },
      ]);
    } catch (e) {
      return {
        status: 409,
        body: {
          error:
            "The tester-history marker could not be written and nothing was changed — the flow state moved while you were confirming. Preview again.",
          code: "TRANSACTION_CANCELLED",
          details: {
            reasons: (e as { cancellationReasons?: unknown })?.cancellationReasons,
          },
        },
      };
    }
    return {
      status: 200,
      body: {
        ...previewBody,
        committed: true,
        written: 0,
        verified: true,
        markerBackfilled: true,
      },
    };
  }

  // ── Single atomic write ──
  const events: Array<Record<string, unknown>> = [];
  if (isFormal) {
    events.push(
      buildAuditEvent(
        eventCtx,
        `${batchId}:formal-imported`,
        args.callerUserId,
        PHASE3_FORMAL_IMPORTED_EVENT_TYPE,
        {
          operatorUserId: args.callerUserId,
          studentCount: byEmail.size,
          rowCount: records.length,
          batchId,
          planHash,
          sourceCsvSha256,
          assignmentVersion,
          randomSeed,
        }
      )
    );
  } else {
    const testerUserId = formalSubs[0];
    events.push(
      buildTesterHistoryMarker(eventCtx, testerUserId, {
        operatorUserId: args.callerUserId,
        batchId,
        planHash,
        sourceCsvSha256,
        lastImportedAt: now,
      })
    );
    events.push(
      buildAuditEvent(
        eventCtx,
        `${batchId}:tester-imported:${testerUserId}`,
        testerUserId,
        PHASE3_TESTER_IMPORTED_EVENT_TYPE,
        {
          operatorUserId: args.callerUserId,
          batchId,
          planHash,
          rowCount: records.length,
          sourceCsvSha256,
        }
      )
    );
  }

  const transactItems = buildImportTransactItems({
    tables: deps.tables,
    rows: plannedRows,
    events,
    guard: buildFlowGuardUpdate({
      moduleItemTable: deps.tables.moduleItem,
      partsACItemId,
      observedGeneration: flowState.testerGeneration,
      kind: isFormal ? "formal-commit" : "tester-import",
      now,
      batchId,
    }),
  });
  try {
    await deps.transactWrite(transactItems, clientRequestTokenFor(planHash));
  } catch (e) {
    return {
      status: 409,
      body: {
        error:
          "The import was cancelled and nothing was written — the stored rows changed while you were confirming. " +
          "Preview again to see the current state.",
        code: "TRANSACTION_CANCELLED",
        details: {
          reasons: (e as { cancellationReasons?: unknown })?.cancellationReasons,
          message: e instanceof Error ? e.message : String(e),
        },
      },
    };
  }

  return {
    status: 200,
    body: {
      ...previewBody,
      committed: true,
      written: plannedRows.length,
      verified: false,
    },
  };
}

export interface Phase3PurgeArgs {
  moduleId: string;
  courseId: string;
  callerUserId: string;
  scope: "one" | "all";
  /** Required for scope "one" during preview and commit. */
  studentUserId?: unknown;
  commit: boolean;
  /** scope "one": the tester's email. scope "all": "PURGE ALL <n> TESTERS". */
  confirmText?: unknown;
}

/**
 * `existence` is reported honestly: "present" / "absent" come from an exact key
 * read, "unknown" is used only if that read is unavailable. A delete is issued
 * either way (it is a no-op on an absent row), which is what `targeted` means —
 * but the UI must never show a guess as a fact.
 */
export type PurgeExistence = "present" | "absent" | "unknown";

export interface PurgeTargetRef {
  moduleItemId: string;
  targeted: true;
  existence: PurgeExistence;
}

interface PurgePlanEntry {
  studentUserId: string;
  studentEmail: string | null;
  feedbackIds: string[];
  displayKeys: string[];
  surveyInstances: PurgeTargetRef[];
  itemProgress: PurgeTargetRef[];
}

export async function executePhase3PurgeTester(
  deps: Phase3ImportDeps,
  args: Phase3PurgeArgs
): Promise<Phase3ImportOutcome> {
  const resolvedFlow = await resolveConfiguredFlow(deps, args.moduleId);
  if (!resolvedFlow.ok) return resolvedFlow.outcome;
  const { partsAC, partD } = resolvedFlow.flow;
  const partsACItemId = partsAC.moduleItemId;
  const partDItemId = partD.moduleItemId;
  const flowState = readFlowState(partsAC);

  const storedRows = await deps.scanFeedbackByItem(partsACItemId);
  const summary = summarizeFeedbackRows(storedRows);

  if (summary.unknownRows.length > 0) {
    return {
      status: 409,
      body: {
        error:
          `${summary.unknownRows.length} Phase 3 row(s) under this flow have no import type. ` +
          `Purge refuses to run while any row's type cannot be confirmed.`,
        code: "UNKNOWN_ROWS_PRESENT",
        details: { unknownRows: summary.unknownRows },
      },
    };
  }

  let targets = summary.testers;
  if (args.scope === "one") {
    const sub = typeof args.studentUserId === "string" ? args.studentUserId : "";
    if (!sub) {
      return {
        status: 400,
        body: { error: "studentUserId is required", code: "NO_TARGET" },
      };
    }
    targets = summary.testers.filter((t) => t.studentUserId === sub);
    if (targets.length === 0) {
      return {
        status: 404,
        body: {
          error:
            "This account holds no Phase 3 tester data in this flow — it may already have been purged. Refresh and try again.",
          code: "NOT_A_TESTER",
        },
      };
    }
  }

  const enrollments = await deps.scanEnrollments(args.courseId);
  const emailBySub = new Map<string, string>();
  for (const e of enrollments) {
    if (e?.status !== "active") continue;
    const sub = String(e.studentUserId ?? "");
    const email = normalizeEmail(e.studentEmail);
    if (sub && email) emailBySub.set(sub, email);
  }

  // Per-target guards. A malformed deterministic id, or a formal row filed under
  // a tester's account, stops the whole operation rather than deleting part of it.
  const plans: PurgePlanEntry[] = [];
  for (const tester of targets) {
    const rows = storedRows.filter(
      (r) => String(r.studentUserId) === tester.studentUserId
    );
    for (const row of rows) {
      if (row._importKind === PHASE3_IMPORT_KIND_FORMAL) {
        return {
          status: 409,
          body: {
            error:
              "This account holds formal cohort rows. Tester purge can never delete formal Phase 3 data.",
            code: "FORMAL_PRESENT",
            details: { studentUserId: tester.studentUserId },
          },
        };
      }
      const expectedId = phase3FeedbackId(
        tester.studentUserId,
        String(row.displayKey ?? "")
      );
      if (
        !(PHASE3_DISPLAY_KEYS as readonly string[]).includes(
          String(row.displayKey ?? "")
        ) ||
        row.feedbackId !== expectedId
      ) {
        return {
          status: 409,
          body: {
            error:
              `Row ${String(row.feedbackId)} is not a deterministic Phase 3 tester row. ` +
              `Purge refuses to touch rows it cannot prove it created.`,
            code: "NON_DETERMINISTIC_ROW",
            details: { feedbackId: String(row.feedbackId) },
          },
        };
      }
    }
    const testerRows = rows.filter(
      (r) => r._importKind === PHASE3_IMPORT_KIND_TESTER
    );
    if (testerRows.length < 1) {
      // Without at least one conditional delete the transaction would have no
      // authorization guard for the unconditional deletes.
      return {
        status: 409,
        body: {
          error:
            "No tester feedback rows remain for this account, so a guarded purge cannot be built. Refresh and try again.",
          code: "NO_GUARD_ROW",
          details: { studentUserId: tester.studentUserId },
        },
      };
    }
    const existenceOf = async (
      read: (itemId: string, sub: string) => Promise<Record<string, unknown> | null>,
      itemId: string
    ): Promise<PurgeTargetRef> => {
      try {
        const row = await read(itemId, tester.studentUserId);
        return {
          moduleItemId: itemId,
          targeted: true,
          existence: row ? "present" : "absent",
        };
      } catch {
        return { moduleItemId: itemId, targeted: true, existence: "unknown" };
      }
    };

    plans.push({
      studentUserId: tester.studentUserId,
      studentEmail: emailBySub.get(tester.studentUserId) ?? null,
      feedbackIds: testerRows.map((r) => String(r.feedbackId)).sort(),
      displayKeys: testerRows.map((r) => String(r.displayKey)).sort(),
      surveyInstances: [
        await existenceOf(deps.getSurveyInstance, partsACItemId),
        await existenceOf(deps.getSurveyInstance, partDItemId),
      ],
      itemProgress: [
        await existenceOf(deps.getStudentItemProgress, partsACItemId),
        await existenceOf(deps.getStudentItemProgress, partDItemId),
      ],
    });
  }

  const previewBody: Record<string, unknown> = {
    scope: args.scope,
    partsACItemId,
    partDItemId,
    testerCount: plans.length,
    plans,
    retained: {
      eventLogBehaviourEvents: true,
      testerHistoryMarker: true,
      courseEnrollment: true,
    },
    confirmPhrase:
      args.scope === "all" ? `PURGE ALL ${plans.length} TESTERS` : null,
  };

  if (!args.commit) {
    return { status: 200, body: { ...previewBody, committed: false } };
  }

  // ── Commit-only confirmation ──
  if (args.scope === "one") {
    const expected = plans[0].studentEmail;
    const provided = normalizeEmail(args.confirmText);
    if (!expected) {
      return {
        status: 409,
        body: {
          error:
            "This tester has no active enrollment email to confirm against. Resolve the enrollment first.",
          code: "NO_CONFIRM_EMAIL",
        },
      };
    }
    if (provided !== expected) {
      return {
        status: 400,
        body: {
          error: "Type the tester's email exactly to confirm the purge.",
          code: "CONFIRM_MISMATCH",
        },
      };
    }
  } else {
    const expected = `PURGE ALL ${plans.length} TESTERS`;
    if (String(args.confirmText ?? "").trim() !== expected) {
      return {
        status: 400,
        body: {
          error: `Type "${expected}" exactly to confirm.`,
          code: "CONFIRM_MISMATCH",
        },
      };
    }
  }

  if (plans.length === 0) {
    return {
      status: 200,
      body: { ...previewBody, committed: true, purged: 0, failed: [] },
    };
  }

  // One atomic transaction PER TESTER. Not one big transaction: that would cap
  // how many testers a flow may hold, and there is deliberately no such cap.
  const now = deps.now();
  const failed: Array<{ studentUserId: string; reason: string }> = [];
  let purged = 0;
  // Each purge bumps the flow generation, so the expected value walks forward
  // with the loop. Anything else touching the flow mid-loop breaks the chain and
  // the remaining purges fail rather than racing.
  let expectedGeneration = flowState.testerGeneration;
  for (const plan of plans) {
    const auditEvent = buildAuditEvent(
      { courseId: args.courseId, moduleId: args.moduleId, partsACItemId, now },
      `phase3:tester-purged:${partsACItemId}:${plan.studentUserId}:${now}`,
      plan.studentUserId,
      PHASE3_TESTER_PURGED_EVENT_TYPE,
      {
        operatorUserId: args.callerUserId,
        deleted: {
          reviewerFeedback: plan.feedbackIds.length,
          surveyInstance: plan.surveyInstances.length,
          studentItemProgress: plan.itemProgress.length,
        },
        eventLogRetained: true,
        testerHistoryMarkerRetained: true,
      }
    );
    try {
      await deps.transactWrite(
        buildPurgeTransactItems({
          tables: deps.tables,
          partsACItemId,
          partDItemId,
          studentUserId: plan.studentUserId,
          displayKeys: plan.displayKeys,
          auditEvent,
          guard: buildFlowGuardUpdate({
            moduleItemTable: deps.tables.moduleItem,
            partsACItemId,
            observedGeneration: expectedGeneration,
            kind: "purge",
            now,
          }),
        })
      );
      purged++;
      expectedGeneration = (expectedGeneration ?? 0) + 1;
    } catch (e) {
      failed.push({
        studentUserId: plan.studentUserId,
        reason:
          e instanceof Error
            ? e.message
            : "the purge transaction was cancelled; nothing was deleted for this tester",
      });
    }
  }

  if (purged === 0 && failed.length > 0) {
    return {
      status: 409,
      body: {
        error: `No tester could be purged; ${failed.length} transaction(s) were cancelled and nothing was deleted.`,
        code: "PURGE_CANCELLED",
        details: { failed },
      },
    };
  }
  return {
    status: 200,
    body: { ...previewBody, committed: true, purged, failed },
  };
}
