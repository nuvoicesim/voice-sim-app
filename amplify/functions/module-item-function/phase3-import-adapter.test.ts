/* eslint-disable @typescript-eslint/no-explicit-any -- inspects raw AWS SDK command inputs */
/**
 * Adapter-level guard: every DynamoDB read that feeds a Phase 3 safety decision
 * must be strongly consistent.
 *
 * These tests drive the REAL handler through the REAL storage adapter and read
 * the command objects it hands to the SDK. The pure-logic suite injects a fake
 * `Phase3ImportDeps`, so it cannot see `ConsistentRead` at all — a regression
 * that silently dropped the flag would leave that suite entirely green.
 *
 * Why the flag matters: the tester/formal mutex is optimistic concurrency over
 * one ModuleItem row. It assumes that if a tester import or purge has committed,
 * either the feedback scan sees it OR the generation moved. An eventually
 * consistent read breaks the first half — a replica can serve the newest
 * generation while still omitting a committed tester row — and the guard would
 * then be satisfied by a scan blind to the thing it exists to detect.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEvent, Context } from "aws-lambda";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  getItem: vi.fn(),
  putItem: vi.fn(),
  transactWriteItems: vi.fn(),
}));

vi.mock("../shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../shared")>();
  return {
    ...actual,
    createDynamoDbClient: () => ({ send: mocks.send }),
    // getItem is exercised through the real implementation elsewhere; here we
    // capture the options the adapter passes so the consistentRead intent is
    // asserted at the call site.
    getItem: mocks.getItem,
    putItem: mocks.putItem,
    transactWriteItems: mocks.transactWriteItems,
    resolveModuleCourseId: vi.fn(async () => ({
      courseId: "course-1",
      mod: { moduleId: "mod-1", courseId: "course-1" },
    })),
    requireCourseInstructor: vi.fn(async () => null),
    requireCourseAccess: vi.fn(async () => null),
  };
});

vi.mock("../shared/auth-middleware", () => ({
  extractCallerIdentity: vi.fn(async () => ({ role: "faculty", userId: "fac-1" })),
  requireRole: vi.fn(() => null),
}));

process.env.MODULE_ITEM_TABLE_NAME = "ModuleItemTable";
process.env.REVIEWER_FEEDBACK_TABLE_NAME = "ReviewerFeedbackTable";
process.env.COURSE_ENROLLMENT_TABLE_NAME = "CourseEnrollmentTable";
process.env.SURVEY_INSTANCE_TABLE_NAME = "SurveyInstanceTable";
process.env.STUDENT_ITEM_PROGRESS_TABLE_NAME = "ProgressTable";
process.env.EVENT_LOG_TABLE_NAME = "EventLogTable";
process.env.SURVEY_TEMPLATE_TABLE_NAME = "SurveyTemplateTable";

const { handler } = await import("./handler");

const AC_ID = "p3ac-mod-1";
const D_ID = "p3d-mod-1";

function configuredFlowRows() {
  return [
    {
      moduleItemId: AC_ID,
      moduleId: "mod-1",
      courseId: "course-1",
      itemType: "survey",
      title: "Parts A–C",
      position: 0,
      payload: {
        phase3Flow: "parts_ac",
        feedbackCardsFromItemId: AC_ID,
        cardSections: [
          { displayKey: "A", firstQuestionNumber: 1 },
          { displayKey: "B", firstQuestionNumber: 7 },
          { displayKey: "C", firstQuestionNumber: 13 },
        ],
      },
    },
    {
      moduleItemId: D_ID,
      moduleId: "mod-1",
      courseId: "course-1",
      itemType: "survey",
      title: "Part D",
      position: 1,
      payload: {
        phase3Flow: "part_d",
        feedbackCardsFromItemId: AC_ID,
        requireFeedbackReveal: true,
      },
    },
  ];
}

/** Route every Scan/BatchGet by table so the handler can complete a request. */
function routeSend(overrides: Record<string, unknown[]> = {}) {
  return async (command: any) => {
    const name = command.constructor.name;
    const input = command.input;
    if (name === "ScanCommand") {
      const table = input.TableName;
      if (table === "ModuleItemTable") {
        return { Items: overrides.moduleItems ?? configuredFlowRows() };
      }
      if (table === "ReviewerFeedbackTable") return { Items: overrides.feedback ?? [] };
      if (table === "CourseEnrollmentTable") return { Items: overrides.enrollments ?? [] };
      return { Items: [] };
    }
    if (name === "BatchGetCommand") {
      return { Responses: { EventLogTable: [] }, UnprocessedKeys: {} };
    }
    return {};
  };
}

