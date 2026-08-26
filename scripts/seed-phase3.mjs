#!/usr/bin/env node
/* eslint-env node */
/**
 * Phase 3 frozen-feedback ingestion.
 *
 * VOICE performs NO scoring in Phase 3. Two faculty reviewers and an AI judge
 * grade the same frozen Maria case outside the system; their finished artifacts
 * (D1-D3 + one integrated narrative each) are QA'd and frozen externally, then
 * loaded here. This script is the only writer of those artifacts.
 *
 * It reads the existing ingestion template unchanged:
 *   review_id, study_id, student_email, display_key, source_internal,
 *   d1, d2, d3, narrative, selected_source, session, student_turns
 *
 * Counterbalancing (which of A/B/C is AI vs Faculty 1 vs Faculty 2) is assigned
 * by the research team BEFORE launch with a documented seed and written into
 * `source_internal`. This script never randomizes — it only validates the
 * allocation and reports the distribution across the six possible orders.
 *
 * Usage
 *   Dry run (writes nothing, prints the full mapping for human review):
 *     node scripts/seed-phase3.mjs --csv <file> --item-id <P3_AC_ITEM_ID> \
 *       --assignment-version v1 --random-seed 20260816 --dry-run
 *
 *   Commit (only after the dry run has been checked). The formal cohort is
 *   written as ONE TransactWriteItems (51 cards + audit record + flow guard);
 *   there is no row-by-row write and no resume of a partial cohort:
 *     ... --commit --assignment-version v1 --random-seed 20260825 \
 *       --expected-account-id <ACCOUNT_ID> \
 *       --confirm-target <ACCOUNT_ID/REGION/REVIEWER_FEEDBACK_TABLE/USER_POOL_ID>
 *
 *   Verify seeded content still matches the frozen CSV:
 *     ... --verify
 *
 *   Tester purge is a single guarded TransactWriteItems (flow guard + conditional
 *   deletes + audit). It refuses formal or unclassifiable rows and never removes
 *   the permanent tester-history marker; a cancelled transaction deletes nothing.
 *
 *   Tester lifecycle (mock cards for end-to-end testing, then exact removal):
 *     ... --csv tester.csv --tester --tester-email <EMAIL> --commit ...
 *     node scripts/seed-phase3.mjs --item-id <P3_AC_ID> --part-d-item-id <P3_D_ID> \
 *       --purge-student <SUB> --student-email <EMAIL> --confirm-student <SUB> --commit ...
 *
 *   Re-run a reveal that failed midway (leaves cards blind until complete):
 *     node scripts/seed-phase3.mjs --item-id <ID> --reveal-student <SUB> \
 *       --student-email <EMAIL> --confirm-student <SUB> --commit ...
 *
 * Tester safety
 *   A tester import writes a PERMANENT, deterministic EventLog marker
 *     phase3:tester-history:<P3_AC_ITEM_ID>:<TESTER_SUB>
 *   in the SAME transaction as the tester's three cards. The website's formal
 *   import BatchGets exactly these ids and refuses the cohort on any hit, so a
 *   tester account can never later be imported as a real participant. There is
 *   no path that writes tester cards without the marker: if EVENT_LOG_TABLE_NAME
 *   is unset, or the marker write fails, the cards are not written either.
 *   --purge-student never deletes the marker.
 *
 * Environment
 *   REVIEWER_FEEDBACK_TABLE_NAME  DynamoDB table holding ReviewerFeedback
 *   EVENT_LOG_TABLE_NAME          REQUIRED for --tester, any --commit, and
 *                                 --purge-student --commit (markers + audit)
 *   MODULE_ITEM_TABLE_NAME        REQUIRED for every import and for
 *                                 --purge-student --commit. Supplies the target
 *                                 courseId and hosts the flow-state guard.
 *   COURSE_ENROLLMENT_TABLE_NAME  REQUIRED for every import (dry-run included).
 *                                 Each CSV email must hold exactly ONE active
 *                                 CourseEnrollment in the Parts A-C item's course,
 *                                 and its studentUserId must equal the Cognito
 *                                 exact-match sub. A Cognito hit alone does not
 *                                 prove course membership.
 *   SURVEY_INSTANCE_TABLE_NAME    only needed for --purge-student
 *   STUDENT_ITEM_PROGRESS_TABLE_NAME only needed for --purge-student
 *   USER_POOL_ID                  Cognito pool used to resolve emails
 *   AWS_REGION / standard AWS credential chain
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  ScanCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";

// ───────────────────────── constants ─────────────────────────

const DISPLAY_KEYS = ["A", "B", "C"];
const VALID_SCORES = new Set(["1", "2", "3", "4", "N/A"]);

/**
 * Allowed `source_internal` values and how each maps onto the reused
 * ReviewerFeedback row. `source` drives the student-visible reveal
 * ("ai" -> AI-generated, otherwise Faculty-generated); `displayLabel` keeps the
 * Faculty 1 / Faculty 2 distinction for analysis only and is never sent to a
 * student.
 */
const SOURCE_MAP = {
  ai: { source: "ai", displayLabel: "AI" },
  faculty_1: { source: "reviewer", displayLabel: "Faculty 1" },
  faculty_2: { source: "reviewer", displayLabel: "Faculty 2" },
};

// ── Cohort contract ──
// These MUST stay equal to amplify/functions/shared/phase3-cohort.ts. A `.mjs`
// file cannot import a `.ts` module at runtime, so the values are duplicated
// here and scripts/phase3-cohort-parity.test.ts imports both and asserts they
// match — that test is what actually prevents the two writers from drifting.
const FORMAL_STUDENT_COUNT = 17;
const FORMAL_ROW_COUNT = 51;
const EXPECTED_SOURCE_ORDERS = {
  "AI→F1→F2": 3,
  "AI→F2→F1": 3,
  "F1→AI→F2": 3,
  "F1→F2→AI": 3,
  "F2→AI→F1": 2,
  "F2→F1→AI": 3,
};
const SOURCE_ORDER_KEYS = Object.keys(EXPECTED_SOURCE_ORDERS);

const FORMAL_ASSIGNMENT_VERSION = "v1";
const FORMAL_RANDOM_SEED = "20260825";

const IMPORT_KIND_FORMAL = "phase3_formal";
const IMPORT_KIND_TESTER = "phase3_tester";
const TESTER_HISTORY_EVENT_TYPE = "phase3_tester_history";
const TESTER_IMPORTED_EVENT_TYPE = "phase3_tester_imported";
const TESTER_PURGED_EVENT_TYPE = "phase3_tester_purged";
const FORMAL_IMPORTED_EVENT_TYPE = "phase3_formal_imported";

// Flow-state attributes on the Parts A-C ModuleItem row. Must match
// amplify/functions/shared/phase3-cohort.ts — the website conditions on the
// same attributes, which is what makes CLI and website writes mutually
// exclusive rather than merely both careful.
const TESTER_GENERATION_ATTR = "_phase3TesterGeneration";
const FORMAL_IMPORTED_AT_ATTR = "_phase3FormalImportedAt";
const FORMAL_BATCH_ATTR = "_phase3FormalBatchId";

/**
 * Deterministic EventLog primary key for the permanent tester-history marker.
 * Byte-identical to `phase3TesterHistoryEventId` in
 * amplify/functions/shared/phase3-cohort.ts — the web import's G5 gate BatchGets
 * exactly these ids, so a CLI tester import that did not write one would leave a
 * hole through which a tester account could later enter the formal cohort.
 */
function testerHistoryEventId(itemId, testerSub) {
  return `phase3:tester-history:${itemId}:${testerSub}`;
}

