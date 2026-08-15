import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";

// Env table names must exist before the handler module is evaluated.
const mocks = vi.hoisted(() => {
  process.env.SESSION_TABLE_NAME = "SessionTable";
  process.env.TURN_TABLE_NAME = "TurnTable";
  process.env.SESSION_EVIDENCE_TABLE_NAME = "EvidenceTable";
  process.env.MODULE_TABLE_NAME = "ModuleTable";
  process.env.MODULE_ITEM_TABLE_NAME = "ModuleItemTable";
  process.env.ASSIGNMENT_TABLE_NAME = "AssignmentTable";
  return {
    tables: {} as Record<string, Array<Record<string, unknown>>>,
    queryItems: vi.fn(),
    requireCourseInstructor: vi.fn(),
    getEnrollmentRow: vi.fn(),
  };
});

vi.mock("../shared/auth-middleware", () => ({
  extractCallerIdentity: vi.fn(),
  requireRole: vi.fn(),
}));

// Replace only the AWS-touching pieces of ../shared; keep the real HTTP
// helpers so response shapes stay authentic. The fake Dynamo client honors
// the handler's `#a = :v` Scan FilterExpression, mirroring how DynamoDB
// itself scopes the scans to one student / one course.
vi.mock("../shared", async () => {
  const http = await vi.importActual<Record<string, unknown>>("../shared/http");
  return {
    ...http,
    createDynamoDbClient: () => ({
      send: async (command: unknown) => {
        const input = (command as {
          input?: {
            TableName?: string;
            ExpressionAttributeNames?: Record<string, string>;
            ExpressionAttributeValues?: Record<string, unknown>;
          };
        })?.input;
        const rows = mocks.tables[input?.TableName ?? ""] ?? [];
        const attr = input?.ExpressionAttributeNames?.["#a"];
        const value = input?.ExpressionAttributeValues?.[":v"];
        return {
          Items: attr ? rows.filter((r) => r?.[attr] === value) : rows,
        };
      },
    }),
    queryItems: mocks.queryItems,
    requireCourseInstructor: mocks.requireCourseInstructor,
    getEnrollmentRow: mocks.getEnrollmentRow,
  };
});

import { extractCallerIdentity, requireRole } from "../shared/auth-middleware";
import { createResponse, HTTP_STATUS } from "../shared/http";
import { handler } from "./handler";

const COURSE = "course-1";
const STUDENT = "student-sub-1";
const EMAIL = "student1@example.edu";
const ASSIGNMENT = "assign-1";

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: "GET",
    path: `/courses/${COURSE}/students/${STUDENT}/review-package`,
    resource: "/courses/{courseId}/students/{studentUserId}/review-package",
    body: null,
    headers: {},
    multiValueHeaders: {},
    isBase64Encoded: false,
    pathParameters: { courseId: COURSE, studentUserId: STUDENT },
    queryStringParameters: { format: "cue-events-csv" },
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      authorizer: { claims: {} },
    } as unknown as APIGatewayProxyEvent["requestContext"],
    ...overrides,
  } as APIGatewayProxyEvent;
}

const fakeContext = {} as Context;
const noopCallback = () => {};

async function runHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const res = await handler(event, fakeContext, noopCallback);
  return res as APIGatewayProxyResult;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tables = {
    SessionTable: [
      {
        sessionId: "sess-1",
        assignmentId: ASSIGNMENT,
        studentUserId: STUDENT,
        attemptNo: 1,
        status: "completed",
        startedAt: "2026-08-01T10:00:00.000Z",
        endedAt: "2026-08-01T10:30:00.000Z",
      },
    ],
    EvidenceTable: [
      {
        evidenceId: "ev-1",
        sessionId: "sess-1",
        assignmentId: ASSIGNMENT,
        studentUserId: STUDENT,
        phaseId: "phase2",
        taskId: "phase2-ben-object-naming",
        submittedAt: "2026-08-01T10:20:00.000Z",
        rawEvidencePayload: {
          studyTaskContext: {
            interactionEvents: [
              {
                eventType: "item_tracking_started",
                itemId: "B-01",
                occurredAt: "2026-08-01T10:04:00.000Z",
              },
              {
                eventType: "cue_pressed",
                cueLevel: "Semantic",
                itemId: "B-01",
                occurredAt: "2026-08-01T10:05:00.000Z",
              },
            ],
          },
        },
      },
      // Belongs to a DIFFERENT student — the scan filter must exclude it.
      {
        evidenceId: "intruder-ev",
        sessionId: "intruder-sess",
        assignmentId: ASSIGNMENT,
        studentUserId: "intruder-sub",
        phaseId: "phase2",
        submittedAt: "2026-08-01T11:00:00.000Z",
        rawEvidencePayload: { studyTaskContext: { interactionEvents: [] } },
      },
    ],
    AssignmentTable: [{ assignmentId: ASSIGNMENT, courseId: COURSE, title: "Assignment 1" }],
    ModuleTable: [],
    ModuleItemTable: [],
    TurnTable: [],
  };
  mocks.queryItems.mockResolvedValue([]);
  mocks.requireCourseInstructor.mockResolvedValue(null);
  mocks.getEnrollmentRow.mockResolvedValue({
    courseId: COURSE,
    studentUserId: STUDENT,
    status: "active",
    studentEmail: EMAIL,
  });
  vi.mocked(extractCallerIdentity).mockResolvedValue({
    userId: "faculty-sub-1",
    role: "faculty",
  });
  vi.mocked(requireRole).mockReturnValue(null);
});

