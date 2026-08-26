/* eslint-disable @typescript-eslint/no-explicit-any -- the import harness models schemaless DynamoDB documents and raw transact items */
import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import {
  batchIdFor,
  buildFlowGuardUpdate,
  buildPurgeTransactItems,
  buildRow,
  classifyExisting,
  computePlanHash,
  executePhase3Import,
  executePhase3PurgeTester,
  executePhase3Status,
  groupByEmail,
  normalizeEmail,
  parseCsv,
  readTemplate,
  resolveEmailsFromEnrollments,
  rowMatchesExpected,
  summarizeFeedbackRows,
  validateRecords,
  type EnrollmentRow,
  type FeedbackRow,
  type Phase3ImportDeps,
} from "./phase3-import";
import {
  PHASE3_FORMAL_ASSIGNMENT_VERSION,
  PHASE3_FORMAL_RANDOM_SEED,
  PHASE3_IMPORT_KIND_FORMAL,
  PHASE3_IMPORT_KIND_TESTER,
  phase3ContentHash,
  phase3FormalConfirmPhrase,
  phase3TesterHistoryEventId,
} from "../shared/phase3-cohort";
import { hashCanonicalCardContent } from "../survey-instance-function/phase3-cards";
import { buildPhase3Cards } from "../survey-instance-function/phase3-cards";

// ───────────────────────── fixtures ─────────────────────────

const HEADER =
  "review_id,study_id,student_email,display_key,source_internal,d1,d2,d3,narrative,selected_source,session,student_turns";

const MODULE_ID = "mod-1";
const COURSE_ID = "course-1";
const AC_ID = `p3ac-${MODULE_ID}`;
const D_ID = `p3d-${MODULE_ID}`;
const NOW = "2026-08-25T10:00:00.000Z";

const ORDER_TO_SOURCES: Record<string, [string, string, string]> = {
  "AI→F1→F2": ["ai", "faculty_1", "faculty_2"],
  "AI→F2→F1": ["ai", "faculty_2", "faculty_1"],
  "F1→AI→F2": ["faculty_1", "ai", "faculty_2"],
  "F1→F2→AI": ["faculty_1", "faculty_2", "ai"],
  "F2→AI→F1": ["faculty_2", "ai", "faculty_1"],
  "F2→F1→AI": ["faculty_2", "faculty_1", "ai"],
};

/** The frozen 3/3/3/3/2/3 allocation, expanded to 17 per-student orders. */
const FORMAL_ORDERS: string[] = [
  ...Array(3).fill("AI→F1→F2"),
  ...Array(3).fill("AI→F2→F1"),
  ...Array(3).fill("F1→AI→F2"),
  ...Array(3).fill("F1→F2→AI"),
  ...Array(2).fill("F2→AI→F1"),
  ...Array(3).fill("F2→F1→AI"),
];

function csvEscape(v: string): string {
  return `"${String(v).replace(/"/g, '""')}"`;
}

interface RowSpec {
  reviewId: string;
  studyId: string;
  email: string;
  displayKey: string;
  sourceInternal: string;
  d1?: string;
  d2?: string;
  d3?: string;
  narrative?: string;
}

function toCsv(specs: RowSpec[]): string {
  const lines = [HEADER];
  for (const s of specs) {
    lines.push(
      [
        s.reviewId,
        s.studyId,
        s.email,
        s.displayKey,
        s.sourceInternal,
        s.d1 ?? "3",
        s.d2 ?? "2",
        s.d3 ?? "N/A",
        csvEscape(s.narrative ?? `Narrative for ${s.email} ${s.displayKey}`),
        "Maria",
        "Attempt 2",
        "42",
      ].join(",")
    );
  }
  return lines.join("\n") + "\n";
}

function studentSpecs(
  index: number,
  order: string,
  overrides: Partial<RowSpec> = {}
): RowSpec[] {
  const n = String(index + 1).padStart(3, "0");
  const email = `student${n}@northeastern.edu`;
  const sources = ORDER_TO_SOURCES[order];
  return ["A", "B", "C"].map((displayKey, i) => ({
    reviewId: `REVIEW-${n}`,
    studyId: `STUDY-${n}`,
    email,
    displayKey,
    sourceInternal: sources[i],
    ...overrides,
  }));
}

function formalSpecs(overrides: Partial<RowSpec> = {}): RowSpec[] {
  return FORMAL_ORDERS.flatMap((order, i) => studentSpecs(i, order, overrides));
}

function formalCsv(overrides: Partial<RowSpec> = {}): string {
  return toCsv(formalSpecs(overrides));
}

function testerCsv(email = "tester1@northeastern.edu"): string {
  return toCsv(
    studentSpecs(900, "AI→F1→F2").map((s) => ({ ...s, email, reviewId: "T-001" }))
  );
}

function formalEnrollments(): EnrollmentRow[] {
  const rows = FORMAL_ORDERS.map((_, i) => {
    const n = String(i + 1).padStart(3, "0");
    return {
      studentUserId: `sub-${n}`,
      studentEmail: `student${n}@northeastern.edu`,
      status: "active",
    };
  });
  rows.push({
    studentUserId: "sub-tester-1",
    studentEmail: "tester1@northeastern.edu",
    status: "active",
  });
  rows.push({
    studentUserId: "sub-tester-2",
    studentEmail: "tester2@northeastern.edu",
    status: "active",
  });
  return rows;
}

function configuredFlow() {
  return [
    {
      moduleItemId: AC_ID,
      moduleId: MODULE_ID,
      courseId: COURSE_ID,
      itemType: "survey",
      title: "Phase 3 Survey — Parts A–C",
      position: 0,
      gating: { kind: "open" },
      payload: {
        surveyTemplateId: "tpl-ac",
        phase3Flow: "parts_ac",
        feedbackCardsFromItemId: AC_ID,
        revealOnSubmit: { unblindAssignmentItemId: AC_ID },
        cardSections: [
          { displayKey: "A", firstQuestionNumber: 1 },
          { displayKey: "B", firstQuestionNumber: 7 },
          { displayKey: "C", firstQuestionNumber: 13 },
        ],
        hideQuestionNumbers: true,
      },
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      moduleItemId: D_ID,
      moduleId: MODULE_ID,
      courseId: COURSE_ID,
      itemType: "survey",
      title: "Phase 3 Survey — Part D",
      position: 1,
      gating: { kind: "after_item", moduleItemId: AC_ID },
      payload: {
        surveyTemplateId: "tpl-d",
        phase3Flow: "part_d",
        feedbackCardsFromItemId: AC_ID,
        requireFeedbackReveal: true,
        hideQuestionNumbers: true,
      },
      createdAt: NOW,
      updatedAt: NOW,
    },
  ] as any[];
}

interface Harness {
  deps: Phase3ImportDeps;
  transactWrite: Mock;
  batchGetEventIds: Mock;
  feedbackRows: FeedbackRow[];
  markers: Set<string>;
}

function makeHarness(opts: {
  feedbackRows?: FeedbackRow[];
  enrollments?: EnrollmentRow[];
  markers?: string[];
  items?: any[];
  batchGetImpl?: (ids: string[]) => Promise<Set<string>>;
  transactImpl?: (items: unknown[], token?: string) => Promise<void>;
  instances?: Record<string, Record<string, unknown>>;
  progress?: Record<string, Record<string, unknown>>;
  flowState?: { testerGeneration?: number; formalImportedAt?: string };
} = {}): Harness {
  const feedbackRows = opts.feedbackRows ?? [];
  const markers = new Set(opts.markers ?? []);
  const transactWrite: Mock = vi.fn(
    opts.transactImpl ?? (async () => undefined)
  );
  const batchGetEventIds: Mock = vi.fn(
    opts.batchGetImpl ??
      (async (ids: string[]) => new Set(ids.filter((id) => markers.has(id))))
  );
  const items = (opts.items ?? configuredFlow()).map((it: any) =>
    it.moduleItemId === AC_ID && opts.flowState
      ? {
          ...it,
          ...(opts.flowState.testerGeneration !== undefined
            ? { _phase3TesterGeneration: opts.flowState.testerGeneration }
            : {}),
          ...(opts.flowState.formalImportedAt
            ? { _phase3FormalImportedAt: opts.flowState.formalImportedAt }
            : {}),
        }
      : it
  );
  const deps: Phase3ImportDeps = {
    listModuleItems: async () => items as any,
    scanFeedbackByItem: async () => feedbackRows,
    scanEnrollments: async () => opts.enrollments ?? formalEnrollments(),
    batchGetEventIds: batchGetEventIds as any,
    transactWrite: transactWrite as any,
    now: () => NOW,
    getSurveyInstance: async (moduleItemId: string, studentUserId: string) =>
      opts.instances?.[`${moduleItemId}/${studentUserId}`] ?? null,
    getStudentItemProgress: async (moduleItemId: string, studentUserId: string) =>
      opts.progress?.[`${moduleItemId}/${studentUserId}`] ?? null,
    tables: {
      feedback: "FeedbackTable",
      surveyInstance: "SurveyInstanceTable",
      studentItemProgress: "ProgressTable",
      eventLog: "EventLogTable",
      moduleItem: "ModuleItemTable",
    },
  };
  return { deps, transactWrite, batchGetEventIds, feedbackRows, markers };
}

function importArgs(overrides: Partial<Parameters<typeof executePhase3Import>[1]> = {}) {
  return {
    moduleId: MODULE_ID,
    courseId: COURSE_ID,
    callerUserId: "fac-1",
    mode: "formal" as const,
    csvText: formalCsv(),
    commit: false,
    ...overrides,
  };
}

/** Materialize the rows a successful import would store. */
function storedRowsFor(csvText: string, kind: string): FeedbackRow[] {
  const records = readTemplate(csvText);
  const byEmail = groupByEmail(records);
  const enrollments = formalEnrollments();
  const resolution = resolveEmailsFromEnrollments([...byEmail.keys()], enrollments);
  const rows: FeedbackRow[] = [];
  for (const [email, recs] of byEmail) {
    const sub = resolution.resolved.get(email)!;
    for (const record of recs) {
      rows.push(
        buildRow(record, {
          partsACItemId: AC_ID,
          studentUserId: sub,
          now: NOW,
          importKind: kind,
          importBatchId: "batch-x",
          importedByUserId: "fac-1",
          sourceCsvSha256: "sha",
          ...(kind === PHASE3_IMPORT_KIND_FORMAL
            ? {
                assignmentVersion: PHASE3_FORMAL_ASSIGNMENT_VERSION,
                randomSeed: PHASE3_FORMAL_RANDOM_SEED,
              }
            : {}),
        }) as FeedbackRow
      );
    }
  }
  return rows;
}

/** Tester rows for an explicit account, independent of the shared roster. */
function testerRowsFor(sub: string, email: string): FeedbackRow[] {
  return readTemplate(testerCsv(email)).map(
    (record) =>
      buildRow(record, {
        partsACItemId: AC_ID,
        studentUserId: sub,
        now: NOW,
        importKind: PHASE3_IMPORT_KIND_TESTER,
        importBatchId: "batch-t",
        importedByUserId: "fac-1",
        sourceCsvSha256: "sha",
      }) as FeedbackRow
  );
}