const TEMPLATE_COLUMNS = [
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

// ───────────────────────── CLI ─────────────────────────

function parseArgs(argv) {
  const args = {
    csv: null,
    itemId: null,
    assignmentVersion: null,
    randomSeed: null,
    out: null,
    dryRun: false,
    commit: false,
    verify: false,
    tester: false,
    purgeStudent: null,
    revealStudent: null,
    partDItemId: null,
    studentEmail: null,
    confirmStudent: null,
    testerEmail: null,
    expectedAccountId: null,
    confirmTarget: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--csv") args.csv = next();
    else if (a === "--item-id") args.itemId = next();
    else if (a === "--assignment-version") args.assignmentVersion = next();
    else if (a === "--random-seed") args.randomSeed = next();
    else if (a === "--out") args.out = next();
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--commit") args.commit = true;
    else if (a === "--verify") args.verify = true;
    else if (a === "--tester") args.tester = true;
    else if (a === "--purge-student") args.purgeStudent = next();
    else if (a === "--reveal-student") args.revealStudent = next();
    else if (a === "--part-d-item-id") args.partDItemId = next();
    else if (a === "--student-email") args.studentEmail = next();
    else if (a === "--confirm-student") args.confirmStudent = next();
    else if (a === "--tester-email") args.testerEmail = next();
    else if (a === "--expected-account-id") args.expectedAccountId = next();
    else if (a === "--confirm-target") args.confirmTarget = next();
    else {
      fail(`Unknown argument: ${a}`);
    }
  }
  return args;
}

function fail(message) {
  throw new Error(message);
}

// ───────────────────────── CSV ─────────────────────────

/**
 * Minimal RFC4180 parser. Narratives are 100-200 words of free prose that may
 * contain commas, quotes and newlines, so naive splitting is not safe.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let justClosedQuote = false;
  const src = text.replace(/^\uFEFF/, "");

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
      fail("Malformed CSV: unexpected character after a closing quote.");
    }
    if (ch === '"') {
      if (field.length > 0)
        fail("Malformed CSV: a quoted field must begin with a quote.");
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
  if (inQuotes) fail("Malformed CSV: unterminated quoted field.");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function readTemplate(path) {
  const rows = parseCsv(readFileSync(path, "utf8"));
  if (rows.length < 2) fail(`${path} has no data rows.`);
  const header = rows[0].map((h) => h.trim());
  if (header.join("\u0000") !== TEMPLATE_COLUMNS.join("\u0000")) {
    fail(
      `Ingestion template must have exactly the 12 frozen columns in order.\n` +
        `Expected: ${TEMPLATE_COLUMNS.join(", ")}\nFound: ${header.join(", ")}`
    );
  }
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].length !== TEMPLATE_COLUMNS.length) {
      fail(
        `${path} line ${i + 1} has ${
          rows[i].length
        } columns; expected exactly ${TEMPLATE_COLUMNS.length}.`
      );
    }
  }
  return rows.slice(1).map((cells, idx) => {
    const record = { __line: idx + 2 };
    header.forEach((h, i) => {
      record[h] = (cells[i] ?? "").trim();
    });
    // Narrative is a frozen source artifact: preserve all content bytes from
    // the parsed field, including leading/trailing whitespace and line endings.
    const narrativeIdx = header.indexOf("narrative");
    record.narrative = cells[narrativeIdx] ?? "";
    return record;
  });
}

// ───────────────────── hashing (must match phase3-cards.ts) ─────────────────

function canonicalCardContent(d1, d2, d3, narrative) {
  return [d1, d2, d3, narrative]
    .map((s) => String(s).normalize("NFC"))
    .join("\u0000");
}

function contentHash(d1, d2, d3, narrative) {
  return createHash("sha256")
    .update(canonicalCardContent(d1, d2, d3, narrative), "utf8")
    .digest("hex");
}

// ───────────────────────── validation ─────────────────────────

function normalizeScore(raw) {
  const s = String(raw ?? "").trim();
  if (s.toUpperCase() === "NA" || s.toUpperCase() === "N/A") return "N/A";
  return s;
}

/**
 * Full-file validation. Every problem is collected before exiting so a
 * researcher fixes the whole spreadsheet in one pass rather than one row at a
 * time. Any error at all means nothing is written.
 */
function validate(records, { tester }) {
  const errors = [];
  const byEmail = new Map();

  for (const r of records) {
    const where = `line ${r.__line} (${r.review_id || "no review_id"})`;

    if (!r.student_email) errors.push(`${where}: student_email is empty`);
    else if (!/^[^\s@"\\]+@[^\s@"\\]+\.[^\s@"\\]+$/.test(r.student_email)) {
      errors.push(`${where}: student_email is not a safe exact email value`);
    }
    if (!DISPLAY_KEYS.includes(r.display_key)) {
      errors.push(
        `${where}: display_key must be A, B or C — got "${r.display_key}"`
      );
    }
    if (!SOURCE_MAP[r.source_internal]) {
      errors.push(
        `${where}: source_internal must be one of ai / faculty_1 / faculty_2 — got "${r.source_internal}". ` +
          `An empty value means the A/B/C counterbalancing has not been assigned yet.`
      );
    }
    for (const dim of ["d1", "d2", "d3"]) {
      const v = normalizeScore(r[dim]);
      if (!VALID_SCORES.has(v)) {
        errors.push(
          `${where}: ${dim} must be 1, 2, 3, 4 or N/A — got "${r[dim]}"`
        );
      }
    }
    if (!r.narrative.trim()) errors.push(`${where}: narrative is empty`);

    if (r.student_email) {
      if (!byEmail.has(r.student_email)) byEmail.set(r.student_email, []);
      byEmail.get(r.student_email).push(r);
    }
  }

  for (const [email, rows] of byEmail) {
    if (rows.length !== 3) {
      errors.push(`${email}: expected exactly 3 cards, found ${rows.length}`);
      continue;
    }
    const keys = rows.map((r) => r.display_key).sort();
    if (keys.join(",") !== "A,B,C") {
      errors.push(
        `${email}: display_key set must be exactly A,B,C — found ${keys.join(
          ","
        )}`
      );
    }
    const sources = rows.map((r) => r.source_internal).sort();
    if (sources.join(",") !== "ai,faculty_1,faculty_2") {
      errors.push(
        `${email}: must have exactly 1 ai + 1 faculty_1 + 1 faculty_2 — found ${sources.join(
          ","
        )}`
      );
    }
    const reviewIds = new Set(rows.map((r) => r.review_id));
    if (reviewIds.size !== 1) {
      errors.push(
        `${email}: rows span multiple review_id values (${[...reviewIds].join(
          ", "
        )})`
      );
    }
  }

  // One review_id must not be spread across two students, which would mean a
  // student is about to receive another participant's feedback.
  const emailsByReview = new Map();
  for (const r of records) {
    if (!r.review_id || !r.student_email) continue;
    if (!emailsByReview.has(r.review_id))
      emailsByReview.set(r.review_id, new Set());
    emailsByReview.get(r.review_id).add(r.student_email);
  }
  for (const [reviewId, emails] of emailsByReview) {
    if (emails.size !== 1) {
      errors.push(
        `${reviewId}: maps to multiple students (${[...emails].join(", ")})`
      );
    }
  }

  if (!tester) {
    if (byEmail.size !== FORMAL_STUDENT_COUNT) {
      errors.push(
        `Expected ${FORMAL_STUDENT_COUNT} unique students, found ${byEmail.size}`
      );
    }
    if (records.length !== FORMAL_ROW_COUNT) {
      errors.push(
        `Expected ${FORMAL_ROW_COUNT} feedback rows, found ${records.length}`
      );
    }
    const expectedOrders = new Map(Object.entries(EXPECTED_SOURCE_ORDERS));
    const actualOrders = new Map();
    for (const rows of byEmail.values()) {
      if (rows.length !== 3 || rows.some((r) => !SOURCE_MAP[r.source_internal]))
        continue;
      const order = sourceOrder(rows);
      actualOrders.set(order, (actualOrders.get(order) || 0) + 1);
    }
    for (const [order, expected] of expectedOrders) {
      const actual = actualOrders.get(order) || 0;
      if (actual !== expected) {
        errors.push(
          `Source-order allocation ${order}: expected ${expected}, found ${actual}`
        );
      }
    }
  }

  return errors;
}

// ───────────────────────── Cognito resolution ─────────────────────────

/**
 * Resolve one email to exactly one Cognito sub. Uses an exact-match filter
 * (`email = "..."`), not the prefix form used by the faculty typeahead — a
 * prefix match could silently bind feedback to the wrong account. Zero or
 * multiple matches are hard failures; the script never guesses.
 */
async function resolveEmail(cognito, userPoolId, email) {
  const res = await cognito.send(
    new ListUsersCommand({
      UserPoolId: userPoolId,
      Filter: `email = "${email}"`,
      Limit: 10,
    })
  );
  const users = res.Users || [];
  const subs = users
    .map((u) => (u.Attributes || []).find((a) => a.Name === "sub")?.Value)
    .filter(Boolean);
  const unique = [...new Set(subs)];
  if (unique.length === 0)
    return { ok: false, reason: "no matching VOICE account" };
  if (unique.length > 1) {
    return {
      ok: false,
      reason: `${unique.length} matching accounts — ambiguous`,
    };
  }
  return { ok: true, sub: unique[0] };
}

// ───────────────────────── source-order reporting ─────────────────────────

function sourceOrder(rowsForStudent) {
  const label = { ai: "AI", faculty_1: "F1", faculty_2: "F2" };
  return DISPLAY_KEYS.map(
    (k) =>
      label[rowsForStudent.find((r) => r.display_key === k).source_internal]
  ).join("→");
}

function reportDistribution(byEmail) {
  const counts = new Map();
  for (const rows of byEmail.values()) {
    const order = sourceOrder(rows);
    counts.set(order, (counts.get(order) || 0) + 1);
  }
  const target = SOURCE_ORDER_KEYS.map((k) => EXPECTED_SOURCE_ORDERS[k]).join("/");
  console.log(`\nSource-order distribution (design §7 target: ${target})`);
  const allOrders = SOURCE_ORDER_KEYS;
  for (const order of allOrders) {
    console.log(
      `  ${order.padEnd(12)} ${counts.get(order) || 0}` +
        `   (expected ${EXPECTED_SOURCE_ORDERS[order]})`
    );
  }
  const unexpected = [...counts.keys()].filter((k) => !allOrders.includes(k));
  for (const k of unexpected)
    console.log(`  ${k.padEnd(12)} ${counts.get(k)}  <-- UNEXPECTED`);
}

// ───────────────────────── DynamoDB ─────────────────────────

function feedbackId(sub, displayKey) {
  // ReviewerFeedback.identifier(["feedbackId"]) is a single partition key with
  // no sort key, so this value IS the full primary key and
  // attribute_not_exists(feedbackId) is a correct idempotency guard.
  return `phase3:${sub}:${displayKey}`;
}

/**
 * Must stay behaviourally identical to `rowMatchesExpected` in
 * amplify/functions/module-item-function/phase3-import.ts: content equality is
 * not enough to call a row verified — a row whose `_importKind` or frozen
 * provenance disagrees is NOT this import, even if every character matches.
 * Any other attribute is still ignored.
 */
function rowMatchesExpected(actual, expected) {
  if (!actual) return false;
  if (actual._importKind !== expected._importKind) return false;
  if ((actual._assignmentVersion ?? null) !== (expected._assignmentVersion ?? null)) {
    return false;
  }
  if ((actual._randomSeed ?? null) !== (expected._randomSeed ?? null)) return false;
  const actualScores = actual.dimensionScores || {};
  const expectedScores = expected.dimensionScores;
  const actualArtifactHash = contentHash(
    normalizeScore(actualScores.d1),
    normalizeScore(actualScores.d2),
    normalizeScore(actualScores.d3),
    actual.body ?? ""
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

function buildRow(record, sub, itemId, now) {
  const mapping = SOURCE_MAP[record.source_internal];
  const d1 = normalizeScore(record.d1);
  const d2 = normalizeScore(record.d2);
  const d3 = normalizeScore(record.d3);
  return {
    feedbackId: feedbackId(sub, record.display_key),
    moduleItemId: itemId,
    studentUserId: sub,
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
    contentHash: contentHash(d1, d2, d3, record.narrative),
    revealed: false,
    locked: true,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * The three provenance attributes that participate in exact-match comparison.
 * Everything else stamped at write time (batch id, operator, timestamp, csv
 * digest) legitimately differs between runs and is never compared.
 */
function expectedProvenance(tester) {
  return tester
    ? { _importKind: IMPORT_KIND_TESTER }
    : {
        _importKind: IMPORT_KIND_FORMAL,
        _assignmentVersion: FORMAL_ASSIGNMENT_VERSION,
        _randomSeed: FORMAL_RANDOM_SEED,
      };
}

/**
 * Stamp the non-key audit attributes onto a row at WRITE time only.
 *
 * Kept out of buildRow so `--verify` and the commit preflight keep comparing
 * exactly the frozen artifact fields: rowMatchesExpected is a whitelist compare
 * and ignores extra attributes, which is what lets CLI-written and
 * website-written rows verify against each other.
 *
 * These are plain DynamoDB non-key attributes. The app never reads
 * ReviewerFeedback over AppSync, and the repo already stores undeclared
 * attributes this way (ModuleItem's `_balanced*` counters), so no Amplify Data
 * schema change is involved.
 */
function withAuditAttrs(row, ctx) {
  const stamped = {
    ...row,
    _importKind: ctx.importKind,
    _importBatchId: ctx.importBatchId,
    _importedByUserId: ctx.importedByUserId,
    _importedAt: ctx.now,
    _sourceCsvSha256: ctx.sourceCsvSha256,
  };
  // Formal provenance is never stamped onto tester data.
  if (ctx.assignmentVersion) stamped._assignmentVersion = ctx.assignmentVersion;
  if (ctx.randomSeed) stamped._randomSeed = ctx.randomSeed;
  return stamped;
}

/**
 * The permanent tester-history marker, byte-compatible with the one the website
 * writes (amplify/functions/module-item-function/phase3-import.ts).
 *
 * courseId / moduleId are optional in the EventLog model and are omitted here:
 * the CLI is invoked with an item id, not a course, and neither the G5 BatchGet
 * gate (exact eventId) nor the analysis exclusion query (eventType +
 * moduleItemId) needs them.
 *
 * NEVER deleted by --purge-student: purge clears a tester's study data, but the
 * account must stay permanently disqualified from the formal cohort.
 */
function buildTesterHistoryMarker(itemId, sub, now, payload) {
  return {
    eventId: testerHistoryEventId(itemId, sub),
    studentUserId: sub,
    studentDateKey: `${sub}#${now.slice(0, 10)}`,
    moduleItemId: itemId,
    eventType: TESTER_HISTORY_EVENT_TYPE,
    payload,
    createdAt: now,
  };
}

function buildTesterImportedEvent(itemId, sub, now, payload) {
  return {
    eventId: `phase3:tester-imported:${itemId}:${sub}:${now}`,
    studentUserId: sub,
    studentDateKey: `${sub}#${now.slice(0, 10)}`,
    moduleItemId: itemId,
    eventType: TESTER_IMPORTED_EVENT_TYPE,
    payload,
    createdAt: now,
  };
}

/**
 * The complete tester write, as ONE all-or-nothing transaction.
 *
 * The invariant this function exists to hold: tester cards and the permanent
 * tester-history marker are written together or not at all. There is no branch
 * anywhere that writes the cards alone — that would leave a tester account the
 * website's formal-import gate cannot see, letting it later enter the cohort.
 */
function buildTesterTransactItems({
  feedbackTable,
  eventLogTable,
  itemId,
  testerSub,
  testerRows,
  now,
  operatorUserId,
  batchId,
  sourceCsvSha256,
}) {
  if (!eventLogTable) {
    fail("Refusing to build a tester write without an EventLog table.");
  }
  return [
    ...testerRows.map((Item) => ({
      Put: {
        TableName: feedbackTable,
        Item,
        ConditionExpression: "attribute_not_exists(feedbackId)",
      },
    })),
    {
      Put: {
        TableName: eventLogTable,
        Item: buildTesterHistoryMarker(itemId, testerSub, now, {
          operatorUserId,
          batchId,
          sourceCsvSha256,
          lastImportedAt: now,
          writtenBy: "cli",
        }),
      },
    },
    {
      Put: {
        TableName: eventLogTable,
        Item: buildTesterImportedEvent(itemId, testerSub, now, {
          operatorUserId,
          batchId,
          rowCount: testerRows.length,
          sourceCsvSha256,
          writtenBy: "cli",
        }),
      },
    },
  ];
}

/**
 * Strongly consistent by design: this feeds exact/absent/mixed adjudication and
 * the purge target list. See the concurrency note above main() for why an
 * eventually-consistent read here would reopen the race the flow guard closes.
 */
/**
 * Classify every stored row under a purge target. Returns human-readable reasons
 * for anything that is not provably a deterministic tester row of THIS student
 * under THIS scope item.
 *
 * Legacy / unknown rows are deliberately NOT cleaned up here: a tester purge
 * must never guess at rows whose provenance it cannot establish. Clearing those
 * is a separate, individually approved maintenance operation.
 */
function classifyPurgeRows(rows, itemId, sub) {
  const offenders = [];
  for (const r of rows) {
    if (r._importKind === IMPORT_KIND_FORMAL) {
      offenders.push(`${r.feedbackId}: belongs to the formal cohort`);
      continue;
    }
    if (r._importKind !== IMPORT_KIND_TESTER) {
      offenders.push(
        `${r.feedbackId}: no _importKind, so its type cannot be confirmed`
      );
      continue;
    }
    if (!DISPLAY_KEYS.includes(r.displayKey)) {
      offenders.push(`${r.feedbackId}: displayKey "${r.displayKey}" is not A/B/C`);
      continue;
    }
    if (r.moduleItemId !== itemId) {
      offenders.push(`${r.feedbackId}: moduleItemId is not ${itemId}`);
      continue;
    }
    if (r.studentUserId !== sub) {
      offenders.push(`${r.feedbackId}: studentUserId is not ${sub}`);
      continue;
    }
    if (r.feedbackId !== feedbackId(sub, r.displayKey)) {
      offenders.push(`${r.feedbackId}: not a deterministic phase3:<sub>:<key> id`);
    }
  }
  const testerRows = rows.filter((r) => r._importKind === IMPORT_KIND_TESTER);
  return { offenders, testerRows };
}

/**
 * One tester's purge as a single all-or-nothing transaction, identical in shape
 * to the website's.
 *
 * The four-part condition on each ReviewerFeedback delete is what authorizes the
 * unconditional SurveyInstance / StudentItemProgress deletes riding alongside
 * it: if any condition fails the transaction is cancelled and NOTHING is
 * deleted. At least one conditional delete must therefore be present.
 *
 * The permanent tester-history marker is deliberately absent from this list.
 */
function buildPurgeTransactItems({
  feedbackTable,
  instanceTable,
  progressTable,
  eventLogTable,
  moduleItemTable,
  itemId,
  partDItemId,
  sub,
  displayKeys,
  observedGeneration,
  now,
  operatorUserId,
}) {
  if (!eventLogTable || !moduleItemTable) {
    fail("Refusing to build a purge without the EventLog and ModuleItem tables.");
  }
  if (!displayKeys || displayKeys.length < 1) {
    fail(
      "Refusing to build a purge with no conditional delete: the guarded deletes are\n" +
        "what authorize the unconditional ones."
    );
  }
  return [
    {
      Update: {
        TableName: moduleItemTable,
        Key: { moduleItemId: itemId },
        UpdateExpression: "SET #gen = :next",
        ConditionExpression:
          observedGeneration === null
            ? "attribute_not_exists(#gen)"
            : "#gen = :expectedGen",
        ExpressionAttributeNames: { "#gen": TESTER_GENERATION_ATTR },
        ExpressionAttributeValues: {
          ":next": (observedGeneration ?? 0) + 1,
          ...(observedGeneration === null
            ? {}
            : { ":expectedGen": observedGeneration }),
        },
      },
    },
    ...displayKeys.map((displayKey) => ({
      Delete: {
        TableName: feedbackTable,
        Key: { feedbackId: feedbackId(sub, displayKey) },
        ConditionExpression:
          "#kind = :tester AND #mi = :ac AND #su = :sub AND #dk = :key",
        ExpressionAttributeNames: {
          "#kind": "_importKind",
          "#mi": "moduleItemId",
          "#su": "studentUserId",
          "#dk": "displayKey",
        },
        ExpressionAttributeValues: {
          ":tester": IMPORT_KIND_TESTER,
          ":ac": itemId,
          ":sub": sub,
          ":key": displayKey,
        },
      },
    })),
    ...[itemId, partDItemId].flatMap((phase3ItemId) => [
      {
        Delete: {
          TableName: instanceTable,
          Key: { moduleItemId: phase3ItemId, studentUserId: sub },
        },
      },
      {
        Delete: {
          TableName: progressTable,
          Key: { moduleItemId: phase3ItemId, studentUserId: sub },
        },
      },
    ]),
    {
      Put: {
        TableName: eventLogTable,
        Item: {
          eventId: `phase3:tester-purged:${itemId}:${sub}:${now}`,
          studentUserId: sub,
          studentDateKey: `${sub}#${now.slice(0, 10)}`,
          moduleItemId: itemId,
          eventType: TESTER_PURGED_EVENT_TYPE,
          payload: {
            operatorUserId,
            deleted: {
              reviewerFeedback: displayKeys.length,
              surveyInstance: 2,
              studentItemProgress: 2,
            },
            eventLogRetained: true,
            testerHistoryMarkerRetained: true,
            writtenBy: "cli",
          },
          createdAt: now,
        },
      },
    },
  ];
}

async function scanStudentRows(ddb, table, itemId, sub) {
  const out = [];
  let lastKey;
  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: table,
        FilterExpression: "moduleItemId = :i AND studentUserId = :s",
        ExpressionAttributeValues: { ":i": itemId, ":s": sub },
        ConsistentRead: true,
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      })
    );
    out.push(...(res.Items || []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return out;
}

async function resolveAndPrintTarget(args, feedbackTable, userPoolId, region) {
  const sts = new STSClient({ region });
  const identity = await sts.send(new GetCallerIdentityCommand({}));
  const accountId = identity.Account;
  if (!accountId) fail("AWS STS did not return an account id.");
  const target = `${accountId}/${region}/${feedbackTable}/${userPoolId}`;
  console.log("\nAWS target");
  console.log(`  account:  ${accountId}`);
  console.log(`  region:   ${region}`);
  console.log(`  feedback: ${feedbackTable}`);
  console.log(`  user pool: ${userPoolId}`);
  console.log(`  confirm:  ${target}`);

  if (args.commit) {
    if (!args.expectedAccountId) {
      fail("--expected-account-id is required for every --commit operation.");
    }
    if (args.expectedAccountId !== accountId) {
      fail(
        `AWS account mismatch: expected ${args.expectedAccountId}, current credentials are ${accountId}.`
      );
    }
    if (args.confirmTarget !== target) {
      fail(`--confirm-target must exactly equal "${target}" for this commit.`);
    }
  }
  return { accountId, target };
}

// ───────────────────────── audit output ─────────────────────────

function csvEscape(v) {
  const s = v === undefined || v === null ? "" : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Seed-time mapping audit. Deliberately contains ONLY what exists at seed time.
 * Reveal state, timestamps and survey responses do not exist yet and are left to
 * the existing survey CSV export, joined offline on studentUserId.
 */
function writeAuditCsv(path, entries, { assignmentVersion, randomSeed }) {
  const header = [
    "review_id",
    "study_id",
    "student_email",
    "student_user_id",
    "card_a_source",
    "card_b_source",
    "card_c_source",
    "source_order",
    "card_a_hash",
    "card_b_hash",
    "card_c_hash",
    "assignment_version",
    "random_seed",
    "selected_source",
    "session",
    "student_turns",
    "seeded_at",
  ];
  const lines = [header.map(csvEscape).join(",")];
  for (const e of entries) {
    lines.push(
      [
        e.review_id,
        e.study_id,
        e.student_email,
        e.sub,
        e.sources.A,
        e.sources.B,
        e.sources.C,
        e.order,
        e.hashes.A,
        e.hashes.B,
        e.hashes.C,
        assignmentVersion,
        randomSeed,
        e.selected_source,
        e.session,
        e.student_turns,
        e.seededAt,
      ]
        .map(csvEscape)
        .join(",")
    );
  }
  writeFileSync(path, "﻿" + lines.join("\n"), "utf8");
  console.log(`\nAudit mapping written to ${path}`);
}

// ───────────────────────── main ─────────────────────────

/**
 * Verify every resolved account against the target course roster.
 *
 * Cognito exact-match alone only proves an account exists somewhere in the pool;
 * it says nothing about whether that person is in THIS course. The website
 * resolves through active CourseEnrollment rows for exactly that reason, and the
 * CLI must not be a weaker door into the same tables.
 *
 * Counts ROWS, not distinct accounts: two active rows for one email are a roster
 * defect even when both name the same sub, and this import must not be the thing
 * that silently picks one.
 */
async function verifyActiveEnrollments(ddb, enrollmentTable, courseId, resolution) {
  const rowsByEmail = new Map();
  let lastKey;
  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: enrollmentTable,
        FilterExpression: "courseId = :c",
        ExpressionAttributeValues: { ":c": courseId },
        ConsistentRead: true,
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      })
    );
    for (const row of res.Items || []) {
      if (row?.status !== "active") continue;
      const email = String(row.studentEmail ?? "").normalize("NFC").trim().toLowerCase();
      const sub = String(row.studentUserId ?? "");
      if (!email || !sub) continue;
      if (!rowsByEmail.has(email)) rowsByEmail.set(email, []);
      rowsByEmail.get(email).push(sub);
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  const errors = [];
  const seenSub = new Map();
  for (const [email, sub] of resolution) {
    const key = String(email).normalize("NFC").trim().toLowerCase();
    const enrolled = rowsByEmail.get(key) ?? [];
    if (enrolled.length === 0) {
      errors.push(
        `${email}: no active CourseEnrollment in course ${courseId}. Enroll the student first.`
      );
      continue;
    }
    if (enrolled.length > 1) {
      const distinct = new Set(enrolled).size;
      errors.push(
        `${email}: ${enrolled.length} active enrollment rows` +
          (distinct === 1
            ? " for the same account — the roster is duplicated; remove the extra row."
            : ` resolving to ${distinct} different accounts — ambiguous, refusing to guess.`)
      );
      continue;
    }
    if (enrolled[0] !== sub) {
      errors.push(
        `${email}: Cognito resolved ${sub} but the course roster has ${enrolled[0]} — refusing to bind feedback.`
      );
      continue;
    }
    const previous = seenSub.get(sub);
    if (previous && previous !== key) {
      errors.push(
        `${previous} and ${email} resolve to the same VOICE account — feedback would be cross-bound.`
      );
      continue;
    }
    seenSub.set(sub, key);
  }
  return errors;
}

/**
 * ───────────────── Concurrency proof (CLI and website share it) ─────────────────
 *
 * Tester imports, formal imports and purges are made mutually exclusive by a
 * conditional Update on ONE DynamoDB item — the Parts A-C ModuleItem row, which
 * carries `_phase3TesterGeneration` and `_phase3FormalImportedAt`.
 *
 *   1. Read the flow generation off that row with ConsistentRead.
 *   2. Read the feedback / tester state under that item with ConsistentRead.
 *   3. Any tester import or purge — whether it committed before those reads or
 *      races them — MUST also move the generation, because every one of them
 *      carries a conditional write on that same row.
 *   4. The commit transaction conditions on `#gen = :observed`, so anything the
 *      reads could have missed makes the condition fail and the transaction is
 *      cancelled with nothing written.
 *   5. Therefore the dangerous window cannot exist: "saw the newest generation,
 *      but the feedback scan had not yet surfaced an already-committed tester
 *      row or its history marker".
 *
 * Step 5 is precisely what a default eventually-consistent read would reopen — a
 * replica may serve the current generation while still omitting a committed
 * tester row, and the guard would then be satisfied by a scan blind to the very
 * thing it exists to detect. Every read below that feeds a safety decision
 * therefore sets ConsistentRead, and that is not optional.
 */
async function main() {
  const args = parseArgs(process.argv);

  const FEEDBACK_TABLE = process.env.REVIEWER_FEEDBACK_TABLE_NAME;
  if (!FEEDBACK_TABLE)
    fail("Set REVIEWER_FEEDBACK_TABLE_NAME to the ReviewerFeedback table.");
  if (!args.itemId)
    fail("--item-id is required (the Phase 3 Parts A-C ModuleItem id).");
  const region = process.env.AWS_REGION;
  if (!region)
    fail(
      "Set AWS_REGION explicitly; implicit profile regions are not accepted."
    );
  const userPoolId = process.env.USER_POOL_ID;
  if (!userPoolId)
    fail("Set USER_POOL_ID so target accounts can be resolved exactly.");

  // Checked BEFORE any AWS call.
  //  - EventLog: a tester import writes the permanent tester-history marker in
  //    the same transaction as the cards, and a formal import writes its audit
  //    record in the same transaction as the cohort. Without the table there is
  //    no safe write, so refuse rather than leave a marker-less fallback path.
  //  - ModuleItem: hosts the flow-state attributes every import conditions on.
  //    Without it the CLI could not participate in the tester/formal mutual
  //    exclusion and could race the website.
  const EVENT_LOG_TABLE = process.env.EVENT_LOG_TABLE_NAME;
  const MODULE_ITEM_TABLE = process.env.MODULE_ITEM_TABLE_NAME;
  const COURSE_ENROLLMENT_TABLE = process.env.COURSE_ENROLLMENT_TABLE_NAME;
  const needsWriteTables = args.tester || args.commit;
  if (needsWriteTables && !EVENT_LOG_TABLE) {
    fail(
      "Set EVENT_LOG_TABLE_NAME. Tester cards are written together with a permanent\n" +
        "tester-history marker, and the formal cohort together with its audit record —\n" +
        "both in one transaction. Refusing to write without it."
    );
  }
  if (needsWriteTables && !MODULE_ITEM_TABLE) {
    fail(
      "Set MODULE_ITEM_TABLE_NAME. Every import takes a conditional write on the\n" +
        "Parts A-C ModuleItem row so tester and formal imports cannot race each other.\n" +
        "Refusing to write without it."
    );
  }

  // Every import — dry-run included — proves its accounts against the target
  // course roster, not just against Cognito. A dry run that skipped this would
  // report a mapping the commit then refuses, which is worse than useless.
  const isImportRun = Boolean(args.csv) && !args.verify;
  if (isImportRun && !MODULE_ITEM_TABLE) {
    fail(
      "Set MODULE_ITEM_TABLE_NAME. The course is read from the Parts A-C ModuleItem row\n" +
        "so accounts can be checked against that course's roster."
    );
  }
  if (isImportRun && !COURSE_ENROLLMENT_TABLE) {
    fail(
      "Set COURSE_ENROLLMENT_TABLE_NAME. Every imported account must hold exactly one\n" +
        "active CourseEnrollment in the target course; a Cognito match alone does not\n" +
        "prove the student is in this course. Refusing to import."
    );
  }

  // The formal cohort's provenance is frozen. Accept the flags for continuity,
  // but only if they repeat the frozen values exactly — an operator must not be
  // able to stamp a cohort with anything else.
  if (!args.tester && args.commit) {
    if (
      args.assignmentVersion !== FORMAL_ASSIGNMENT_VERSION ||
      args.randomSeed !== FORMAL_RANDOM_SEED
    ) {
      fail(
        `Formal provenance is frozen: --assignment-version must be "${FORMAL_ASSIGNMENT_VERSION}" ` +
          `and --random-seed must be "${FORMAL_RANDOM_SEED}" ` +
          `(got "${args.assignmentVersion}" / "${args.randomSeed}").`
      );
    }
  }
  if (args.tester && (args.assignmentVersion || args.randomSeed)) {
    fail(
      "--assignment-version / --random-seed are formal-cohort provenance and must not\n" +
        "be supplied for a tester import."
    );
  }

  const { accountId } = await resolveAndPrintTarget(
    args,
    FEEDBACK_TABLE,
    userPoolId,
    region
  );
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

  // ── maintenance modes ──
  if (args.purgeStudent || args.revealStudent) {
    if (args.commit && (args.dryRun || args.verify)) {
      fail("--commit cannot be combined with --dry-run or --verify.");
    }
    const sub = args.purgeStudent || args.revealStudent;
    if (args.purgeStudent && args.revealStudent) {
      fail(
        "Choose only one maintenance operation: --purge-student or --reveal-student."
      );
    }
    if (args.commit && args.confirmStudent !== sub) {
      fail(`--confirm-student must exactly repeat the target sub "${sub}".`);
    }
    if (!args.studentEmail) {
      fail(
        "--student-email is required so the target sub can be confirmed against Cognito."
      );
    }
    if (!/^[^\s@"\\]+@[^\s@"\\]+\.[^\s@"\\]+$/.test(args.studentEmail)) {
      fail("--student-email is not a safe exact email value.");
    }
    const cognito = new CognitoIdentityProviderClient({ region });
    const confirmed = await resolveEmail(
      cognito,
      userPoolId,
      args.studentEmail
    );
    if (!confirmed.ok || confirmed.sub !== sub) {
      fail(
        `Maintenance target mismatch: ${args.studentEmail} resolved to ` +
          `${confirmed.ok ? confirmed.sub : confirmed.reason}, not ${sub}.`
      );
    }
    console.log(`Confirmed student: ${args.studentEmail} -> ${sub}`);

    const rows = await scanStudentRows(ddb, FEEDBACK_TABLE, args.itemId, sub);
    console.log(
      `Found ${rows.length} ReviewerFeedback row(s) for ${sub} under ${args.itemId}.`
    );

    if (args.purgeStudent) {
      const instanceTable = process.env.SURVEY_INSTANCE_TABLE_NAME;
      const progressTable = process.env.STUDENT_ITEM_PROGRESS_TABLE_NAME;
      const eventLogTable = process.env.EVENT_LOG_TABLE_NAME;
      const moduleItemTable = process.env.MODULE_ITEM_TABLE_NAME;
      if (!args.partDItemId) {
        fail("--part-d-item-id is required for a scoped Phase 3 tester purge.");
      }
      if (!instanceTable || !progressTable) {
        fail(
          "Set SURVEY_INSTANCE_TABLE_NAME and STUDENT_ITEM_PROGRESS_TABLE_NAME; " +
            "purge refuses an incomplete tester reset."
        );
      }
      if (args.commit && (!eventLogTable || !moduleItemTable)) {
        fail(
          "Set EVENT_LOG_TABLE_NAME and MODULE_ITEM_TABLE_NAME. A purge writes its audit\n" +
            "record and takes the flow-generation guard inside the same transaction as the\n" +
            "deletes; without them there is no safe purge. Refusing."
        );
      }

      // ── Flow state, strongly consistent (see the concurrency proof above) ──
      let purgeGeneration = null;
      if (moduleItemTable) {
        const acRow = await ddb.send(
          new GetCommand({
            TableName: moduleItemTable,
            Key: { moduleItemId: args.itemId },
            ConsistentRead: true,
          })
        );
        const acItem = acRow.Item || {};
        purgeGeneration =
          typeof acItem[TESTER_GENERATION_ATTR] === "number"
            ? acItem[TESTER_GENERATION_ATTR]
            : null;
      }

      console.log("Purge scope:");
      console.log(`  feedback scope: ${args.itemId}`);
      console.log(`  survey/progress: ${args.itemId}, ${args.partDItemId}`);
      console.log(`  flow generation: ${purgeGeneration ?? "(unset)"}`);

      // ── Fail-closed classification (see classifyPurgeRows) ──
      const { offenders, testerRows } = classifyPurgeRows(rows, args.itemId, sub);
      if (offenders.length > 0) {
        console.error("\n✖ Refusing purge — NOTHING was deleted. Offending rows:\n");
        for (const o of offenders) console.error(`  - ${o}`);
        console.error(
          "\nFormal cohort rows are never removed by a tester purge, and rows whose\n" +
            "type cannot be confirmed need a separate, approved maintenance step."
        );
        process.exit(1);
      }
      if (testerRows.length < 1) {
        fail(
          "No tester feedback rows remain for this account, so a guarded purge cannot be\n" +
            "built: the conditional deletes are what authorize the unconditional ones."
        );
      }

      const nowIso = new Date().toISOString();
      const purgeItems = buildPurgeTransactItems({
        feedbackTable: FEEDBACK_TABLE,
        instanceTable,
        progressTable,
        eventLogTable,
        moduleItemTable,
        itemId: args.itemId,
        partDItemId: args.partDItemId,
        sub,
        displayKeys: testerRows.map((r) => r.displayKey),
        observedGeneration: purgeGeneration,
        now: nowIso,
        operatorUserId: `cli:${accountId}`,
      });

      if (purgeItems.length > 100) {
        fail(
          `Refusing purge: ${purgeItems.length} transaction items exceeds DynamoDB's limit of 100.`
        );
      }

      console.log(`\nPurge transaction (${purgeItems.length} items, all-or-nothing):`);
      console.log(`  GUARD  ${TESTER_GENERATION_ATTR} ${purgeGeneration ?? "(unset)"} -> ${(purgeGeneration ?? 0) + 1}`);
      for (const r of testerRows) {
        console.log(
          `  DELETE ${feedbackId(sub, r.displayKey)}  (conditional: tester/item/student/key)`
        );
      }
      for (const phase3ItemId of [args.itemId, args.partDItemId]) {
        console.log(`  DELETE SurveyInstance ${phase3ItemId}/${sub}`);
        console.log(`  DELETE StudentItemProgress ${phase3ItemId}/${sub}`);
      }
      console.log("  PUT    EventLog phase3_tester_purged  (audit)");

      if (!args.commit) {
        console.log(
          "\nDry run — nothing deleted. Add --commit to send this transaction."
        );
      } else {
        try {
          await ddb.send(new TransactWriteCommand({ TransactItems: purgeItems }));
        } catch (e) {
          if (e?.name === "TransactionCanceledException") {
            throw new Error(
              "Purge transaction cancelled; NOTHING was deleted. Another import, purge " +
                "or the website changed this flow, or a row stopped matching its tester " +
                `conditions. Reasons: ${JSON.stringify(e.CancellationReasons)}`
            );
          }
          throw e;
        }
      }

      console.log(
        "\nRetained (NOT deleted):\n" +
          `  EventLog ${testerHistoryEventId(args.itemId, sub)}\n` +
          "    The permanent tester-history marker. It keeps this account\n" +
          "    permanently disqualified from the formal cohort and is the source\n" +
          "    of the analysis exclusion list.\n" +
          "  EventLog behaviour events (survey_started / survey_submitted /\n" +
          "    module_item_progress) — no answer content; excluded at analysis time.\n" +
          "  CourseEnrollment — purge never unenrolls. Remove the enrollment\n" +
          "    separately if that is intended."
      );
      console.log(
        args.commit
          ? "\nPurge complete. Phase 3 study data removed; audit/behaviour events retained."
          : "\nDry run — nothing deleted. Add --commit."
      );
      return;
    }

    // --reveal-student: repair an interrupted reveal.
    const revealKeys = rows.map((r) => r.displayKey).sort();
    if (rows.length !== 3 || revealKeys.join(",") !== "A,B,C") {
      fail(
        `Refusing reveal: expected exactly A/B/C for ${sub}, found ${
          revealKeys.join(",") || "none"
        }.`
      );
    }
    for (const r of rows) {
      if (r.revealed) continue;
      console.log(
        `  ${args.commit ? "REVEAL" : "would reveal"} ${r.feedbackId}`
      );
      if (args.commit) {
        await ddb.send(
          new PutCommand({
            TableName: FEEDBACK_TABLE,
            Item: { ...r, revealed: true, updatedAt: new Date().toISOString() },
          })
        );
      }
    }
    console.log(
      args.commit
        ? "\nReveal complete."
        : "\nDry run — nothing changed. Add --commit."
    );
    return;
  }

  // ── ingestion modes ──
  if (!args.csv) fail("--csv is required.");
  const modeCount = [args.commit, args.dryRun, args.verify].filter(
    Boolean
  ).length;
  if (modeCount !== 1) {
    fail("Choose a mode: --dry-run, --commit, or --verify.");
  }
  if (args.commit && !args.tester && (!args.assignmentVersion || !args.randomSeed)) {
    fail(
      "--assignment-version and --random-seed are required for a formal --commit (audit provenance)."
    );
  }

  if (args.tester) {
    console.log(
      `\nTester mode: a permanent tester-history marker will be written to ${EVENT_LOG_TABLE}\n` +
        "and is NEVER removed by --purge-student."
    );
  }

  const records = readTemplate(args.csv);
  const errors = validate(records, { tester: args.tester });
  if (errors.length > 0) {
    console.error(
      `\n✖ Validation failed with ${errors.length} problem(s). Nothing was written.\n`
    );
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`✔ Validation passed: ${records.length} rows.`);

  const cognito = new CognitoIdentityProviderClient({ region });

  const byEmail = new Map();
  for (const r of records) {
    if (!byEmail.has(r.student_email)) byEmail.set(r.student_email, []);
    byEmail.get(r.student_email).push(r);
  }
  if (args.tester && args.commit) {
    if (!args.testerEmail)
      fail("--tester-email is required with --tester --commit.");
    if (byEmail.size !== 1 || !byEmail.has(args.testerEmail)) {
      fail(
        `Tester commit must contain exactly one student matching --tester-email ${args.testerEmail}.`
      );
    }
  }

  // Resolve every email first; a single failure aborts before any write.
  const resolution = new Map();
  const resolveErrors = [];
  for (const email of byEmail.keys()) {
    const res = await resolveEmail(cognito, userPoolId, email);
    if (!res.ok) resolveErrors.push(`${email}: ${res.reason}`);
    else resolution.set(email, res.sub);
  }
  if (resolveErrors.length > 0) {
    console.error(`\n✖ Account resolution failed. Nothing was written.\n`);
    for (const e of resolveErrors) console.error(`  - ${e}`);
    process.exit(1);
  }
  const uniqueSubs = new Set(resolution.values());
  if (uniqueSubs.size !== resolution.size) {
    fail(
      "Two different emails resolved to the same VOICE account — feedback would be cross-bound."
    );
  }
  console.log(
    `✔ Resolved ${resolution.size} student email(s) to unique VOICE accounts.`
  );

  // ── Flow state + course, read ONCE with ConsistentRead ──
  // Read before the preflight scan: anything landing afterwards either shows up
  // in that scan or moves the generation, and the transaction condition then
  // fails. Both orders are covered (see the concurrency proof above).
  let flowState = { testerGeneration: null, formalImportedAt: null };
  let targetCourseId = null;
  if (MODULE_ITEM_TABLE) {
    const acRow = await ddb.send(
      new GetCommand({
        TableName: MODULE_ITEM_TABLE,
        Key: { moduleItemId: args.itemId },
        ConsistentRead: true,
      })
    );
    const item = acRow.Item || {};
    targetCourseId = typeof item.courseId === "string" ? item.courseId : null;
    flowState = {
      testerGeneration:
        typeof item[TESTER_GENERATION_ATTR] === "number"
          ? item[TESTER_GENERATION_ATTR]
          : null,
      formalImportedAt:
        typeof item[FORMAL_IMPORTED_AT_ATTR] === "string"
          ? item[FORMAL_IMPORTED_AT_ATTR]
          : null,
    };
    console.log(
      `\nFlow state: course=${targetCourseId ?? "(unknown)"}` +
        `, testerGeneration=${flowState.testerGeneration ?? "(unset)"}` +
        `, formalImportedAt=${flowState.formalImportedAt ?? "(none)"}`
    );
    if (args.tester && flowState.formalImportedAt) {
      fail(
        `The formal cohort was imported into this flow on ${flowState.formalImportedAt}.\n` +
          "Tester data can no longer be added; resetting the flow is a research-process decision."
      );
    }
  }

  // ── Course-roster verification ──
  // Cognito proved these accounts exist; the roster proves they belong to THIS
  // course. Both dry-run and commit enforce it, so a dry run can never report a
  // mapping the commit would refuse.
  if (isImportRun) {
    if (!targetCourseId) {
      fail(
        `Could not read a courseId from ModuleItem ${args.itemId}. Accounts cannot be\n` +
          "checked against the course roster, so the import is refused."
      );
    }
    const enrollmentErrors = await verifyActiveEnrollments(
      ddb,
      COURSE_ENROLLMENT_TABLE,
      targetCourseId,
      resolution
    );
    if (enrollmentErrors.length > 0) {
      console.error(
        `\n✖ Course-roster verification failed for ${enrollmentErrors.length} account(s). Nothing was written.\n`
      );
      for (const e of enrollmentErrors) console.error(`  - ${e}`);
      process.exit(1);
    }
    console.log(
      `✔ All ${resolution.size} account(s) hold exactly one active enrollment in course ${targetCourseId}.`
    );
  }

  // ── dry-run mapping table ──
  console.log(
    "\nREVIEW ID    STUDY ID       EMAIL                              USER ID       A / B / C"
  );
  console.log("─".repeat(110));
  const auditEntries = [];
  const now = new Date().toISOString();

  for (const [email, rows] of byEmail) {
    const sub = resolution.get(email);
    const sources = {};
    const hashes = {};
    for (const k of DISPLAY_KEYS) {
      const row = rows.find((r) => r.display_key === k);
      sources[k] = SOURCE_MAP[row.source_internal].displayLabel;
      hashes[k] = contentHash(
        normalizeScore(row.d1),
        normalizeScore(row.d2),
        normalizeScore(row.d3),
        row.narrative
      );
    }
    const first = rows[0];
    console.log(
      `${(first.review_id || "").padEnd(12)} ${(first.study_id || "").padEnd(
        14
      )} ` +
        `${email.padEnd(34)} ${sub.slice(0, 12)}  ${sources.A} / ${
          sources.B
        } / ${sources.C}`
    );
    for (const k of DISPLAY_KEYS) {
      const row = rows.find((r) => r.display_key === k);
      const preview = row.narrative.replace(/\s+/g, " ").slice(0, 60);
      console.log(
        `    Card ${k}: D1=${normalizeScore(row.d1)} D2=${normalizeScore(
          row.d2
        )} ` +
          `D3=${normalizeScore(row.d3)}  hash=${hashes[k].slice(
            0,
            12
          )}  "${preview}…"`
      );
    }
    auditEntries.push({
      review_id: first.review_id,
      study_id: first.study_id,
      student_email: email,
      sub,
      sources,
      hashes,
      order: sourceOrder(rows),
      selected_source: first.selected_source,
      session: first.session,
      student_turns: first.student_turns,
      seededAt: now,
    });
  }

  reportDistribution(byEmail);

  // ── verify mode ──
  if (args.verify) {
    console.log("\nVerifying seeded rows against the frozen template…");
    let mismatches = 0;
    let missing = 0;
    for (const [email, rows] of byEmail) {
      const sub = resolution.get(email);
      const stored = await scanStudentRows(
        ddb,
        FEEDBACK_TABLE,
        args.itemId,
        sub
      );
      const storedById = new Map(stored.map((r) => [r.feedbackId, r]));
      const expectedIds = new Set();
      for (const row of rows) {
        const expected = {
          ...buildRow(row, sub, args.itemId, now),
          ...expectedProvenance(args.tester),
        };
        expectedIds.add(expected.feedbackId);
        const s = storedById.get(expected.feedbackId);
        if (!s) {
          console.log(`  MISSING  ${email} card ${row.display_key}`);
          missing++;
          continue;
        }
        if (!rowMatchesExpected(s, expected)) {
          console.log(
            `  MISMATCH ${email} card ${row.display_key}: stored row content, source, import kind or frozen provenance does not match`
          );
          mismatches++;
        }
      }
      for (const s of stored) {
        if (!expectedIds.has(s.feedbackId)) {
          console.log(`  UNEXPECTED ${email}: ${s.feedbackId}`);
          mismatches++;
        }
      }
    }
    if (missing === 0 && mismatches === 0) {
      console.log("✔ All seeded cards match the frozen artifacts.");
    } else {
      console.error(`\n✖ ${missing} missing, ${mismatches} mismatched.`);
      process.exit(1);
    }
    return;
  }

  // ── dry run stops here ──
  if (!args.commit) {
    console.log(
      "\nDry run complete — nothing was written.\n" +
        "Review the mapping above, then re-run with --commit --assignment-version <v> --random-seed <s>."
    );
    return;
  }

  if (!args.tester && args.commit && flowState.formalImportedAt) {
    fail(
      `The formal cohort was already imported on ${flowState.formalImportedAt}.\n` +
        "Use --verify to confirm the stored rows instead of importing again."
    );
  }

  // ── Preflight: four-way, and NO resume in either mode ──
  // A commit is either "write the whole set" or "the whole set is already there
  // and verified". A partial overlap means the stored rows and this file do not
  // have a single provenance, and stitching them together is exactly what must
  // not happen to a frozen cohort.
  console.log("\nPreflighting existing rows…");
  const expectedRowCount = records.length;
  const existingExact = new Set();
  const preflightErrors = [];
  for (const [email, rows] of byEmail) {
    const sub = resolution.get(email);
    const stored = await scanStudentRows(ddb, FEEDBACK_TABLE, args.itemId, sub);
    const expectedById = new Map(
      rows.map((record) => {
        const item = {
          ...buildRow(record, sub, args.itemId, now),
          ...expectedProvenance(args.tester),
        };
        return [item.feedbackId, item];
      })
    );
    for (const actual of stored) {
      const expected = expectedById.get(actual.feedbackId);
      if (!expected) {
        preflightErrors.push(
          `${email}: unexpected existing row ${actual.feedbackId}`
        );
      } else if (!rowMatchesExpected(actual, expected)) {
        preflightErrors.push(
          `${email}: existing row differs from frozen input, import kind or provenance (${actual.feedbackId})`
        );
      } else {
        existingExact.add(actual.feedbackId);
      }
    }
  }
  if (preflightErrors.length > 0) {
    console.error(
      "\n✖ Existing-row preflight failed. Nothing was written in this run.\n"
    );
    for (const e of preflightErrors) console.error(`  - ${e}`);
    process.exit(1);
  }
  // Formal must not land while any tester or unclassifiable row is present —
  // the same two gates the website applies, so both writers agree.
  if (!args.tester) {
    const scopeRows = [];
    let lastKey;
    do {
      const res = await ddb.send(
        new ScanCommand({
          TableName: FEEDBACK_TABLE,
          FilterExpression: "moduleItemId = :i",
          ExpressionAttributeValues: { ":i": args.itemId },
          ConsistentRead: true,
          ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
        })
      );
      scopeRows.push(...(res.Items || []));
      lastKey = res.LastEvaluatedKey;
    } while (lastKey);
    const testerSubs = new Set(
      scopeRows
        .filter((r) => r._importKind === IMPORT_KIND_TESTER)
        .map((r) => r.studentUserId)
    );
    const unknown = scopeRows.filter(
      (r) =>
        r._importKind !== IMPORT_KIND_TESTER && r._importKind !== IMPORT_KIND_FORMAL
    );
    if (testerSubs.size > 0) {
      fail(
        `${testerSubs.size} tester(s) still hold Phase 3 data under ${args.itemId}.\n` +
          "Purge them before importing the formal cohort."
      );
    }
    if (unknown.length > 0) {
      fail(
        `${unknown.length} Phase 3 row(s) under ${args.itemId} have no import type and\n` +
          "cannot be classified. Resolve them before importing the formal cohort."
      );
    }
  }

  const allExact = existingExact.size === expectedRowCount;
  const allAbsent = existingExact.size === 0;
  if (!allExact && !allAbsent) {
    console.error(
      `\n✖ ${existingExact.size} of ${expectedRowCount} rows already exist. This is a partial\n` +
        `  ${args.tester ? "tester set" : "cohort"}, and resuming is not supported: the result would\n` +
        `  have mixed provenance. Nothing was written.\n` +
        (args.tester
          ? "  Purge this tester (--purge-student) and import all three cards again.\n"
          : "  Investigate where the existing rows came from, clear them, then import\n" +
            `  all ${FORMAL_ROW_COUNT} rows again.\n`)
    );
    process.exit(1);
  }
  console.log(
    allExact
      ? `✔ All ${expectedRowCount} row(s) already present and verified.`
      : `✔ No rows present yet; all ${expectedRowCount} will be written in one transaction.`
  );

  // ── write ──
  const sourceCsvSha256 = createHash("sha256")
    .update(readFileSync(args.csv), "utf8")
    .digest("hex");
  const auditCtx = {
    now,
    importKind: args.tester ? IMPORT_KIND_TESTER : IMPORT_KIND_FORMAL,
    importBatchId: `${args.itemId}:cli:${now}`,
    importedByUserId: `cli:${accountId}`,
    sourceCsvSha256,
    // Formal provenance is frozen and is never stamped onto tester data.
    ...(args.tester
      ? {}
      : {
          assignmentVersion: FORMAL_ASSIGNMENT_VERSION,
          randomSeed: FORMAL_RANDOM_SEED,
        }),
  };

  let written = 0;
  let skipped = 0;

  // The flow-state guard, identical to the website's: a conditional Update on
  // the Parts A-C ModuleItem row. Because every tester import, formal import
  // and purge takes a conditional write on that SAME item, two concurrent
  // writers cannot both commit — DynamoDB cancels the loser.
  const flowGuard = (kind) => {
    const names = {
      "#gen": TESTER_GENERATION_ATTR,
      "#formalAt": FORMAL_IMPORTED_AT_ATTR,
    };
    const values = {};
    const genCondition =
      flowState.testerGeneration === null
        ? "attribute_not_exists(#gen)"
        : ((values[":expectedGen"] = flowState.testerGeneration), "#gen = :expectedGen");
    if (kind === "formal-commit") {
      names["#formalBatch"] = FORMAL_BATCH_ATTR;
      values[":now"] = now;
      values[":batch"] = auditCtx.importBatchId;
      return {
        Update: {
          TableName: MODULE_ITEM_TABLE,
          Key: { moduleItemId: args.itemId },
          UpdateExpression: "SET #formalAt = :now, #formalBatch = :batch",
          ConditionExpression: `attribute_not_exists(#formalAt) AND ${genCondition}`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        },
      };
    }
    values[":next"] = (flowState.testerGeneration ?? 0) + 1;
    return {
      Update: {
        TableName: MODULE_ITEM_TABLE,
        Key: { moduleItemId: args.itemId },
        UpdateExpression: "SET #gen = :next",
        ConditionExpression: `attribute_not_exists(#formalAt) AND ${genCondition}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      },
    };
  };

  const sendTransaction = async (transactItems, label) => {
    if (transactItems.length > 100) {
      fail(
        `Refusing to write: ${transactItems.length} transaction items exceeds DynamoDB's limit of 100.`
      );
    }
    try {
      await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));
    } catch (e) {
      if (e?.name === "TransactionCanceledException") {
        throw new Error(
          `${label} transaction cancelled; NOTHING was written. ` +
            `Another import, purge or the website may have changed this flow. ` +
            `Reasons: ${JSON.stringify(e.CancellationReasons)}`
        );
      }
      throw e;
    }
  };

  if (args.tester) {
    const testerEmail = [...byEmail.keys()][0];
    const testerSub = resolution.get(testerEmail);
    const testerRows = byEmail
      .get(testerEmail)
      .map((record) =>
        withAuditAttrs(buildRow(record, testerSub, args.itemId, now), auditCtx)
      );
    const markerId = testerHistoryEventId(args.itemId, testerSub);

    if (allExact) {
      // Cards verified identical. The marker may predate this safeguard, so
      // (re)assert it rather than reporting a clean verify over an account the
      // website's formal gate cannot see.
      console.log(`  verified ${testerRows.length} card(s); asserting marker`);
      console.log(`  PUT  ${markerId}`);
      await sendTransaction(
        [
          flowGuard("tester-import"),
          {
            Put: {
              TableName: EVENT_LOG_TABLE,
              Item: buildTesterHistoryMarker(args.itemId, testerSub, now, {
                operatorUserId: auditCtx.importedByUserId,
                batchId: auditCtx.importBatchId,
                sourceCsvSha256,
                lastImportedAt: now,
                writtenBy: "cli",
                backfilled: true,
              }),
            },
          },
        ],
        "Tester marker"
      );
      skipped = testerRows.length;
    } else {
      // ONE transaction containing the cards AND the permanent marker. There is
      // deliberately no path that writes tester cards without the marker.
      console.log("\nWriting tester rows + tester-history marker (one transaction)…");
      for (const r of testerRows) console.log(`  PUT  ${r.feedbackId}`);
      console.log(`  PUT  ${markerId}   (permanent tester-history marker)`);
      await sendTransaction(
        [
          flowGuard("tester-import"),
          ...buildTesterTransactItems({
            feedbackTable: FEEDBACK_TABLE,
            eventLogTable: EVENT_LOG_TABLE,
            itemId: args.itemId,
            testerSub,
            testerRows,
            now,
            operatorUserId: auditCtx.importedByUserId,
            batchId: auditCtx.importBatchId,
            sourceCsvSha256,
          }),
        ],
        "Tester"
      );
      written = testerRows.length;
    }
  } else if (allExact) {
    console.log(
      `\n✔ All ${expectedRowCount} formal rows already present with the frozen provenance. Nothing to write.`
    );
    skipped = expectedRowCount;
  } else {
    // ── Formal: ONE all-or-nothing transaction. Never row-by-row: a partial
    //    write is exactly the mixed-provenance cohort this refuses to create.
    console.log(
      `\nWriting ${expectedRowCount} formal rows + audit record (one transaction)…`
    );
    const formalRows = [];
    for (const [email, rows] of byEmail) {
      const sub = resolution.get(email);
      for (const record of rows) {
        formalRows.push(
          withAuditAttrs(buildRow(record, sub, args.itemId, now), auditCtx)
        );
      }
    }
    for (const r of formalRows) console.log(`  PUT  ${r.feedbackId}`);
    const auditEvent = {
      eventId: `${auditCtx.importBatchId}:formal-imported`,
      studentUserId: auditCtx.importedByUserId,
      studentDateKey: `${auditCtx.importedByUserId}#${now.slice(0, 10)}`,
      moduleItemId: args.itemId,
      eventType: FORMAL_IMPORTED_EVENT_TYPE,
      payload: {
        operatorUserId: auditCtx.importedByUserId,
        studentCount: byEmail.size,
        rowCount: formalRows.length,
        batchId: auditCtx.importBatchId,
        sourceCsvSha256,
        assignmentVersion: FORMAL_ASSIGNMENT_VERSION,
        randomSeed: FORMAL_RANDOM_SEED,
        writtenBy: "cli",
      },
      createdAt: now,
    };
    console.log(`  PUT  ${auditEvent.eventId}   (formal audit record)`);
    await sendTransaction(
      [
        flowGuard("formal-commit"),
        ...formalRows.map((Item) => ({
          Put: {
            TableName: FEEDBACK_TABLE,
            Item,
            ConditionExpression: "attribute_not_exists(feedbackId)",
          },
        })),
        { Put: { TableName: EVENT_LOG_TABLE, Item: auditEvent } },
      ],
      "Formal"
    );
    written = formalRows.length;
  }
  console.log(
    `\n✔ Wrote ${written} row(s); skipped ${skipped} already-seeded row(s).`
  );

  const auditPath =
    args.out ||
    `phase3-seed-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  writeAuditCsv(auditPath, auditEntries, {
    assignmentVersion: args.assignmentVersion,
    randomSeed: args.randomSeed,
  });

  console.log(
    "\nRemaining manual step: set the Phase 3 ModuleItem payload fields\n" +
      `  P3-AC.feedbackCardsFromItemId = "${args.itemId}"\n` +
      `  P3-AC.revealOnSubmit.unblindAssignmentItemId = "${args.itemId}"\n` +
      '  P3-AC.cardSections = [{"displayKey":"A","firstQuestionNumber":1},{"displayKey":"B","firstQuestionNumber":7},{"displayKey":"C","firstQuestionNumber":13}]\n' +
      `  P3-D.feedbackCardsFromItemId = "${args.itemId}"\n` +
      `  P3-D.requireFeedbackReveal = true\n` +
      `  assignmentVersion = "${args.assignmentVersion}", randomSeed = "${args.randomSeed}"`
  );
}

export {
  canonicalCardContent,
  contentHash,
  parseCsv,
  readTemplate,
  rowMatchesExpected,
  validate,
  withAuditAttrs,
  buildTesterHistoryMarker,
  buildTesterTransactItems,
  buildPurgeTransactItems,
  classifyPurgeRows,
  verifyActiveEnrollments,
  testerHistoryEventId,
  FORMAL_STUDENT_COUNT,
  FORMAL_ROW_COUNT,
  EXPECTED_SOURCE_ORDERS,
  FORMAL_ASSIGNMENT_VERSION,
  FORMAL_RANDOM_SEED,
  IMPORT_KIND_FORMAL,
  IMPORT_KIND_TESTER,
  TESTER_HISTORY_EVENT_TYPE,
  SOURCE_MAP,
  TEMPLATE_COLUMNS,
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((e) => {
    console.error("\n✖ seed-phase3 failed:", e?.message || e);
    process.exit(1);
  });
}