describe("export-function handler — method/auth chain (both formats)", () => {
  it("returns 200 for OPTIONS and 405 for POST", async () => {
    expect((await runHandler(makeEvent({ httpMethod: "OPTIONS" }))).statusCode).toBe(200);
    expect((await runHandler(makeEvent({ httpMethod: "POST" }))).statusCode).toBe(405);
  });

  it("rejects disallowed roles (student) before any data access", async () => {
    vi.mocked(requireRole).mockReturnValue(
      createResponse(HTTP_STATUS.FORBIDDEN, { error: "Role 'student' not authorized" })
    );
    const res = await runHandler(makeEvent());
    expect(res.statusCode).toBe(403);
    expect(mocks.getEnrollmentRow).not.toHaveBeenCalled();
  });

  it("returns 400 when path params are missing", async () => {
    const res = await runHandler(makeEvent({ pathParameters: { courseId: COURSE } }));
    expect(res.statusCode).toBe(400);
  });

  it("requires the caller to be a course instructor for the CSV format too", async () => {
    mocks.requireCourseInstructor.mockResolvedValue(
      createResponse(HTTP_STATUS.FORBIDDEN, { error: "Not an instructor of this course" })
    );
    const res = await runHandler(makeEvent());
    expect(res.statusCode).toBe(403);
    expect(mocks.requireCourseInstructor).toHaveBeenCalledWith(
      expect.anything(),
      COURSE,
      expect.anything()
    );
  });

  it("returns 404 for a non-enrolled student and 403 for a removed enrollment (CSV format)", async () => {
    mocks.getEnrollmentRow.mockResolvedValue(null);
    expect((await runHandler(makeEvent())).statusCode).toBe(404);

    mocks.getEnrollmentRow.mockResolvedValue({
      courseId: COURSE,
      studentUserId: STUDENT,
      status: "removed",
    });
    expect((await runHandler(makeEvent())).statusCode).toBe(403);
  });
});

describe("export-function handler — format=cue-events-csv", () => {
  it("returns {filename, csv} with header, coverage, and event rows", async () => {
    const res = await runHandler(makeEvent());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.csv).toBeDefined();
    expect(body.html).toBeUndefined();
    const lines = body.csv.split("\r\n").filter((l: string) => l !== "");
    expect(lines[0].startsWith("row_type,student_email,source_student_id")).toBe(true);
    expect(body.csv).toContain(EMAIL);
    expect(body.csv).toContain("cue_pressed");
    expect(body.csv).toContain("Semantic");
    expect(body.csv).toContain("ev-1");
    // Non-cue telemetry events are counted but never emitted as rows.
    expect(body.csv).not.toContain("item_tracking_started");
  });

  it("marks a missing enrollment email explicitly and never uses the sub", async () => {
    for (const enrollment of [
      { courseId: COURSE, studentUserId: STUDENT, status: "active" },
      { courseId: COURSE, studentUserId: STUDENT, status: "active", studentEmail: null },
    ]) {
      mocks.getEnrollmentRow.mockResolvedValue(enrollment);
      const res = await runHandler(makeEvent());
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      const rows = body.csv
        .split("\r\n")
        .filter((l: string) => l !== "")
        .slice(1)
        .map((l: string) => l.split(","));
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row[1]).toBe("email_unavailable");
        expect(row[2]).toBe(STUDENT);
      }
    }
  });

  it("names the file with the opaque student id, never the email", async () => {
    const res = await runHandler(makeEvent());
    const body = JSON.parse(res.body);
    expect(body.filename).toMatch(
      new RegExp(`^VOICE-Cue-Events-${STUDENT}-\\d{4}-\\d{2}-\\d{2}\\.csv$`)
    );
    expect(body.filename).not.toContain(EMAIL);
    expect(body.filename).not.toContain("example.edu");
  });

  it("cannot include another student's evidence", async () => {
    const res = await runHandler(makeEvent());
    const body = JSON.parse(res.body);
    expect(body.csv).not.toContain("intruder-ev");
    expect(body.csv).not.toContain("intruder-sub");
    expect(body.csv).not.toContain("intruder-sess");
  });

  it("includes evidence from incomplete sessions", async () => {
    mocks.tables.SessionTable[0].status = "active";
    mocks.tables.SessionTable[0].endedAt = undefined;
    const res = await runHandler(makeEvent());
    const body = JSON.parse(res.body);
    expect(body.csv).toContain("ev-1");
    expect(body.csv).toContain("active");
  });
});

describe("export-function handler — HTML review package unchanged", () => {
  it("returns {filename, html} for format=html", async () => {
    const res = await runHandler(
      makeEvent({ queryStringParameters: { format: "html" } })
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.html).toBeDefined();
    expect(body.csv).toBeUndefined();
    expect(body.filename).toMatch(/^VOICE-Review-Package-.*\.html$/);
  });

  it("returns the HTML package when no format is given", async () => {
    const res = await runHandler(makeEvent({ queryStringParameters: null }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.html).toBeDefined();
    expect(body.csv).toBeUndefined();
  });
});