function event(operation: string, body: unknown): APIGatewayProxyEvent {
  return {
    httpMethod: "POST",
    resource: "/modules/{moduleId}/items",
    pathParameters: { moduleId: "mod-1" },
    queryStringParameters: { operation },
    body: JSON.stringify(body),
    headers: {},
    requestContext: { authorizer: { claims: { sub: "fac-1", "custom:role": "faculty" } } },
  } as unknown as APIGatewayProxyEvent;
}

async function invoke(operation: string, body: unknown) {
  return (await handler(event(operation, body), {} as Context, () => {})) as any;
}

function commandsOfType(type: string) {
  return mocks.send.mock.calls
    .map((c) => c[0])
    .filter((c: any) => c?.constructor?.name === type);
}

function scansOf(tableName: string) {
  return commandsOfType("ScanCommand").filter(
    (c: any) => c.input.TableName === tableName
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.send.mockImplementation(routeSend());
  mocks.getItem.mockResolvedValue(null);
});

describe("Phase 3 adapter issues strongly consistent reads", () => {
  it("scans ModuleItem, ReviewerFeedback and CourseEnrollment with ConsistentRead", async () => {
    const res = await invoke("phase3-status", {});
    expect(res.statusCode).toBe(200);

    for (const table of [
      "ModuleItemTable",
      "ReviewerFeedbackTable",
      "CourseEnrollmentTable",
    ]) {
      const scans = scansOf(table);
      expect(scans.length, `${table} was scanned`).toBeGreaterThan(0);
      for (const scan of scans) {
        expect(scan.input.ConsistentRead, `${table} ConsistentRead`).toBe(true);
      }
    }
  });

  it("keeps ConsistentRead on every page of a paginated scan", async () => {
    let feedbackPage = 0;
    mocks.send.mockImplementation(async (command: any) => {
      if (
        command.constructor.name === "ScanCommand" &&
        command.input.TableName === "ReviewerFeedbackTable"
      ) {
        feedbackPage++;
        return feedbackPage === 1
          ? { Items: [], LastEvaluatedKey: { feedbackId: "cursor" } }
          : { Items: [] };
      }
      return routeSend()(command);
    });

    await invoke("phase3-status", {});
    const scans = scansOf("ReviewerFeedbackTable");
    expect(scans).toHaveLength(2);
    expect(scans[1].input.ExclusiveStartKey).toEqual({ feedbackId: "cursor" });
    for (const scan of scans) expect(scan.input.ConsistentRead).toBe(true);
  });

  it("sets ConsistentRead on the tester-history BatchGet", async () => {
    // A formal preview reaches gate 5 only once the CSV and accounts validate;
    // an invalid CSV short-circuits earlier, so drive it with a real cohort.
    const enrollments = Array.from({ length: 17 }, (_, i) => ({
      courseId: "course-1",
      studentUserId: `sub-${String(i + 1).padStart(3, "0")}`,
      studentEmail: `student${String(i + 1).padStart(3, "0")}@x.edu`,
      status: "active",
    }));
    mocks.send.mockImplementation(routeSend({ enrollments }));

    const res = await invoke("phase3-import-preview", {
      mode: "formal",
      csv: formalCsv(),
    });
    expect(res.statusCode).toBe(200);

    const batchGets = commandsOfType("BatchGetCommand");
    expect(batchGets).toHaveLength(1);
    const request = batchGets[0].input.RequestItems.EventLogTable;
    expect(request.ConsistentRead).toBe(true);
    expect(request.Keys).toHaveLength(17);
    for (const key of request.Keys) {
      expect(String(key.eventId)).toMatch(
        new RegExp(`^phase3:tester-history:${AC_ID}:sub-\\d{3}$`)
      );
    }
  });

  it("reads SurveyInstance and StudentItemProgress consistently for a purge preview", async () => {
    const testerRows = ["A", "B", "C"].map((displayKey) => ({
      feedbackId: `phase3:sub-t0:${displayKey}`,
      moduleItemId: AC_ID,
      studentUserId: "sub-t0",
      displayKey,
      _importKind: "phase3_tester",
      source: displayKey === "A" ? "ai" : "reviewer",
      locked: true,
      revealed: false,
    }));
    mocks.send.mockImplementation(routeSend({ feedback: testerRows }));

    const res = await invoke("phase3-purge-tester", {
      scope: "one",
      studentUserId: "sub-t0",
      commit: false,
    });
    expect(res.statusCode).toBe(200);

    // Four exact reads: SurveyInstance and StudentItemProgress for Parts A–C
    // and Part D. Each must be consistent, or the plan could claim "absent" for
    // a row that exists.
    expect(mocks.getItem).toHaveBeenCalledTimes(4);
    const tables = mocks.getItem.mock.calls.map((c) => c[0]).sort();
    expect(tables).toEqual([
      "ProgressTable",
      "ProgressTable",
      "SurveyInstanceTable",
      "SurveyInstanceTable",
    ]);
    for (const call of mocks.getItem.mock.calls) {
      expect(call[3], "getItem options").toEqual({ consistentRead: true });
    }
  });

  it("never issues an eventually-consistent read on a Phase 3 safety path", async () => {
    mocks.send.mockImplementation(routeSend());
    await invoke("phase3-status", {});
    const safetyTables = new Set([
      "ModuleItemTable",
      "ReviewerFeedbackTable",
      "CourseEnrollmentTable",
    ]);
    const offenders = commandsOfType("ScanCommand")
      .filter((c: any) => safetyTables.has(c.input.TableName))
      .filter((c: any) => c.input.ConsistentRead !== true)
      .map((c: any) => c.input.TableName);
    expect(offenders).toEqual([]);
  });
});

