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
 *   Commit (only after the dry run has been checked):
 *     ... --commit --expected-account-id <ACCOUNT_ID> \
 *       --confirm-target <ACCOUNT_ID/REGION/REVIEWER_FEEDBACK_TABLE/USER_POOL_ID>
 *
 *   Verify seeded content still matches the frozen CSV:
 *     ... --verify
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
 * Environment
 *   REVIEWER_FEEDBACK_TABLE_NAME  DynamoDB table holding ReviewerFeedback
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
  DeleteCommand,
  ScanCommand,
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
    if (byEmail.size !== 14) {
      errors.push(`Expected 14 unique students, found ${byEmail.size}`);
    }
    if (records.length !== 42) {
      errors.push(`Expected 42 feedback rows, found ${records.length}`);
    }
    const expectedOrders = new Map([
      ["AI→F1→F2", 3],
      ["AI→F2→F1", 2],
      ["F1→AI→F2", 2],
      ["F1→F2→AI", 3],
      ["F2→AI→F1", 2],
      ["F2→F1→AI", 2],
    ]);
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
  console.log("\nSource-order distribution (design §7 target: 3/2/2/3/2/2)");
  const allOrders = [
    "AI→F1→F2",
    "AI→F2→F1",
    "F1→AI→F2",
    "F1→F2→AI",
    "F2→AI→F1",
    "F2→F1→AI",
  ];
  for (const order of allOrders) {
    console.log(`  ${order.padEnd(12)} ${counts.get(order) || 0}`);
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

function rowMatchesExpected(actual, expected) {
  if (!actual) return false;
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

async function scanStudentRows(ddb, table, itemId, sub) {
  const out = [];
  let lastKey;
  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: table,
        FilterExpression: "moduleItemId = :i AND studentUserId = :s",
        ExpressionAttributeValues: { ":i": itemId, ":s": sub },
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

  await resolveAndPrintTarget(args, FEEDBACK_TABLE, userPoolId, region);
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
      if (!args.partDItemId) {
        fail("--part-d-item-id is required for a scoped Phase 3 tester purge.");
      }
      if (!instanceTable || !progressTable) {
        fail(
          "Set SURVEY_INSTANCE_TABLE_NAME and STUDENT_ITEM_PROGRESS_TABLE_NAME; " +
            "purge refuses an incomplete tester reset."
        );
      }
      console.log("Purge scope:");
      console.log(`  feedback scope: ${args.itemId}`);
      console.log(`  survey/progress: ${args.itemId}, ${args.partDItemId}`);
      const unexpectedFeedback = rows.filter(
        (r) =>
          !DISPLAY_KEYS.includes(r.displayKey) ||
          r.feedbackId !== feedbackId(sub, r.displayKey)
      );
      if (unexpectedFeedback.length > 0) {
        fail(
          `Refusing purge: ${unexpectedFeedback.length} row(s) under the target scope are not deterministic Phase 3 rows.`
        );
      }
      for (const r of rows) {
        console.log(
          `  ${args.commit ? "DELETE" : "would delete"} ${r.feedbackId}`
        );
        if (args.commit) {
          await ddb.send(
            new DeleteCommand({
              TableName: FEEDBACK_TABLE,
              Key: { feedbackId: r.feedbackId },
            })
          );
        }
      }
      for (const phase3ItemId of [args.itemId, args.partDItemId]) {
        console.log(
          `  ${
            args.commit ? "DELETE" : "would delete"
          } SurveyInstance ${phase3ItemId}/${sub}`
        );
        console.log(
          `  ${
            args.commit ? "DELETE" : "would delete"
          } StudentItemProgress ${phase3ItemId}/${sub}`
        );
        if (args.commit) {
          await ddb.send(
            new DeleteCommand({
              TableName: instanceTable,
              Key: { moduleItemId: phase3ItemId, studentUserId: sub },
            })
          );
          await ddb.send(
            new DeleteCommand({
              TableName: progressTable,
              Key: { moduleItemId: phase3ItemId, studentUserId: sub },
            })
          );
        }
      }
      console.log(
        args.commit
          ? "\nPurge complete."
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
  if (args.commit && (!args.assignmentVersion || !args.randomSeed)) {
    fail(
      "--assignment-version and --random-seed are required for --commit (audit provenance)."
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
        const expected = buildRow(row, sub, args.itemId, now);
        expectedIds.add(expected.feedbackId);
        const s = storedById.get(expected.feedbackId);
        if (!s) {
          console.log(`  MISSING  ${email} card ${row.display_key}`);
          missing++;
          continue;
        }
        if (!rowMatchesExpected(s, expected)) {
          console.log(
            `  MISMATCH ${email} card ${row.display_key}: stored row/content/source does not match frozen input`
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

  // Preflight every target before the first write. Exact existing rows are
  // resumable (safe recovery after a partial prior run); any divergent or
  // unexpected row aborts the whole commit instead of silently producing a
  // mixed frozen dataset.
  console.log("\nPreflighting existing rows…");
  const existingExact = new Set();
  const preflightErrors = [];
  for (const [email, rows] of byEmail) {
    const sub = resolution.get(email);
    const stored = await scanStudentRows(ddb, FEEDBACK_TABLE, args.itemId, sub);
    const expectedById = new Map(
      rows.map((record) => {
        const item = buildRow(record, sub, args.itemId, now);
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
          `${email}: existing row differs from frozen input (${actual.feedbackId})`
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
  console.log(
    `✔ ${existingExact.size} exact existing row(s) can be resumed safely.`
  );

  // ── write ──
  console.log("\nWriting rows…");
  let written = 0;
  let skipped = 0;
  for (const [email, rows] of byEmail) {
    const sub = resolution.get(email);
    for (const record of rows) {
      const item = buildRow(record, sub, args.itemId, now);
      if (existingExact.has(item.feedbackId)) {
        skipped++;
        console.log(`  skip (verified exact) ${item.feedbackId}`);
        continue;
      }
      try {
        await ddb.send(
          new PutCommand({
            TableName: FEEDBACK_TABLE,
            Item: item,
            // Idempotency: a re-run writes nothing rather than duplicating.
            ConditionExpression: "attribute_not_exists(feedbackId)",
          })
        );
        written++;
      } catch (e) {
        if (e?.name === "ConditionalCheckFailedException") {
          throw new Error(
            `Concurrent row appeared after preflight (${item.feedbackId}); rerun to verify it before continuing.`
          );
        } else {
          throw e;
        }
      }
    }
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