/** Re-run preview to learn the planHash the server will require on commit. */
async function planHashFor(
  harness: Harness,
  args: Parameters<typeof executePhase3Import>[1]
): Promise<string> {
  const preview = await executePhase3Import(harness.deps, { ...args, commit: false });
  expect(preview.status).toBe(200);
  return (preview.body as any).planHash as string;
}

// ───────────────────────── CSV + validation ─────────────────────────

describe("CSV parsing", () => {
  it("handles commas, escaped quotes, CRLF and embedded newlines", () => {
    const rows = parseCsv(
      `${HEADER}\r\nR1,S1,a@b.edu,A,ai,1,2,3,"First, ""quoted"" line\r\n第二行",Maria,Attempt 1,42\r\n`
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveLength(12);
    expect(rows[1][8]).toBe('First, "quoted" line\r\n第二行');
  });

  it("rejects unterminated quoted fields", () => {
    expect(() => parseCsv(`${HEADER}\nR1,S1,x,A,ai,1,2,3,"broken`)).toThrow(
      /unterminated quoted field/i
    );
  });

  it("rejects stray characters after a closing quote", () => {
    expect(() =>
      parseCsv(`${HEADER}\nR1,S1,x,A,ai,1,2,3,"ok"junk,Maria,a,1\n`)
    ).toThrow(/after a closing quote/i);
  });

  it("requires the exact 12 frozen columns in order", () => {
    expect(() => readTemplate(`${HEADER},extra\nR1,S1,x,A,ai,1,2,3,n,M,a,1,x\n`)).toThrow(
      /exactly the 12 frozen columns/i
    );
    expect(() =>
      readTemplate(
        "study_id,review_id,student_email,display_key,source_internal,d1,d2,d3,narrative,selected_source,session,student_turns\nS1,R1,x,A,ai,1,2,3,n,M,a,1\n"
      )
    ).toThrow(/frozen columns in order/i);
  });

  it("rejects a row with the wrong column count", () => {
    expect(() => readTemplate(`${HEADER}\nR1,S1,x,A,ai,1,2,3,n,M,a\n`)).toThrow(
      /expected exactly 12/i
    );
  });

  it("preserves narrative whitespace exactly", () => {
    const records = readTemplate(
      `${HEADER}\nR1,S1,a@b.edu,A,ai,1,2,3,"  frozen narrative  ",M,a,1\n`
    );
    expect(records[0].narrative).toBe("  frozen narrative  ");
  });
});

describe("record validation", () => {
  it("accepts a well-formed formal cohort", () => {
    expect(validateRecords(readTemplate(formalCsv()), "formal")).toEqual([]);
  });

  it("rejects out-of-range scores instead of coercing them to N/A", () => {
    const errs = validateRecords(
      readTemplate(formalCsv({ d1: "7" })),
      "formal"
    );
    expect(errs.join("\n")).toContain("d1 must be 1, 2, 3, 4 or N/A");
  });

  it("normalizes na / NA to N/A", () => {
    expect(validateRecords(readTemplate(formalCsv({ d3: "na" })), "formal")).toEqual(
      []
    );
  });

  it("rejects the counterbalancing-only frozen file (empty scores and narrative)", () => {
    // This is the shape of ..._COUNTERBALANCING_FROZEN_v1_seed20260825.csv:
    // 17 students, 51 rows, correct six-way allocation, but no ratings and no
    // narratives yet. It must never be importable as the formal cohort.
    const csv = formalCsv({ d1: "", d2: "", d3: "", narrative: "" });
    const records = readTemplate(csv);
    expect(records).toHaveLength(51);
    expect(new Set(records.map((r) => r.student_email)).size).toBe(17);
    const errs = validateRecords(records, "formal");
    expect(errs.some((e) => /narrative is empty/.test(e))).toBe(true);
    expect(errs.some((e) => /d1 must be 1, 2, 3, 4 or N\/A/.test(e))).toBe(true);
  });

  it("rejects the wrong cohort size and row count", () => {
    const short = formalSpecs().slice(0, 48);
    const errs = validateRecords(readTemplate(toCsv(short)), "formal");
    expect(errs.join("\n")).toContain("Expected 17 unique students, found 16");
    expect(errs.join("\n")).toContain("Expected 51 feedback rows, found 48");
  });

  it("rejects a six-way allocation that is off by one", () => {
    const orders = [...FORMAL_ORDERS];
    orders[16] = "F2→AI→F1"; // 3/3/3/3/3/2 instead of 3/3/3/3/2/3
    const specs = orders.flatMap((order, i) => studentSpecs(i, order));
    const errs = validateRecords(readTemplate(toCsv(specs)), "formal");
    expect(errs.join("\n")).toContain(
      "Source-order allocation F2→AI→F1: expected 2, found 3"
    );
    expect(errs.join("\n")).toContain(
      "Source-order allocation F2→F1→AI: expected 3, found 2"
    );
  });

  it("rejects a duplicated display key and a duplicated source", () => {
    const specs = formalSpecs();
    specs[1].displayKey = "A";
    const errs = validateRecords(readTemplate(toCsv(specs)), "formal");
    expect(errs.join("\n")).toMatch(/display_key set must be exactly A,B,C/);
  });

  it("rejects one review_id spanning two students", () => {
    const specs = formalSpecs();
    specs[3].reviewId = specs[0].reviewId;
    const errs = validateRecords(readTemplate(toCsv(specs)), "formal");
    expect(errs.join("\n")).toMatch(/maps to multiple students/);
  });

  it("tester mode requires exactly one student and three rows", () => {
    expect(validateRecords(readTemplate(testerCsv()), "tester")).toEqual([]);
    const two = [
      ...studentSpecs(900, "AI→F1→F2").map((s) => ({ ...s, email: "t1@x.edu" })),
      ...studentSpecs(901, "AI→F1→F2").map((s) => ({ ...s, email: "t2@x.edu" })),
    ];
    const errs = validateRecords(readTemplate(toCsv(two)), "tester");
    expect(errs.join("\n")).toContain(
      "A tester import must contain exactly 1 student — found 2"
    );
    // The message must not read as a cap on how many testers a flow may hold.
    expect(errs.join("\n")).toContain("there is no limit on how many testers");
  });

  it("applies the same per-row strictness to testers as to the formal cohort", () => {
    const errs = validateRecords(
      readTemplate(
        toCsv(
          studentSpecs(900, "AI→F1→F2").map((s) => ({
            ...s,
            email: "t1@x.edu",
            narrative: "",
          }))
        )
      ),
      "tester"
    );
    expect(errs.filter((e) => /narrative is empty/.test(e))).toHaveLength(3);
  });
});

// ───────────────────────── account resolution ─────────────────────────

describe("enrollment-based account resolution", () => {
  it("resolves active enrollments case-insensitively", () => {
    const res = resolveEmailsFromEnrollments(
      ["student001@northeastern.edu"],
      [
        {
          studentUserId: "sub-001",
          studentEmail: "Student001@Northeastern.EDU",
          status: "active",
        },
      ]
    );
    expect(res.ok).toBe(true);
    expect(res.resolved.get("student001@northeastern.edu")).toBe("sub-001");
  });

  it("refuses an email with no active enrollment", () => {
    const res = resolveEmailsFromEnrollments(
      ["nobody@northeastern.edu"],
      formalEnrollments()
    );
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toMatch(/no active enrollment in this course/);
  });

  it("ignores removed enrollments", () => {
    const res = resolveEmailsFromEnrollments(
      ["gone@northeastern.edu"],
      [{ studentUserId: "sub-x", studentEmail: "gone@northeastern.edu", status: "removed" }]
    );
    expect(res.ok).toBe(false);
  });

  it("refuses one email mapping to two accounts", () => {
    const res = resolveEmailsFromEnrollments(
      ["dup@northeastern.edu"],
      [
        { studentUserId: "sub-a", studentEmail: "dup@northeastern.edu", status: "active" },
        { studentUserId: "sub-b", studentEmail: "dup@northeastern.edu", status: "active" },
      ]
    );
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toMatch(/ambiguous/);
  });

  it("refuses two emails collapsing to one account", () => {
    const res = resolveEmailsFromEnrollments(
      ["a@northeastern.edu", "b@northeastern.edu"],
      [
        { studentUserId: "sub-same", studentEmail: "a@northeastern.edu", status: "active" },
        { studentUserId: "sub-same", studentEmail: "b@northeastern.edu", status: "active" },
      ]
    );
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toMatch(/same VOICE account/);
  });

  it("normalizeEmail trims, lowercases and NFC-normalizes", () => {
    expect(normalizeEmail("  A@B.EDU ")).toBe("a@b.edu");
  });
});

// ───────────────────────── row building + preflight ─────────────────────────

describe("row building", () => {
  const record = readTemplate(testerCsv())[0];

  it("hashes identically to the student-facing reader", () => {
    const row = buildRow(record, {
      partsACItemId: AC_ID,
      studentUserId: "sub-1",
      now: NOW,
      importKind: PHASE3_IMPORT_KIND_TESTER,
      importBatchId: "b",
      importedByUserId: "fac-1",
      sourceCsvSha256: "sha",
    });
    expect(row.contentHash).toBe(
      hashCanonicalCardContent("3", "2", "N/A", record.narrative)
    );
    expect(row.contentHash).toBe(
      phase3ContentHash("3", "2", "N/A", record.narrative)
    );
  });

  it("never stamps formal provenance on tester rows", () => {
    const row = buildRow(record, {
      partsACItemId: AC_ID,
      studentUserId: "sub-1",
      now: NOW,
      importKind: PHASE3_IMPORT_KIND_TESTER,
      importBatchId: "b",
      importedByUserId: "fac-1",
      sourceCsvSha256: "sha",
    });
    expect(row._importKind).toBe(PHASE3_IMPORT_KIND_TESTER);
    expect(row._assignmentVersion).toBeUndefined();
    expect(row._randomSeed).toBeUndefined();
  });

  it("rowMatchesExpected ignores extra audit attributes (CLI --verify parity)", () => {
    const expected = buildRow(record, {
      partsACItemId: AC_ID,
      studentUserId: "sub-1",
      now: NOW,
      importKind: PHASE3_IMPORT_KIND_FORMAL,
      importBatchId: "b",
      importedByUserId: "fac-1",
      sourceCsvSha256: "sha",
    });
    const storedByCli = { ...expected };
    delete (storedByCli as any)._importBatchId;
    (storedByCli as any)._somethingNew = "added later";
    expect(rowMatchesExpected(storedByCli as FeedbackRow, expected)).toBe(true);
  });

  it("audit attributes never reach the student card projection", () => {
    const rows = ["A", "B", "C"].map((displayKey, i) =>
      buildRow(
        { ...record, display_key: displayKey, source_internal: ["ai", "faculty_1", "faculty_2"][i] } as any,
        {
          partsACItemId: AC_ID,
          studentUserId: "sub-1",
          now: NOW,
          importKind: PHASE3_IMPORT_KIND_FORMAL,
          importBatchId: "b",
          importedByUserId: "fac-1",
          sourceCsvSha256: "sha",
          assignmentVersion: "v1",
          randomSeed: "20260825",
        }
      )
    ) as any[];
    const cards = buildPhase3Cards(rows, "sub-1");
    expect(cards).not.toBeNull();
    for (const card of cards!) {
      expect(Object.keys(card).sort()).toEqual(
        ["d1", "d2", "d3", "displayKey", "narrative", "sourceType"].sort()
      );
    }
  });
});

describe("preflight classification", () => {
  const csv = testerCsv();
  const expectedRows = storedRowsFor(csv, PHASE3_IMPORT_KIND_TESTER) as any[];

  it("classifies absent / exact / divergent / unexpected", () => {
    expect(classifyExisting(expectedRows, []).absent).toHaveLength(3);
    expect(classifyExisting(expectedRows, expectedRows).exact).toHaveLength(3);

    const changed = expectedRows.map((r, i) =>
      i === 0 ? { ...r, body: "tampered" } : r
    );
    expect(classifyExisting(expectedRows, changed).divergent).toHaveLength(1);

    const extra = [
      ...expectedRows,
      { ...expectedRows[0], feedbackId: "phase3:sub-tester-1:Z", displayKey: "Z" },
    ];
    expect(classifyExisting(expectedRows, extra).unexpected).toEqual([
      "phase3:sub-tester-1:Z",
    ]);
  });

  it("ignores rows belonging to other students", () => {
    const other = { ...expectedRows[0], feedbackId: "phase3:sub-999:A", studentUserId: "sub-999" };
    const result = classifyExisting(expectedRows, [...expectedRows, other as any]);
    expect(result.unexpected).toEqual([]);
    expect(result.exact).toHaveLength(3);
  });
});

describe("plan hash", () => {
  it("is stable for the same plan and changes with content", () => {
    const rows = storedRowsFor(formalCsv(), PHASE3_IMPORT_KIND_FORMAL) as any[];
    const base = {
      mode: "formal" as const,
      partsACItemId: AC_ID,
      rows,
      assignmentVersion: "v1",
      randomSeed: "20260825",
    };
    expect(computePlanHash(base)).toBe(computePlanHash(base));
    const other = storedRowsFor(
      formalCsv({ narrative: "different" }),
      PHASE3_IMPORT_KIND_FORMAL
    ) as any[];
    expect(computePlanHash({ ...base, rows: other })).not.toBe(
      computePlanHash(base)
    );
    expect(computePlanHash({ ...base, randomSeed: "other" })).not.toBe(
      computePlanHash(base)
    );
  });
});

// ───────────────────────── stored-state summary ─────────────────────────

describe("summarizeFeedbackRows", () => {
  it("separates formal, tester and unclassifiable rows", () => {
    const formal = storedRowsFor(formalCsv(), PHASE3_IMPORT_KIND_FORMAL);
    const tester = storedRowsFor(testerCsv(), PHASE3_IMPORT_KIND_TESTER);
    const legacy = { ...formal[0], feedbackId: "phase3:sub-legacy:A", studentUserId: "sub-legacy" };
    delete (legacy as any)._importKind;
    const summary = summarizeFeedbackRows([...formal, ...tester, legacy as any]);
    expect(summary.formalStudentIds).toHaveLength(17);
    expect(summary.formalRowCount).toBe(51);
    expect(summary.testers).toHaveLength(1);
    expect(summary.testers[0].displayKeys).toEqual(["A", "B", "C"]);
    expect(summary.unknownRows).toEqual([
      { feedbackId: "phase3:sub-legacy:A", studentUserId: "sub-legacy" },
    ]);
  });

  it("counts testers dynamically with no upper bound", () => {
    for (const n of [0, 1, 3, 7, 20]) {
      const rows = Array.from({ length: n }, (_, i) =>
        testerRowsFor(`sub-t${i}`, `tester${i}@x.edu`)
      ).flat();
      expect(summarizeFeedbackRows(rows as any).testers).toHaveLength(n);
    }
  });
});

// ───────────────────────── status ─────────────────────────

describe("executePhase3Status", () => {
  it("refuses when the flow is not configured", async () => {
    const harness = makeHarness({ items: [] });
    const out = await executePhase3Status(harness.deps, {
      moduleId: MODULE_ID,
      courseId: COURSE_ID,
    });
    expect(out.status).toBe(409);
    expect((out.body as any).code).toBe("FLOW_NOT_CONFIGURED");
  });

  it("reports the server-derived binding, provenance and dynamic tester list", async () => {
    const tester = storedRowsFor(testerCsv(), PHASE3_IMPORT_KIND_TESTER);
    const harness = makeHarness({ feedbackRows: tester });
    const out = await executePhase3Status(harness.deps, {
      moduleId: MODULE_ID,
      courseId: COURSE_ID,
    });
    expect(out.status).toBe(200);
    const body = out.body as any;
    expect(body.partsACItemId).toBe(AC_ID);
    expect(body.partDItemId).toBe(D_ID);
    expect(body.provenance).toEqual({
      assignmentVersion: "v1",
      randomSeed: "20260825",
    });
    expect(body.testers).toHaveLength(1);
    expect(body.testers[0].studentEmail).toBe("tester1@northeastern.edu");
    expect(body.formalImportUnlocked).toBe(false);
  });

  it("unlocks formal import only when there are no testers and no unknown rows", async () => {
    const empty = makeHarness({ feedbackRows: [] });
    expect(
      ((await executePhase3Status(empty.deps, {
        moduleId: MODULE_ID,
        courseId: COURSE_ID,
      })).body as any).formalImportUnlocked
    ).toBe(true);

    const legacy = storedRowsFor(testerCsv(), PHASE3_IMPORT_KIND_TESTER).map((r) => {
      const copy = { ...r };
      delete (copy as any)._importKind;
      return copy;
    });
    const withUnknown = makeHarness({ feedbackRows: legacy });
    expect(
      ((await executePhase3Status(withUnknown.deps, {
        moduleId: MODULE_ID,
        courseId: COURSE_ID,
      })).body as any).formalImportUnlocked
    ).toBe(false);
  });
});

// ───────────────────────── formal import ─────────────────────────

describe("formal import", () => {
  it("previews without writing anything", async () => {
    const harness = makeHarness();
    const out = await executePhase3Import(harness.deps, importArgs());
    expect(out.status).toBe(200);
    expect((out.body as any).studentCount).toBe(17);
    expect((out.body as any).rowCount).toBe(51);
    expect((out.body as any).committed).toBe(false);
    expect((out.body as any).plan).toHaveLength(17);
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("commits 51 rows plus one audit record in a single transaction", async () => {
    const harness = makeHarness();
    const args = importArgs();
    const planHash = await planHashFor(harness, args);
    const out = await executePhase3Import(harness.deps, {
      ...args,
      commit: true,
      expectedPlanHash: planHash,
      confirmProvenance: { assignmentVersion: "v1", randomSeed: "20260825" },
      confirmFormalPhrase: "IMPORT 17 STUDENTS / 51 ROWS",
    });
    expect(out.status).toBe(200);
    expect((out.body as any).written).toBe(51);
    expect(harness.transactWrite).toHaveBeenCalledTimes(1);

    const [items, token] = harness.transactWrite.mock.calls[0];
    // 51 cards + 1 audit record + 1 flow guard.
    expect(items).toHaveLength(53);
    const guard = items.find((i: any) => i.Update);
    expect(guard.Update.TableName).toBe("ModuleItemTable");
    expect(guard.Update.Key).toEqual({ moduleItemId: AC_ID });
    expect(guard.Update.ConditionExpression).toContain(
      "attribute_not_exists(#formalAt)"
    );
    expect(items.filter((i: any) => i.Put?.TableName === "FeedbackTable")).toHaveLength(51);
    expect(items.filter((i: any) => i.Put?.TableName === "EventLogTable")).toHaveLength(1);
    for (const item of items.filter((i: any) => i.Put?.TableName === "FeedbackTable")) {
      expect(item.Put.ConditionExpression).toBe("attribute_not_exists(feedbackId)");
      expect(item.Put.Item._importKind).toBe(PHASE3_IMPORT_KIND_FORMAL);
      expect(item.Put.Item._assignmentVersion).toBe("v1");
      expect(item.Put.Item._randomSeed).toBe("20260825");
    }
    // No two actions may touch the same item inside one transaction.
    const keys = items.map((i: any) =>
      i.Put
        ? String(i.Put.Item.feedbackId ?? i.Put.Item.eventId)
        : `guard:${i.Update.Key.moduleItemId}`
    );
    expect(new Set(keys).size).toBe(items.length);
    expect(String(token)).toHaveLength(32);

    const audit = items.find((i: any) => i.Put?.TableName === "EventLogTable").Put.Item;
    expect(audit.eventType).toBe("phase3_formal_imported");
    expect(audit.payload.assignmentVersion).toBe("v1");
    expect(JSON.stringify(audit)).not.toMatch(/@northeastern\.edu/);
  });

  it("stays under the DynamoDB transaction item limit", async () => {
    const harness = makeHarness();
    const args = importArgs();
    const planHash = await planHashFor(harness, args);
    await executePhase3Import(harness.deps, {
      ...args,
      commit: true,
      expectedPlanHash: planHash,
      confirmProvenance: { assignmentVersion: "v1", randomSeed: "20260825" },
      confirmFormalPhrase: "IMPORT 17 STUDENTS / 51 ROWS",
    });
    expect(harness.transactWrite.mock.calls[0][0].length).toBeLessThanOrEqual(100);
  });

  it("returns verified with zero writes when every row already matches", async () => {
    const stored = storedRowsFor(formalCsv(), PHASE3_IMPORT_KIND_FORMAL);
    // Rows AND the flow marker both present — the only state that is a pure
    // no-op. Rows-without-marker is a repair case, covered separately.
    const harness = makeHarness({
      feedbackRows: stored,
      flowState: { formalImportedAt: "2026-08-25T09:00:00.000Z" },
    });
    const args = importArgs();
    const planHash = await planHashFor(harness, args);
    const out = await executePhase3Import(harness.deps, {
      ...args,
      commit: true,
      expectedPlanHash: planHash,
      confirmProvenance: { assignmentVersion: "v1", randomSeed: "20260825" },
      confirmFormalPhrase: "IMPORT 17 STUDENTS / 51 ROWS",
    });
    expect(out.status).toBe(200);
    expect((out.body as any).written).toBe(0);
    expect((out.body as any).verified).toBe(true);
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("refuses a mixed absent/exact state and writes nothing", async () => {
    const stored = storedRowsFor(formalCsv(), PHASE3_IMPORT_KIND_FORMAL).slice(0, 9);
    const harness = makeHarness({ feedbackRows: stored });
    const out = await executePhase3Import(harness.deps, importArgs());
    expect(out.status).toBe(409);
    expect((out.body as any).code).toBe("MIXED_STATE");
    expect((out.body as any).error).toMatch(/will not stitch a partial cohort/);
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("ignores acknowledgeResume — there is no website resume path", async () => {
    const stored = storedRowsFor(formalCsv(), PHASE3_IMPORT_KIND_FORMAL).slice(0, 9);
    const harness = makeHarness({ feedbackRows: stored });
    const out = await executePhase3Import(harness.deps, {
      ...importArgs({ commit: true }),
      acknowledgeResume: true,
    } as any);
    expect(out.status).toBe(409);
    expect((out.body as any).code).toBe("MIXED_STATE");
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("refuses divergent rows and writes nothing", async () => {
    const stored = storedRowsFor(formalCsv(), PHASE3_IMPORT_KIND_FORMAL).map((r, i) =>
      i === 0 ? { ...r, body: "tampered" } : r
    );
    const harness = makeHarness({ feedbackRows: stored });
    const out = await executePhase3Import(harness.deps, importArgs());
    expect(out.status).toBe(409);
    expect((out.body as any).code).toBe("DIVERGENT_ROWS");
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("refuses while any tester still holds data", async () => {
    const harness = makeHarness({
      feedbackRows: storedRowsFor(testerCsv(), PHASE3_IMPORT_KIND_TESTER),
    });
    const out = await executePhase3Import(harness.deps, importArgs());
    expect(out.status).toBe(409);
    expect((out.body as any).code).toBe("TESTER_PRESENT");
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("refuses while any row cannot be classified", async () => {
    const legacy = storedRowsFor(formalCsv(), PHASE3_IMPORT_KIND_FORMAL).map((r) => {
      const copy = { ...r };
      delete (copy as any)._importKind;
      return copy;
    });
    const harness = makeHarness({ feedbackRows: legacy });
    const out = await executePhase3Import(harness.deps, importArgs());
    expect(out.status).toBe(409);
    expect((out.body as any).code).toBe("UNKNOWN_ROWS_PRESENT");
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("refuses a plan hash that does not match the re-uploaded csv", async () => {
    const harness = makeHarness();
    const out = await executePhase3Import(harness.deps, {
      ...importArgs({ commit: true }),
      expectedPlanHash: "stale-hash",
      confirmProvenance: { assignmentVersion: "v1", randomSeed: "20260825" },
      confirmFormalPhrase: "IMPORT 17 STUDENTS / 51 ROWS",
    });
    expect(out.status).toBe(409);
    expect((out.body as any).code).toBe("PLAN_HASH_MISMATCH");
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("refuses a provenance confirmation that is not the frozen constant", async () => {
    const harness = makeHarness();
    const args = importArgs();
    const planHash = await planHashFor(harness, args);
    for (const bad of [
      undefined,
      {},
      { assignmentVersion: "v2", randomSeed: "20260825" },
      { assignmentVersion: "v1", randomSeed: "20260826" },
    ]) {
      const out = await executePhase3Import(harness.deps, {
        ...args,
        commit: true,
        expectedPlanHash: planHash,
        confirmFormalPhrase: "IMPORT 17 STUDENTS / 51 ROWS",
        confirmProvenance: bad,
      });
      expect(out.status).toBe(400);
      expect((out.body as any).code).toBe("PROVENANCE_MISMATCH");
    }
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("reports a cancelled transaction as a zero-write conflict", async () => {
    const harness = makeHarness({
      transactImpl: async () => {
        const err = new Error("The transaction was cancelled; nothing was written.");
        (err as any).cancellationReasons = [{ Code: "ConditionalCheckFailed" }];
        throw err;
      },
    });
    const args = importArgs();
    const planHash = await planHashFor(harness, args);
    const out = await executePhase3Import(harness.deps, {
      ...args,
      commit: true,
      expectedPlanHash: planHash,
      confirmProvenance: { assignmentVersion: "v1", randomSeed: "20260825" },
      confirmFormalPhrase: "IMPORT 17 STUDENTS / 51 ROWS",
    });
    expect(out.status).toBe(409);
    expect((out.body as any).code).toBe("TRANSACTION_CANCELLED");
    expect((out.body as any).details.reasons).toEqual([
      { Code: "ConditionalCheckFailed" },
    ]);
  });
});

// ───────────────────────── G5 tester history ─────────────────────────

describe("tester-history gate (G5)", () => {
  it("uses one exact-key BatchGet and never a scan", async () => {
    const harness = makeHarness();
    await executePhase3Import(harness.deps, importArgs());
    expect(harness.batchGetEventIds).toHaveBeenCalledTimes(1);
    const ids = harness.batchGetEventIds.mock.calls[0][0];
    expect(ids).toHaveLength(17);
    for (const id of ids) {
      expect(id).toMatch(new RegExp(`^phase3:tester-history:${AC_ID}:sub-\\d{3}$`));
    }
  });

  it("refuses the cohort when any account was ever a tester in this flow", async () => {
    const harness = makeHarness({
      markers: [phase3TesterHistoryEventId(AC_ID, "sub-005")],
    });
    const out = await executePhase3Import(harness.deps, importArgs());
    expect(out.status).toBe(409);
    expect((out.body as any).code).toBe("TESTER_HISTORY");
    expect((out.body as any).details.studentUserIds).toEqual(["sub-005"]);
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("still refuses after that tester's feedback rows were purged", async () => {
    // No tester rows remain — only the permanent marker.
    const harness = makeHarness({
      feedbackRows: [],
      markers: [phase3TesterHistoryEventId(AC_ID, "sub-003")],
    });
    const out = await executePhase3Import(harness.deps, importArgs());
    expect(out.status).toBe(409);
    expect((out.body as any).code).toBe("TESTER_HISTORY");
  });

  it("re-runs the gate on commit, not just preview", async () => {
    const harness = makeHarness();
    const args = importArgs();
    const planHash = await planHashFor(harness, args);
    harness.markers.add(phase3TesterHistoryEventId(AC_ID, "sub-001"));
    const out = await executePhase3Import(harness.deps, {
      ...args,
      commit: true,
      expectedPlanHash: planHash,
      confirmProvenance: { assignmentVersion: "v1", randomSeed: "20260825" },
      confirmFormalPhrase: "IMPORT 17 STUDENTS / 51 ROWS",
    });
    expect(out.status).toBe(409);
    expect((out.body as any).code).toBe("TESTER_HISTORY");
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("fails closed when the lookup cannot be completed", async () => {
    const harness = makeHarness({
      batchGetImpl: async () => {
        throw new Error("2 tester-history key(s) were still unprocessed after 5 attempts.");
      },
    });
    const out = await executePhase3Import(harness.deps, importArgs());
    expect(out.status).toBe(409);
    expect((out.body as any).code).toBe("TESTER_HISTORY_UNVERIFIED");
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("does not run for tester imports", async () => {
    const harness = makeHarness();
    await executePhase3Import(
      harness.deps,
      importArgs({ mode: "tester", csvText: testerCsv() })
    );
    expect(harness.batchGetEventIds).not.toHaveBeenCalled();
  });
});

// ───────────────────────── tester import ─────────────────────────

describe("tester import", () => {
  const testerArgs = (overrides: Record<string, unknown> = {}) =>
    importArgs({ mode: "tester", csvText: testerCsv(), ...overrides }) as any;

  it("writes three cards, the permanent marker and an audit row in one transaction", async () => {
    const harness = makeHarness();
    const args = testerArgs();
    const planHash = await planHashFor(harness, args);
    const out = await executePhase3Import(harness.deps, {
      ...args,
      commit: true,
      expectedPlanHash: planHash,
      confirmTesterEmail: "tester1@northeastern.edu",
    });
    expect(out.status).toBe(200);
    expect((out.body as any).written).toBe(3);
    expect(harness.transactWrite).toHaveBeenCalledTimes(1);

    const items = harness.transactWrite.mock.calls[0][0];
    // 3 cards + marker + audit + flow guard.
    expect(items).toHaveLength(6);
    const guard = items.find((i: any) => i.Update);
    expect(guard.Update.TableName).toBe("ModuleItemTable");
    expect(guard.Update.UpdateExpression).toBe("SET #gen = :next");
    const events = items
      .filter((i: any) => i.Put?.TableName === "EventLogTable")
      .map((i: any) => i.Put.Item);
    const marker = events.find(
      (e: any) => e.eventType === "phase3_tester_history"
    );
    expect(marker.eventId).toBe(
      phase3TesterHistoryEventId(AC_ID, "sub-tester-1")
    );
    expect(marker.moduleItemId).toBe(AC_ID);
    expect(events.some((e: any) => e.eventType === "phase3_tester_imported")).toBe(
      true
    );
    for (const item of items.filter((i: any) => i.Put?.TableName === "FeedbackTable")) {
      expect(item.Put.Item._importKind).toBe(PHASE3_IMPORT_KIND_TESTER);
      expect(item.Put.Item._assignmentVersion).toBeUndefined();
      expect(item.Put.Item._randomSeed).toBeUndefined();
    }
  });

  it("requires the tester email to match the csv exactly", async () => {
    const harness = makeHarness();
    const args = testerArgs();
    const planHash = await planHashFor(harness, args);
    const out = await executePhase3Import(harness.deps, {
      ...args,
      commit: true,
      expectedPlanHash: planHash,
      confirmTesterEmail: "someone-else@northeastern.edu",
    });
    expect(out.status).toBe(400);
    expect((out.body as any).code).toBe("TESTER_EMAIL_MISMATCH");
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("refuses to relabel a formal participant as a tester", async () => {
    const formal = storedRowsFor(formalCsv(), PHASE3_IMPORT_KIND_FORMAL);
    const harness = makeHarness({ feedbackRows: formal });
    const out = await executePhase3Import(
      harness.deps,
      testerArgs({ csvText: testerCsv("student001@northeastern.edu") })
    );
    expect(out.status).toBe(409);
    expect((out.body as any).code).toBe("FORMAL_PRESENT");
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("refuses a mixed tester state and points at purge", async () => {
    const partial = storedRowsFor(testerCsv(), PHASE3_IMPORT_KIND_TESTER).slice(0, 1);
    const harness = makeHarness({ feedbackRows: partial });
    const out = await executePhase3Import(harness.deps, testerArgs());
    expect(out.status).toBe(409);
    expect((out.body as any).code).toBe("MIXED_STATE");
    expect((out.body as any).error).toMatch(/Purge this tester/);
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("accepts any number of distinct testers — 20 in a row all succeed", async () => {
    let stored: FeedbackRow[] = [];
    const enrollments: EnrollmentRow[] = Array.from({ length: 20 }, (_, i) => ({
      studentUserId: `sub-t${i}`,
      studentEmail: `tester${i}@x.edu`,
      status: "active",
    }));
    for (let i = 0; i < 20; i++) {
      const csvText = testerCsv(`tester${i}@x.edu`);
      const snapshot = stored;
      const transactWrite: Mock = vi.fn(async () => undefined);
      const deps: Phase3ImportDeps = {
        listModuleItems: async () => configuredFlow() as any,
        scanFeedbackByItem: async () => snapshot,
        scanEnrollments: async () => enrollments,
        batchGetEventIds: async () => new Set<string>(),
        transactWrite: transactWrite as any,
        getSurveyInstance: async () => null,
        getStudentItemProgress: async () => null,
        now: () => NOW,
        tables: {
          feedback: "FeedbackTable",
          surveyInstance: "SurveyInstanceTable",
          studentItemProgress: "ProgressTable",
          eventLog: "EventLogTable",
          moduleItem: "ModuleItemTable",
        },
      };
      const preview = await executePhase3Import(deps, {
        moduleId: MODULE_ID,
        courseId: COURSE_ID,
        callerUserId: "fac-1",
        mode: "tester",
        csvText,
        commit: false,
      });
      expect(preview.status, `tester ${i} preview`).toBe(200);
      const out = await executePhase3Import(deps, {
        moduleId: MODULE_ID,
        courseId: COURSE_ID,
        callerUserId: "fac-1",
        mode: "tester",
        csvText,
        commit: true,
        expectedPlanHash: (preview.body as any).planHash,
        confirmTesterEmail: `tester${i}@x.edu`,
      });
      expect(out.status, `tester ${i} commit`).toBe(200);
      expect((out.body as any).written).toBe(3);
      const written = (transactWrite.mock.calls[0][0] as any[])
        .filter((it: any) => it.Put?.TableName === "FeedbackTable")
        .map((it: any) => it.Put.Item as FeedbackRow);
      stored = [...snapshot, ...written];
    }
    // 20 testers held simultaneously; nothing rejected on count.
    expect(summarizeFeedbackRows(stored).testers).toHaveLength(20);
  });
});

// ───────────────────────── purge ─────────────────────────

describe("purge transaction shape", () => {
  it("guards every feedback delete with the four-part condition", () => {
    const items = buildPurgeTransactItems({
      tables: {
        feedback: "FeedbackTable",
        surveyInstance: "SurveyInstanceTable",
        studentItemProgress: "ProgressTable",
        eventLog: "EventLogTable",
        moduleItem: "ModuleItemTable",
      },
      partsACItemId: AC_ID,
      partDItemId: D_ID,
      studentUserId: "sub-t1",
      displayKeys: ["A", "B", "C"],
      auditEvent: { eventId: "e1" },
      guard: { Update: { TableName: "ModuleItemTable" } },
    }) as any[];

    // guard + 3 conditional card deletes + 2 instances + 2 progress + 1 audit.
    expect(items).toHaveLength(9);
    const deletes = items.filter((i) => i.Delete?.TableName === "FeedbackTable");
    expect(deletes).toHaveLength(3);
    for (const d of deletes) {
      expect(d.Delete.ConditionExpression).toBe(
        "#kind = :tester AND #mi = :ac AND #su = :sub AND #dk = :key"
      );
      expect(d.Delete.ExpressionAttributeNames).toEqual({
        "#kind": "_importKind",
        "#mi": "moduleItemId",
        "#su": "studentUserId",
        "#dk": "displayKey",
      });
      expect(d.Delete.ExpressionAttributeValues[":tester"]).toBe("phase3_tester");
      expect(d.Delete.ExpressionAttributeValues[":ac"]).toBe(AC_ID);
      expect(d.Delete.ExpressionAttributeValues[":sub"]).toBe("sub-t1");
    }
    // The tester-history marker is never part of a purge.
    expect(JSON.stringify(items)).not.toContain("tester-history");
  });
});

describe("executePhase3PurgeTester", () => {
  const purgeArgs = (overrides: Record<string, unknown> = {}) => ({
    moduleId: MODULE_ID,
    courseId: COURSE_ID,
    callerUserId: "fac-1",
    scope: "one" as const,
    studentUserId: "sub-tester-1",
    commit: false,
    ...overrides,
  });

  function testerRows() {
    return storedRowsFor(testerCsv(), PHASE3_IMPORT_KIND_TESTER);
  }

  it("previews the exact objects it will delete and what it retains", async () => {
    const harness = makeHarness({ feedbackRows: testerRows() });
    const out = await executePhase3PurgeTester(harness.deps, purgeArgs());
    expect(out.status).toBe(200);
    const body = out.body as any;
    expect(body.plans).toHaveLength(1);
    expect(body.plans[0].feedbackIds).toEqual([
      "phase3:sub-tester-1:A",
      "phase3:sub-tester-1:B",
      "phase3:sub-tester-1:C",
    ]);
    expect(body.plans[0].studentEmail).toBe("tester1@northeastern.edu");
    expect(body.retained).toEqual({
      eventLogBehaviourEvents: true,
      testerHistoryMarker: true,
      courseEnrollment: true,
    });
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("requires the tester email as a second confirmation", async () => {
    const harness = makeHarness({ feedbackRows: testerRows() });
    const bad = await executePhase3PurgeTester(
      harness.deps,
      purgeArgs({ commit: true, confirmText: "wrong@x.edu" })
    );
    expect(bad.status).toBe(400);
    expect(harness.transactWrite).not.toHaveBeenCalled();

    const ok = await executePhase3PurgeTester(
      harness.deps,
      purgeArgs({ commit: true, confirmText: "tester1@northeastern.edu" })
    );
    expect(ok.status).toBe(200);
    expect((ok.body as any).purged).toBe(1);
    expect(harness.transactWrite).toHaveBeenCalledTimes(1);
  });

  it("refuses when the account holds formal rows", async () => {
    const rows = testerRows().map((r) => ({
      ...r,
      _importKind: PHASE3_IMPORT_KIND_FORMAL,
    }));
    const harness = makeHarness({ feedbackRows: rows });
    const out = await executePhase3PurgeTester(
      harness.deps,
      purgeArgs({ studentUserId: "sub-tester-1" })
    );
    // The account is not a tester at all, so it is not a purge target.
    expect(out.status).toBe(404);
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("refuses when a formal row is mixed into a tester account", async () => {
    const rows = testerRows();
    rows[2] = { ...rows[2], _importKind: PHASE3_IMPORT_KIND_FORMAL };
    const harness = makeHarness({ feedbackRows: rows });
    const out = await executePhase3PurgeTester(harness.deps, purgeArgs());
    expect(out.status).toBe(409);
    expect((out.body as any).code).toBe("FORMAL_PRESENT");
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("refuses when any row's type cannot be confirmed", async () => {
    const rows = testerRows();
    delete (rows[1] as any)._importKind;
    const harness = makeHarness({ feedbackRows: rows });
    const out = await executePhase3PurgeTester(harness.deps, purgeArgs());
    expect(out.status).toBe(409);
    expect((out.body as any).code).toBe("UNKNOWN_ROWS_PRESENT");
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("refuses a non-deterministic feedback id", async () => {
    const rows = testerRows();
    rows[0] = { ...rows[0], feedbackId: "hand-written-id" };
    const harness = makeHarness({ feedbackRows: rows });
    const out = await executePhase3PurgeTester(harness.deps, purgeArgs());
    expect(out.status).toBe(409);
    expect((out.body as any).code).toBe("NON_DETERMINISTIC_ROW");
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("returns 404 for an account with no tester data (already purged)", async () => {
    const harness = makeHarness({ feedbackRows: [] });
    const out = await executePhase3PurgeTester(harness.deps, purgeArgs());
    expect(out.status).toBe(404);
    expect((out.body as any).code).toBe("NOT_A_TESTER");
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("ignores a client-supplied Part D item id and uses the discovered one", async () => {
    const harness = makeHarness({ feedbackRows: testerRows() });
    const out = await executePhase3PurgeTester(harness.deps, {
      ...purgeArgs({ commit: true, confirmText: "tester1@northeastern.edu" }),
      partDItemId: "attacker-supplied",
    } as any);
    expect(out.status).toBe(200);
    const items = harness.transactWrite.mock.calls[0][0];
    expect(JSON.stringify(items)).not.toContain("attacker-supplied");
    expect(JSON.stringify(items)).toContain(D_ID);
  });

  it("purge-all runs one atomic transaction per tester and needs the exact phrase", async () => {
    let rows: FeedbackRow[] = [];
    for (let i = 0; i < 5; i++) {
      rows = rows.concat(testerRowsFor(`sub-t${i}`, `tester${i}@x.edu`));
    }
    const enrollments: EnrollmentRow[] = Array.from({ length: 5 }, (_, i) => ({
      studentUserId: `sub-t${i}`,
      studentEmail: `tester${i}@x.edu`,
      status: "active",
    }));
    const harness = makeHarness({ feedbackRows: rows, enrollments });

    const preview = await executePhase3PurgeTester(
      harness.deps,
      purgeArgs({ scope: "all", studentUserId: undefined })
    );
    expect((preview.body as any).confirmPhrase).toBe("PURGE ALL 5 TESTERS");

    const wrong = await executePhase3PurgeTester(
      harness.deps,
      purgeArgs({ scope: "all", studentUserId: undefined, commit: true, confirmText: "PURGE ALL" })
    );
    expect(wrong.status).toBe(400);
    expect(harness.transactWrite).not.toHaveBeenCalled();

    const ok = await executePhase3PurgeTester(
      harness.deps,
      purgeArgs({
        scope: "all",
        studentUserId: undefined,
        commit: true,
        confirmText: "PURGE ALL 5 TESTERS",
      })
    );
    expect(ok.status).toBe(200);
    expect((ok.body as any).purged).toBe(5);
    expect(harness.transactWrite).toHaveBeenCalledTimes(5);
    for (const call of harness.transactWrite.mock.calls) {
      expect(call[0].length).toBeLessThanOrEqual(9);
    }
  });

  it("purge-all reports per-tester failures and keeps completed ones purged", async () => {
    let rows: FeedbackRow[] = [];
    for (let i = 0; i < 3; i++) {
      rows = rows.concat(testerRowsFor(`sub-t${i}`, `tester${i}@x.edu`));
    }
    const enrollments: EnrollmentRow[] = Array.from({ length: 3 }, (_, i) => ({
      studentUserId: `sub-t${i}`,
      studentEmail: `tester${i}@x.edu`,
      status: "active",
    }));
    let call = 0;
    const harness = makeHarness({
      feedbackRows: rows,
      enrollments,
      transactImpl: async () => {
        call++;
        if (call === 2) throw new Error("cancelled");
      },
    });
    const out = await executePhase3PurgeTester(
      harness.deps,
      purgeArgs({
        scope: "all",
        studentUserId: undefined,
        commit: true,
        confirmText: "PURGE ALL 3 TESTERS",
      })
    );
    expect(out.status).toBe(200);
    expect((out.body as any).purged).toBe(2);
    expect((out.body as any).failed).toHaveLength(1);
  });

  it("purge-all with zero testers writes nothing", async () => {
    const harness = makeHarness({ feedbackRows: [] });
    const out = await executePhase3PurgeTester(
      harness.deps,
      purgeArgs({
        scope: "all",
        studentUserId: undefined,
        commit: true,
        confirmText: "PURGE ALL 0 TESTERS",
      })
    );
    expect(out.status).toBe(200);
    expect((out.body as any).purged).toBe(0);
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("audit event records what was retained and carries no email", async () => {
    const harness = makeHarness({ feedbackRows: testerRows() });
    await executePhase3PurgeTester(
      harness.deps,
      purgeArgs({ commit: true, confirmText: "tester1@northeastern.edu" })
    );
    const items = harness.transactWrite.mock.calls[0][0];
    const audit = items.find((i: any) => i.Put?.TableName === "EventLogTable").Put.Item;
    expect(audit.eventType).toBe("phase3_tester_purged");
    expect(audit.payload.eventLogRetained).toBe(true);
    expect(audit.payload.testerHistoryMarkerRetained).toBe(true);
    expect(JSON.stringify(audit)).not.toMatch(/@northeastern\.edu/);
  });
});

// ───────────────────────── misc ─────────────────────────

describe("ids", () => {
  it("batchIdFor is deterministic and short", () => {
    expect(batchIdFor(AC_ID, "abcdef0123456789")).toBe(`${AC_ID}:abcdef012345`);
  });
});

// ═════════════ code-review fixes ═════════════

describe("finding 1 — the formal confirmation phrase is enforced server-side", () => {
  it("rejects a commit that omits the phrase entirely (direct API call)", async () => {
    const harness = makeHarness();
    const args = importArgs();
    const planHash = await planHashFor(harness, args);
    const out = await executePhase3Import(harness.deps, {
      ...args,
      commit: true,
      expectedPlanHash: planHash,
      confirmProvenance: { assignmentVersion: "v1", randomSeed: "20260825" },
      // confirmFormalPhrase deliberately absent — this is what a scripted
      // caller bypassing the UI would send.
    });
    expect(out.status).toBe(400);
    expect((out.body as any).code).toBe("CONFIRM_PHRASE_MISMATCH");
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it.each([
    "",
    "import 17 students / 51 rows",
    "IMPORT 51 STUDENTS / 17 ROWS",
    "IMPORT 14 STUDENTS / 42 ROWS",
    "IMPORT 17 STUDENTS / 51 ROWS!",
    "YES",
  ])("rejects the wrong phrase %j with zero writes", async (phrase) => {
    const harness = makeHarness();
    const args = importArgs();
    const planHash = await planHashFor(harness, args);
    const out = await executePhase3Import(harness.deps, {
      ...args,
      commit: true,
      expectedPlanHash: planHash,
      confirmFormalPhrase: phrase,
      confirmProvenance: { assignmentVersion: "v1", randomSeed: "20260825" },
    });
    expect(out.status).toBe(400);
    expect((out.body as any).code).toBe("CONFIRM_PHRASE_MISMATCH");
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("builds the expected phrase from the cohort constants, not from the request", async () => {
    const harness = makeHarness();
    const preview = await executePhase3Import(harness.deps, importArgs());
    expect((preview.body as any).confirmPhrase).toBe(
      phase3FormalConfirmPhrase()
    );
    expect(phase3FormalConfirmPhrase()).toBe("IMPORT 17 STUDENTS / 51 ROWS");
    // A caller cannot shrink the requirement by sending its own counts.
    const args = importArgs();
    const planHash = await planHashFor(harness, args);
    const out = await executePhase3Import(harness.deps, {
      ...args,
      commit: true,
      expectedPlanHash: planHash,
      confirmFormalPhrase: "IMPORT 1 STUDENTS / 3 ROWS",
      confirmProvenance: { assignmentVersion: "v1", randomSeed: "20260825" },
      expected: { studentCount: 1, rowCount: 3 },
    } as any);
    expect(out.status).toBe(400);
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("accepts the phrase with surrounding whitespace only", async () => {
    const harness = makeHarness();
    const args = importArgs();
    const planHash = await planHashFor(harness, args);
    const out = await executePhase3Import(harness.deps, {
      ...args,
      commit: true,
      expectedPlanHash: planHash,
      confirmFormalPhrase: "  IMPORT 17 STUDENTS / 51 ROWS  ",
      confirmProvenance: { assignmentVersion: "v1", randomSeed: "20260825" },
    });
    expect(out.status).toBe(200);
  });

  it("does not require the phrase for a tester import", async () => {
    const harness = makeHarness();
    const args = importArgs({ mode: "tester", csvText: testerCsv() });
    const planHash = await planHashFor(harness, args);
    const out = await executePhase3Import(harness.deps, {
      ...args,
      commit: true,
      expectedPlanHash: planHash,
      confirmTesterEmail: "tester1@northeastern.edu",
    });
    expect(out.status).toBe(200);
  });
});

describe("finding 3 — exact verification checks import kind and provenance", () => {
  it("treats a formal row stored with the tester kind as divergent, not exact", async () => {
    const stored = storedRowsFor(formalCsv(), PHASE3_IMPORT_KIND_FORMAL).map((r) => ({
      ...r,
      _importKind: PHASE3_IMPORT_KIND_TESTER,
    }));
    const harness = makeHarness({ feedbackRows: stored });
    const out = await executePhase3Import(harness.deps, importArgs());
    // Tester rows present -> the tester gate fires first, which is also correct.
    expect(out.status).toBe(409);
    expect(["TESTER_PRESENT", "DIVERGENT_ROWS"]).toContain((out.body as any).code);
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it.each([
    ["missing assignmentVersion", { _assignmentVersion: undefined }],
    ["wrong assignmentVersion", { _assignmentVersion: "v2" }],
    ["missing randomSeed", { _randomSeed: undefined }],
    ["wrong randomSeed", { _randomSeed: "20260101" }],
    ["missing importKind", { _importKind: undefined }],
  ])("never reports verified when provenance is %s", async (_label, patch) => {
    const stored = storedRowsFor(formalCsv(), PHASE3_IMPORT_KIND_FORMAL).map((r) => {
      const copy: any = { ...r, ...patch };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete copy[k];
      }
      return copy;
    });
    const harness = makeHarness({ feedbackRows: stored });
    const out = await executePhase3Import(harness.deps, importArgs());
    expect(out.status).toBe(409);
    expect((out.body as any).verified).toBeUndefined();
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("still ignores unrelated extra attributes (CLI --verify parity)", async () => {
    const stored = storedRowsFor(formalCsv(), PHASE3_IMPORT_KIND_FORMAL).map((r) => ({
      ...r,
      _somethingAddedLater: "x",
      _importBatchId: "a-different-batch",
      _importedAt: "1999-01-01T00:00:00.000Z",
    }));
    const harness = makeHarness({ feedbackRows: stored });
    const out = await executePhase3Import(harness.deps, importArgs());
    expect(out.status).toBe(200);
    expect((out.body as any).alreadyImported).toBe(true);
  });

  it("rowMatchesExpected compares kind and provenance directly", () => {
    const record = readTemplate(formalCsv())[0];
    const base = {
      partsACItemId: AC_ID,
      studentUserId: "sub-001",
      now: NOW,
      importKind: PHASE3_IMPORT_KIND_FORMAL,
      importBatchId: "b",
      importedByUserId: "fac-1",
      sourceCsvSha256: "sha",
      assignmentVersion: "v1",
      randomSeed: "20260825",
    };
    const expected = buildRow(record, base);
    expect(rowMatchesExpected(expected as FeedbackRow, expected)).toBe(true);
    for (const patch of [
      { _importKind: PHASE3_IMPORT_KIND_TESTER },
      { _assignmentVersion: "v2" },
      { _randomSeed: "nope" },
    ]) {
      expect(
        rowMatchesExpected({ ...expected, ...patch } as FeedbackRow, expected)
      ).toBe(false);
    }
  });

  it("tester cards that are all exact but have no marker back the marker in", async () => {
    const stored = storedRowsFor(testerCsv(), PHASE3_IMPORT_KIND_TESTER);
    const harness = makeHarness({ feedbackRows: stored, markers: [] });
    const args = importArgs({ mode: "tester", csvText: testerCsv() });
    const planHash = await planHashFor(harness, args);
    const out = await executePhase3Import(harness.deps, {
      ...args,
      commit: true,
      expectedPlanHash: planHash,
      confirmTesterEmail: "tester1@northeastern.edu",
    });
    expect(out.status).toBe(200);
    expect((out.body as any).markerBackfilled).toBe(true);
    expect(harness.transactWrite).toHaveBeenCalledTimes(1);
    const items = harness.transactWrite.mock.calls[0][0];
    const marker = items
      .filter((i: any) => i.Put?.TableName === "EventLogTable")
      .map((i: any) => i.Put.Item)
      .find((e: any) => e.eventType === "phase3_tester_history");
    expect(marker.eventId).toBe(
      phase3TesterHistoryEventId(AC_ID, "sub-tester-1")
    );
    // No feedback rows are rewritten.
    expect(items.filter((i: any) => i.Put?.TableName === "FeedbackTable")).toHaveLength(0);
  });

  it("tester cards all exact WITH the marker present is a clean zero-write verify", async () => {
    const stored = storedRowsFor(testerCsv(), PHASE3_IMPORT_KIND_TESTER);
    const harness = makeHarness({
      feedbackRows: stored,
      markers: [phase3TesterHistoryEventId(AC_ID, "sub-tester-1")],
    });
    const args = importArgs({ mode: "tester", csvText: testerCsv() });
    const planHash = await planHashFor(harness, args);
    const out = await executePhase3Import(harness.deps, {
      ...args,
      commit: true,
      expectedPlanHash: planHash,
      confirmTesterEmail: "tester1@northeastern.edu",
    });
    expect(out.status).toBe(200);
    expect((out.body as any).verified).toBe(true);
    expect((out.body as any).markerBackfilled).toBeUndefined();
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("fails closed rather than verifying when the marker cannot be checked", async () => {
    const stored = storedRowsFor(testerCsv(), PHASE3_IMPORT_KIND_TESTER);
    const harness = makeHarness({
      feedbackRows: stored,
      batchGetImpl: async () => {
        throw new Error("unprocessed keys remained");
      },
    });
    const args = importArgs({ mode: "tester", csvText: testerCsv() });
    const planHash = await planHashFor(harness, args);
    const out = await executePhase3Import(harness.deps, {
      ...args,
      commit: true,
      expectedPlanHash: planHash,
      confirmTesterEmail: "tester1@northeastern.edu",
    });
    expect(out.status).toBe(409);
    expect((out.body as any).code).toBe("TESTER_HISTORY_UNVERIFIED");
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });
});

describe("finding 6 — duplicate active enrollment rows fail closed", () => {
  it("rejects two active rows for one email even when they name the SAME account", () => {
    const res = resolveEmailsFromEnrollments(
      ["dup@x.edu"],
      [
        { studentUserId: "sub-same", studentEmail: "dup@x.edu", status: "active" },
        { studentUserId: "sub-same", studentEmail: "dup@x.edu", status: "active" },
      ]
    );
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toMatch(/2 active enrollment rows/);
    expect(res.errors.join("\n")).toMatch(/roster is duplicated/);
  });

  it("rejects two active rows naming different accounts", () => {
    const res = resolveEmailsFromEnrollments(
      ["dup@x.edu"],
      [
        { studentUserId: "sub-a", studentEmail: "dup@x.edu", status: "active" },
        { studentUserId: "sub-b", studentEmail: "dup@x.edu", status: "active" },
      ]
    );
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toMatch(/2 different accounts/);
  });

  it("counts rows after email normalization, so case variants still collide", () => {
    const res = resolveEmailsFromEnrollments(
      ["dup@x.edu"],
      [
        { studentUserId: "sub-same", studentEmail: "Dup@X.edu", status: "active" },
        { studentUserId: "sub-same", studentEmail: " dup@x.edu ", status: "active" },
      ]
    );
    expect(res.ok).toBe(false);
  });

  it("ignores removed duplicates and accepts the single active row", () => {
    const res = resolveEmailsFromEnrollments(
      ["dup@x.edu"],
      [
        { studentUserId: "sub-old", studentEmail: "dup@x.edu", status: "removed" },
        { studentUserId: "sub-new", studentEmail: "dup@x.edu", status: "active" },
      ]
    );
    expect(res.ok).toBe(true);
    expect(res.resolved.get("dup@x.edu")).toBe("sub-new");
  });

  it("still rejects two different emails resolving to one account", () => {
    const res = resolveEmailsFromEnrollments(
      ["a@x.edu", "b@x.edu"],
      [
        { studentUserId: "sub-same", studentEmail: "a@x.edu", status: "active" },
        { studentUserId: "sub-same", studentEmail: "b@x.edu", status: "active" },
      ]
    );
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toMatch(/same VOICE account/);
  });

  it("a duplicated roster row blocks the whole formal import", async () => {
    const enrollments = formalEnrollments();
    enrollments.push({
      studentUserId: "sub-001",
      studentEmail: "student001@northeastern.edu",
      status: "active",
    });
    const harness = makeHarness({ enrollments });
    const out = await executePhase3Import(harness.deps, importArgs());
    expect(out.status).toBe(400);
    expect((out.body as any).code).toBe("ACCOUNT_RESOLUTION_FAILED");
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });
});

describe("finding 4 — flow-level mutual exclusion", () => {
  /**
   * A DynamoDB stand-in that enforces what TransactWriteItems actually
   * enforces: the whole list applies or none of it does, and two transactions
   * touching the same item cannot both succeed.
   */
  function makeFlowStore(initial: Record<string, unknown> = {}) {
    const acItem: Record<string, unknown> = { moduleItemId: AC_ID, ...initial };
    const written: unknown[][] = [];
    const apply = async (items: any[]) => {
      // ── condition phase ──
      for (const it of items) {
        if (!it.Update) continue;
        const names = it.Update.ExpressionAttributeNames ?? {};
        const values = it.Update.ExpressionAttributeValues ?? {};
        const cond: string = it.Update.ConditionExpression ?? "";
        for (const clause of cond.split(" AND ")) {
          const notExists = clause.match(/^attribute_not_exists\((#\w+)\)$/);
          if (notExists) {
            if (acItem[names[notExists[1]]] !== undefined) {
              throw Object.assign(new Error("ConditionalCheckFailed"), {
                cancellationReasons: [{ Code: "ConditionalCheckFailed" }],
              });
            }
            continue;
          }
          const eq = clause.match(/^(#\w+) = (:\w+)$/);
          if (eq) {
            if (acItem[names[eq[1]]] !== values[eq[2]]) {
              throw Object.assign(new Error("ConditionalCheckFailed"), {
                cancellationReasons: [{ Code: "ConditionalCheckFailed" }],
              });
            }
            continue;
          }
          throw new Error(`unhandled condition clause: ${clause}`);
        }
      }
      // ── apply phase ──
      for (const it of items) {
        if (!it.Update) continue;
        const names = it.Update.ExpressionAttributeNames ?? {};
        const values = it.Update.ExpressionAttributeValues ?? {};
        const sets = String(it.Update.UpdateExpression).replace(/^SET /, "");
        for (const assign of sets.split(", ")) {
          const [lhs, rhs] = assign.split(" = ");
          acItem[names[lhs.trim()]] = values[rhs.trim()];
        }
      }
      written.push(items);
    };
    return { acItem, written, apply };
  }

  function flowItems(state: Record<string, unknown>) {
    return configuredFlow().map((it: any) =>
      it.moduleItemId === AC_ID ? { ...it, ...state } : it
    );
  }

  it("a tester import bumps the generation and a formal commit stamps the marker", async () => {
    const store = makeFlowStore();
    const harness = makeHarness({ transactImpl: store.apply as any });
    const args = importArgs({ mode: "tester", csvText: testerCsv() });
    const planHash = await planHashFor(harness, args);
    await executePhase3Import(harness.deps, {
      ...args,
      commit: true,
      expectedPlanHash: planHash,
      confirmTesterEmail: "tester1@northeastern.edu",
    });
    expect(store.acItem._phase3TesterGeneration).toBe(1);
  });

  it("two concurrent formal commits: exactly one wins, the loser writes nothing", async () => {
    const store = makeFlowStore();
    const a = makeHarness({ transactImpl: store.apply as any });
    const b = makeHarness({ transactImpl: store.apply as any });
    const args = importArgs();
    const planHash = await planHashFor(a, args);
    const commit = (h: Harness) =>
      executePhase3Import(h.deps, {
        ...args,
        commit: true,
        expectedPlanHash: planHash,
        confirmFormalPhrase: "IMPORT 17 STUDENTS / 51 ROWS",
        confirmProvenance: { assignmentVersion: "v1", randomSeed: "20260825" },
      });
    const [r1, r2] = await Promise.all([commit(a), commit(b)]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    expect((loser.body as any).code).toBe("TRANSACTION_CANCELLED");
    // The formal marker was stamped exactly once.
    expect(store.written).toHaveLength(1);
    expect(store.acItem._phase3FormalImportedAt).toBe(NOW);
  });

  it("formal vs tester racing on the same flow: at most one direction succeeds", async () => {
    const store = makeFlowStore();
    const formalHarness = makeHarness({ transactImpl: store.apply as any });
    const testerHarness = makeHarness({ transactImpl: store.apply as any });

    const formalArgs = importArgs();
    const testerArgs = importArgs({ mode: "tester", csvText: testerCsv() });
    const formalHash = await planHashFor(formalHarness, formalArgs);
    const testerHash = await planHashFor(testerHarness, testerArgs);

    const [formal, tester] = await Promise.all([
      executePhase3Import(formalHarness.deps, {
        ...formalArgs,
        commit: true,
        expectedPlanHash: formalHash,
        confirmFormalPhrase: "IMPORT 17 STUDENTS / 51 ROWS",
        confirmProvenance: { assignmentVersion: "v1", randomSeed: "20260825" },
      }),
      executePhase3Import(testerHarness.deps, {
        ...testerArgs,
        commit: true,
        expectedPlanHash: testerHash,
        confirmTesterEmail: "tester1@northeastern.edu",
      }),
    ]);
    const okCount = [formal.status, tester.status].filter((s) => s === 200).length;
    expect(okCount).toBe(1);
    // Never both: a mixed flow (formal cohort plus live tester data) is exactly
    // the state this guard exists to make impossible.
    expect(store.written).toHaveLength(1);
    const formalDone = store.acItem._phase3FormalImportedAt !== undefined;
    const testerDone = store.acItem._phase3TesterGeneration !== undefined;
    expect(formalDone !== testerDone).toBe(true);
  });

  it("a tester import that starts on a stale generation is cancelled", async () => {
    // Someone else imported a tester after this request read the flow state.
    const store = makeFlowStore({ _phase3TesterGeneration: 4 });
    const harness = makeHarness({
      transactImpl: store.apply as any,
      flowState: { testerGeneration: 3 }, // stale
    });
    const args = importArgs({ mode: "tester", csvText: testerCsv() });
    const planHash = await planHashFor(harness, args);
    const out = await executePhase3Import(harness.deps, {
      ...args,
      commit: true,
      expectedPlanHash: planHash,
      confirmTesterEmail: "tester1@northeastern.edu",
    });
    expect(out.status).toBe(409);
    expect((out.body as any).code).toBe("TRANSACTION_CANCELLED");
    expect(store.written).toHaveLength(0);
    expect(store.acItem._phase3TesterGeneration).toBe(4);
  });

  it("a formal commit that starts on a stale generation is cancelled", async () => {
    const store = makeFlowStore({ _phase3TesterGeneration: 9 });
    const harness = makeHarness({
      transactImpl: store.apply as any,
      flowState: { testerGeneration: 8 },
    });
    const args = importArgs();
    const planHash = await planHashFor(harness, args);
    const out = await executePhase3Import(harness.deps, {
      ...args,
      commit: true,
      expectedPlanHash: planHash,
      confirmFormalPhrase: "IMPORT 17 STUDENTS / 51 ROWS",
      confirmProvenance: { assignmentVersion: "v1", randomSeed: "20260825" },
    });
    expect(out.status).toBe(409);
    expect(store.acItem._phase3FormalImportedAt).toBeUndefined();
  });

  it("refuses new tester data once the formal cohort has landed", async () => {
    const harness = makeHarness({
      items: flowItems({ _phase3FormalImportedAt: "2026-08-25T09:00:00.000Z" }),
    });
    const out = await executePhase3Import(
      harness.deps,
      importArgs({ mode: "tester", csvText: testerCsv() })
    );
    expect(out.status).toBe(409);
    expect((out.body as any).code).toBe("FORMAL_ALREADY_IMPORTED");
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("the guard condition itself refuses a tester import after formal", () => {
    const guard = buildFlowGuardUpdate({
      moduleItemTable: "ModuleItemTable",
      partsACItemId: AC_ID,
      observedGeneration: 2,
      kind: "tester-import",
      now: NOW,
    }) as any;
    expect(guard.Update.ConditionExpression).toBe(
      "attribute_not_exists(#formalAt) AND #gen = :expectedGen"
    );
    expect(guard.Update.ExpressionAttributeValues[":next"]).toBe(3);
  });

  it("generation conditions distinguish 'never written' from 'equal to zero'", () => {
    const unset = buildFlowGuardUpdate({
      moduleItemTable: "T",
      partsACItemId: AC_ID,
      observedGeneration: null,
      kind: "purge",
      now: NOW,
    }) as any;
    expect(unset.Update.ConditionExpression).toBe("attribute_not_exists(#gen)");
    expect(unset.Update.ExpressionAttributeNames).toEqual({
      "#gen": "_phase3TesterGeneration",
    });
    expect(unset.Update.ExpressionAttributeValues[":next"]).toBe(1);

    const zero = buildFlowGuardUpdate({
      moduleItemTable: "T",
      partsACItemId: AC_ID,
      observedGeneration: 0,
      kind: "purge",
      now: NOW,
    }) as any;
    expect(zero.Update.ConditionExpression).toBe("#gen = :expectedGen");
    expect(zero.Update.ExpressionAttributeNames).toEqual({
      "#gen": "_phase3TesterGeneration",
    });
    expect(zero.Update.ExpressionAttributeValues[":expectedGen"]).toBe(0);
  });

  it("is drift-free: a retried transaction cannot double-count", async () => {
    // Same observed generation => same :next value, and the second attempt's
    // condition no longer holds. There is no ADD anywhere.
    const store = makeFlowStore();
    const harness = makeHarness({ transactImpl: store.apply as any });
    const args = importArgs({ mode: "tester", csvText: testerCsv() });
    const planHash = await planHashFor(harness, args);
    const commit = () =>
      executePhase3Import(harness.deps, {
        ...args,
        commit: true,
        expectedPlanHash: planHash,
        confirmTesterEmail: "tester1@northeastern.edu",
      });
    await commit();
    expect(store.acItem._phase3TesterGeneration).toBe(1);
    await commit(); // a retry of the same request
    expect(store.acItem._phase3TesterGeneration).toBe(1);
  });

  it("purge walks the generation forward one transaction at a time", async () => {
    let rows: FeedbackRow[] = [];
    for (let i = 0; i < 3; i++) {
      rows = rows.concat(testerRowsFor(`sub-t${i}`, `tester${i}@x.edu`));
    }
    const enrollments: EnrollmentRow[] = Array.from({ length: 3 }, (_, i) => ({
      studentUserId: `sub-t${i}`,
      studentEmail: `tester${i}@x.edu`,
      status: "active",
    }));
    const store = makeFlowStore({ _phase3TesterGeneration: 3 });
    const harness = makeHarness({
      feedbackRows: rows,
      enrollments,
      flowState: { testerGeneration: 3 },
      transactImpl: store.apply as any,
    });
    const out = await executePhase3PurgeTester(harness.deps, {
      moduleId: MODULE_ID,
      courseId: COURSE_ID,
      callerUserId: "fac-1",
      scope: "all",
      commit: true,
      confirmText: "PURGE ALL 3 TESTERS",
    });
    expect(out.status).toBe(200);
    expect((out.body as any).purged).toBe(3);
    expect(store.acItem._phase3TesterGeneration).toBe(6);
  });
});

describe("finding 5 — purge preview reports real existence, never a guess", () => {
  const purgeArgs = (o: Record<string, unknown> = {}) => ({
    moduleId: MODULE_ID,
    courseId: COURSE_ID,
    callerUserId: "fac-1",
    scope: "one" as const,
    studentUserId: "sub-tester-1",
    commit: false,
    ...o,
  });

  it("reports present/absent from exact key reads", async () => {
    const harness = makeHarness({
      feedbackRows: storedRowsFor(testerCsv(), PHASE3_IMPORT_KIND_TESTER),
      instances: { [`${AC_ID}/sub-tester-1`]: { moduleItemId: AC_ID } },
      progress: { [`${D_ID}/sub-tester-1`]: { moduleItemId: D_ID } },
    });
    const out = await executePhase3PurgeTester(harness.deps, purgeArgs());
    expect(out.status).toBe(200);
    const plan = (out.body as any).plans[0];
    expect(plan.surveyInstances).toEqual([
      { moduleItemId: AC_ID, targeted: true, existence: "present" },
      { moduleItemId: D_ID, targeted: true, existence: "absent" },
    ]);
    expect(plan.itemProgress).toEqual([
      { moduleItemId: AC_ID, targeted: true, existence: "absent" },
      { moduleItemId: D_ID, targeted: true, existence: "present" },
    ]);
  });

  it("says unknown rather than inventing a value when a read fails", async () => {
    const harness = makeHarness({
      feedbackRows: storedRowsFor(testerCsv(), PHASE3_IMPORT_KIND_TESTER),
    });
    harness.deps.getSurveyInstance = async () => {
      throw new Error("throttled");
    };
    const out = await executePhase3PurgeTester(harness.deps, purgeArgs());
    const plan = (out.body as any).plans[0];
    for (const ref of plan.surveyInstances) {
      expect(ref.existence).toBe("unknown");
      expect(ref.targeted).toBe(true);
    }
  });

  it("never reports exists:true for a row it has not read", async () => {
    const harness = makeHarness({
      feedbackRows: storedRowsFor(testerCsv(), PHASE3_IMPORT_KIND_TESTER),
    });
    const out = await executePhase3PurgeTester(harness.deps, purgeArgs());
    const plan = (out.body as any).plans[0];
    const all = [...plan.surveyInstances, ...plan.itemProgress];
    expect(all.every((r: any) => !("exists" in r))).toBe(true);
    expect(all.every((r: any) => r.existence === "absent")).toBe(true);
  });

  it("a preview writes nothing at all", async () => {
    const harness = makeHarness({
      feedbackRows: storedRowsFor(testerCsv(), PHASE3_IMPORT_KIND_TESTER),
    });
    await executePhase3PurgeTester(harness.deps, purgeArgs());
    await executePhase3PurgeTester(
      harness.deps,
      purgeArgs({ scope: "all", studentUserId: undefined })
    );
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("recomputes the plan on commit instead of trusting the previewed one", async () => {
    const rows = storedRowsFor(testerCsv(), PHASE3_IMPORT_KIND_TESTER);
    const harness = makeHarness({ feedbackRows: rows });
    const preview = await executePhase3PurgeTester(harness.deps, purgeArgs());
    expect((preview.body as any).plans).toHaveLength(1);

    // The tester is purged by someone else between the two calls.
    harness.deps.scanFeedbackByItem = async () => [];
    const commit = await executePhase3PurgeTester(
      harness.deps,
      purgeArgs({ commit: true, confirmText: "tester1@northeastern.edu" })
    );
    expect(commit.status).toBe(404);
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });
});

describe("blocker 3 — formal rows and the flow marker must agree", () => {
  function formalStored() {
    return storedRowsFor(formalCsv(), PHASE3_IMPORT_KIND_FORMAL);
  }
  const commitArgs = (planHash: string) => ({
    ...importArgs(),
    commit: true,
    expectedPlanHash: planHash,
    confirmFormalPhrase: "IMPORT 17 STUDENTS / 51 ROWS",
    confirmProvenance: { assignmentVersion: "v1", randomSeed: "20260825" },
  });

  it("allExact WITH the marker is a clean zero-write verify", async () => {
    const harness = makeHarness({
      feedbackRows: formalStored(),
      flowState: { formalImportedAt: "2026-08-25T09:00:00.000Z" },
    });
    const planHash = await planHashFor(harness, importArgs());
    const out = await executePhase3Import(harness.deps, commitArgs(planHash));
    expect(out.status).toBe(200);
    expect((out.body as any).verified).toBe(true);
    expect((out.body as any).written).toBe(0);
    expect((out.body as any).formalMarkerBackfilled).toBeUndefined();
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("allExact WITHOUT the marker backfills it atomically, rewriting no cards", async () => {
    const harness = makeHarness({ feedbackRows: formalStored() });
    const planHash = await planHashFor(harness, importArgs());
    const out = await executePhase3Import(harness.deps, commitArgs(planHash));
    expect(out.status).toBe(200);
    expect((out.body as any).written).toBe(0);
    expect((out.body as any).verified).toBe(true);
    expect((out.body as any).formalMarkerBackfilled).toBe(true);

    expect(harness.transactWrite).toHaveBeenCalledTimes(1);
    const items = harness.transactWrite.mock.calls[0][0];
    // Guard + one audit event. The 51 cards are NOT rewritten.
    expect(items).toHaveLength(2);
    expect(items.filter((i: any) => i.Put?.TableName === "FeedbackTable")).toHaveLength(0);
    const guard = items.find((i: any) => i.Update);
    expect(guard.Update.UpdateExpression).toBe(
      "SET #formalAt = :now, #formalBatch = :batch"
    );
    expect(guard.Update.ConditionExpression).toContain(
      "attribute_not_exists(#formalAt)"
    );
    const audit = items.find((i: any) => i.Put)?.Put.Item;
    expect(audit.eventType).toBe("phase3_formal_imported");
    expect(audit.payload.formalMarkerBackfilled).toBe(true);
  });

  it("marker backfill returns 409 and changes nothing if the guard fails", async () => {
    const harness = makeHarness({
      feedbackRows: formalStored(),
      transactImpl: async () => {
        throw Object.assign(new Error("cancelled"), {
          cancellationReasons: [{ Code: "ConditionalCheckFailed" }],
        });
      },
    });
    const planHash = await planHashFor(harness, importArgs());
    const out = await executePhase3Import(harness.deps, commitArgs(planHash));
    expect(out.status).toBe(409);
    expect((out.body as any).code).toBe("TRANSACTION_CANCELLED");
  });

  it("refuses to stamp the marker while a tester still holds data", async () => {
    const harness = makeHarness({
      feedbackRows: [
        ...formalStored(),
        ...testerRowsFor("sub-t0", "tester0@x.edu"),
      ],
    });
    const out = await executePhase3Import(harness.deps, importArgs());
    // The tester gate fires first and nothing is written either way.
    expect(out.status).toBe(409);
    expect(["TESTER_PRESENT", "FORMAL_FLOW_STATE_INCONSISTENT"]).toContain(
      (out.body as any).code
    );
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("marker present but rows incomplete is FORMAL_FLOW_STATE_INCONSISTENT", async () => {
    const harness = makeHarness({
      feedbackRows: formalStored().slice(0, 30),
      flowState: { formalImportedAt: "2026-08-25T09:00:00.000Z" },
    });
    const out = await executePhase3Import(harness.deps, importArgs());
    expect(out.status).toBe(409);
    expect((out.body as any).code).toBe("FORMAL_FLOW_STATE_INCONSISTENT");
    expect((out.body as any).details.exact).toBe(30);
    expect((out.body as any).details.absent).toBe(21);
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });

  it("marker present with zero rows also refuses rather than re-importing", async () => {
    const harness = makeHarness({
      feedbackRows: [],
      flowState: { formalImportedAt: "2026-08-25T09:00:00.000Z" },
    });
    const out = await executePhase3Import(harness.deps, importArgs());
    expect(out.status).toBe(409);
    expect((out.body as any).code).toBe("FORMAL_FLOW_STATE_INCONSISTENT");
    expect(harness.transactWrite).not.toHaveBeenCalled();
  });
});

describe("blocker 3 — status reports completeness and inconsistency honestly", () => {
  const statusArgs = { moduleId: MODULE_ID, courseId: COURSE_ID };

  it("complete requires 17 students, 51 rows AND the flow marker", async () => {
    const harness = makeHarness({
      feedbackRows: storedRowsFor(formalCsv(), PHASE3_IMPORT_KIND_FORMAL),
      flowState: { formalImportedAt: "2026-08-25T09:00:00.000Z" },
    });
    const body = (await executePhase3Status(harness.deps, statusArgs)).body as any;
    expect(body.formal.studentCount).toBe(17);
    expect(body.formal.rowCount).toBe(51);
    expect(body.formal.importedAt).toBe("2026-08-25T09:00:00.000Z");
    expect(body.formal.complete).toBe(true);
    expect(body.formal.inconsistent).toBe(false);
  });

  it("51 rows with no marker is NOT complete and is flagged inconsistent", async () => {
    const harness = makeHarness({
      feedbackRows: storedRowsFor(formalCsv(), PHASE3_IMPORT_KIND_FORMAL),
    });
    const body = (await executePhase3Status(harness.deps, statusArgs)).body as any;
    expect(body.formal.rowCount).toBe(51);
    expect(body.formal.complete).toBe(false);
    expect(body.formal.inconsistent).toBe(true);
    expect(body.formal.inconsistencyReason).toMatch(/not marked as imported/);
    // Repairable by re-running the import, so the panel stays usable.
    expect(body.formalImportUnlocked).toBe(true);
  });

  it("marker with incomplete rows is inconsistent AND locks the importer", async () => {
    const harness = makeHarness({
      feedbackRows: storedRowsFor(formalCsv(), PHASE3_IMPORT_KIND_FORMAL).slice(0, 30),
      flowState: { formalImportedAt: "2026-08-25T09:00:00.000Z" },
    });
    const body = (await executePhase3Status(harness.deps, statusArgs)).body as any;
    expect(body.formal.complete).toBe(false);
    expect(body.formal.inconsistent).toBe(true);
    expect(body.formal.inconsistencyReason).toMatch(/only 10\/17 students/);
    expect(body.formalImportUnlocked).toBe(false);
  });

  it("a partial cohort with no marker is flagged, not rounded off", async () => {
    const harness = makeHarness({
      feedbackRows: storedRowsFor(formalCsv(), PHASE3_IMPORT_KIND_FORMAL).slice(0, 9),
    });
    const body = (await executePhase3Status(harness.deps, statusArgs)).body as any;
    expect(body.formal.complete).toBe(false);
    expect(body.formal.inconsistent).toBe(true);
    expect(body.formal.inconsistencyReason).toMatch(/Partial cohorts are never completed/);
  });

  it("an empty flow is neither complete nor inconsistent", async () => {
    const harness = makeHarness({ feedbackRows: [] });
    const body = (await executePhase3Status(harness.deps, statusArgs)).body as any;
    expect(body.formal.complete).toBe(false);
    expect(body.formal.inconsistent).toBe(false);
    expect(body.formal.inconsistencyReason).toBeNull();
  });
});