describe("scanAllPages does not change behaviour for other callers", () => {
  it("leaves ConsistentRead unset when the option is omitted", async () => {
    // handleListItems is an unrelated caller of the same table and must keep
    // DynamoDB's default read behaviour.
    mocks.send.mockImplementation(routeSend());
    const listEvent = {
      ...event("", {}),
      httpMethod: "GET",
      queryStringParameters: null,
    } as APIGatewayProxyEvent;
    await handler(listEvent, {} as Context, () => {});
    const listScans = scansOf("ModuleItemTable").filter(
      (c: any) => c.input.ConsistentRead === undefined
    );
    expect(listScans.length).toBeGreaterThan(0);
  });
});

// ── fixture ──

const HEADER =
  "review_id,study_id,student_email,display_key,source_internal,d1,d2,d3,narrative,selected_source,session,student_turns";

const ORDERS: Record<string, [string, string, string]> = {
  "AI→F1→F2": ["ai", "faculty_1", "faculty_2"],
  "AI→F2→F1": ["ai", "faculty_2", "faculty_1"],
  "F1→AI→F2": ["faculty_1", "ai", "faculty_2"],
  "F1→F2→AI": ["faculty_1", "faculty_2", "ai"],
  "F2→AI→F1": ["faculty_2", "ai", "faculty_1"],
  "F2→F1→AI": ["faculty_2", "faculty_1", "ai"],
};

function formalCsv(): string {
  const allocation = [
    ...Array(3).fill("AI→F1→F2"),
    ...Array(3).fill("AI→F2→F1"),
    ...Array(3).fill("F1→AI→F2"),
    ...Array(3).fill("F1→F2→AI"),
    ...Array(2).fill("F2→AI→F1"),
    ...Array(3).fill("F2→F1→AI"),
  ];
  const lines = [HEADER];
  allocation.forEach((order, i) => {
    const n = String(i + 1).padStart(3, "0");
    ORDERS[order].forEach((source, k) => {
      lines.push(
        [
          `REVIEW-${n}`,
          `STUDY-${n}`,
          `student${n}@x.edu`,
          ["A", "B", "C"][k],
          source,
          "3",
          "2",
          "N/A",
          `"narrative ${n}${k}"`,
          "Maria",
          "Attempt 2",
          "42",
        ].join(",")
      );
    });
  });
  return lines.join("\n") + "\n";
}
