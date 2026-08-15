import type { APIGatewayProxyHandler } from "aws-lambda";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import {
  createResponse,
  optionsResponse,
  methodNotAllowedResponse,
  serverErrorResponse,
  getQueryParams,
  HTTP_STATUS,
  createDynamoDbClient,
  queryItems,
  requireCourseInstructor,
  getEnrollmentRow,
} from "../shared";
import { extractCallerIdentity, requireRole } from "../shared/auth-middleware";
import { buildReviewPackage, type BuildInput, type TurnLike } from "./review-package";
import { renderReviewPackageHtml } from "./render-html";
import { buildCueEventsCsv } from "./cue-events-csv";

const SESSION_TABLE = process.env.SESSION_TABLE_NAME;
const TURN_TABLE = process.env.TURN_TABLE_NAME;
const SESSION_EVIDENCE_TABLE = process.env.SESSION_EVIDENCE_TABLE_NAME;
const MODULE_TABLE = process.env.MODULE_TABLE_NAME;
const MODULE_ITEM_TABLE = process.env.MODULE_ITEM_TABLE_NAME;
const ASSIGNMENT_TABLE = process.env.ASSIGNMENT_TABLE_NAME;

const dynamo = createDynamoDbClient();

async function scanByAttribute(
  tableName: string | undefined,
  attribute: string,
  value: string
): Promise<any[]> {
  if (!tableName) throw new Error(`Missing table name for ${attribute} scan`);
  const out: any[] = [];
  let lastKey: Record<string, any> | undefined;
  do {
    const result: any = await dynamo.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: "#a = :v",
        ExpressionAttributeNames: { "#a": attribute },
        ExpressionAttributeValues: { ":v": value },
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      })
    );
    for (const item of result.Items || []) out.push(item);
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return out;
}

function sanitizeForFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "student";
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const method = event.httpMethod;
  if (method === "OPTIONS") return optionsResponse();
  if (method !== "GET") return methodNotAllowedResponse(["GET", "OPTIONS"]);

  try {
    // ── AuthN/AuthZ: faculty/simulation_designer/admin + course instructor ──
    const caller = await extractCallerIdentity(event);
    const roleError = requireRole(caller, ["faculty", "simulation_designer", "admin"]);
    if (roleError) return roleError;

    const courseId = event.pathParameters?.courseId;
    const studentUserId = event.pathParameters?.studentUserId;
    if (!courseId || !studentUserId) {
      return createResponse(HTTP_STATUS.BAD_REQUEST, {
        error: "courseId and studentUserId are required",
      });
    }

    const instructorError = await requireCourseInstructor(caller!, courseId, dynamo);
    if (instructorError) return instructorError;

    // Target student must have an ACTIVE enrollment in this course. Matches the
    // codebase's enrollment semantics (CourseEnrollment.status enum is
    // "active" | "removed"; shared/course-auth denies anything !== "active").
    // A removed enrollment must NOT be exportable (Codex review finding).
    const enrollment = await getEnrollmentRow(dynamo, courseId, studentUserId);
    if (!enrollment) {
      return createResponse(HTTP_STATUS.NOT_FOUND, {
        error: "Student is not enrolled in this course",
      });
    }
    if (enrollment.status !== "active") {
      return createResponse(HTTP_STATUS.FORBIDDEN, {
        error: "Student's enrollment in this course is not active",
      });
    }

    const params = getQueryParams(event.queryStringParameters);
    const moduleIdFilter = params.moduleId?.trim() || null;
    const studentEmail =
      (typeof enrollment.studentEmail === "string" && enrollment.studentEmail) || studentUserId;

    // ── Internal cue-event CSV export (?format=cue-events-csv) ──
    // Same route, same auth chain as the HTML review package; any other format
    // value falls through to the unchanged HTML path. Whole-course scope
    // (moduleId is not honored here). Covers ALL session statuses so
    // incomplete-session evidence is included.
    if ((params.format ?? "").trim().toLowerCase() === "cue-events-csv") {
      const [allSessions, allEvidence, allAssignments] = await Promise.all([
        scanByAttribute(SESSION_TABLE, "studentUserId", studentUserId),
        scanByAttribute(SESSION_EVIDENCE_TABLE, "studentUserId", studentUserId),
        scanByAttribute(ASSIGNMENT_TABLE, "courseId", courseId),
      ]);
      const courseAssignmentIds = new Set<string>();
      for (const a of allAssignments) {
        if (typeof a.assignmentId === "string" && a.assignmentId) {
          courseAssignmentIds.add(a.assignmentId);
        }
      }
      // Never represent the Cognito sub as an email. CourseEnrollment
      // .studentEmail is the only email source this Lambda can read: resolving
      // sub → email needs cognito-idp:ListUsers (see cognito-user-function's
      // handleBatchResolve), a permission this function does not have. A
      // missing email becomes an explicit non-email marker instead.
      const csvStudentEmail =
        typeof enrollment.studentEmail === "string" && enrollment.studentEmail.trim() !== ""
          ? enrollment.studentEmail.trim()
          : "email_unavailable";
      const csv = buildCueEventsCsv({
        studentEmail: csvStudentEmail,
        studentUserId,
        courseId,
        courseAssignmentIds,
        sessions: allSessions,
        evidenceRows: allEvidence,
      });
      const datePart = new Date().toISOString().slice(0, 10);
      // Filename policy: opaque studentUserId only — never the email.
      const filename = `VOICE-Cue-Events-${sanitizeForFilename(studentUserId)}-${datePart}.csv`;
      console.log("cue-events export generated", {
        courseId,
        studentUserId,
        sessions: allSessions.length,
        evidenceRows: allEvidence.length,
      });
      return createResponse(HTTP_STATUS.OK, { filename, csv });
    }

    // ── Gather (ONE student) ──
    // Scan-risk / scope: these Scans are intentionally bounded to a SINGLE
    // student (by studentUserId) and a SINGLE course (by courseId). They are
    // acceptable ONLY for this one-student export. This path must NOT be reused
    // for batch / course-wide / multi-student export — that would require GSIs
    // and a different architecture. No batch/multi-student export exists here.
    const [allSessions, allEvidence, allModules, allModuleItems, allAssignments] =
      await Promise.all([
        scanByAttribute(SESSION_TABLE, "studentUserId", studentUserId),
        scanByAttribute(SESSION_EVIDENCE_TABLE, "studentUserId", studentUserId),
        scanByAttribute(MODULE_TABLE, "courseId", courseId),
        scanByAttribute(MODULE_ITEM_TABLE, "courseId", courseId),
        scanByAttribute(ASSIGNMENT_TABLE, "courseId", courseId),
      ]);

    // Only this course's assignments are in scope.
    const assignmentsById = new Map<string, any>();
    for (const a of allAssignments) assignmentsById.set(a.assignmentId, a);

    const modules = moduleIdFilter
      ? allModules.filter((m) => m.moduleId === moduleIdFilter)
      : allModules;

    // Completed sessions for THIS student that belong to THIS course's assignments.
    const completedSessionsByAssignment = new Map<string, any[]>();
    const inScopeSessionIds: string[] = [];
    for (const s of allSessions) {
      if (s.status !== "completed") continue;
      if (!assignmentsById.has(s.assignmentId)) continue;
      const list = completedSessionsByAssignment.get(s.assignmentId) ?? [];
      list.push(s);
      completedSessionsByAssignment.set(s.assignmentId, list);
      inScopeSessionIds.push(s.sessionId);
    }

    // Evidence grouped by session (only for in-scope sessions).
    const inScopeSet = new Set(inScopeSessionIds);
    const evidenceBySession = new Map<string, any[]>();
    for (const e of allEvidence) {
      if (!inScopeSet.has(e.sessionId)) continue;
      const list = evidenceBySession.get(e.sessionId) ?? [];
      list.push(e);
      evidenceBySession.set(e.sessionId, list);
    }

    // Turns per in-scope session (key-based query, ordered by turnIndex).
    const turnsBySession = new Map<string, TurnLike[]>();
    await Promise.all(
      inScopeSessionIds.map(async (sessionId) => {
        try {
          const turns = (await queryItems(
            TURN_TABLE as string,
            "sessionId = :sid",
            { ":sid": sessionId },
            dynamo,
            { scanIndexForward: true }
          )) as TurnLike[];
          turnsBySession.set(sessionId, turns);
        } catch {
          turnsBySession.set(sessionId, []);
        }
      })
    );

    const input: BuildInput = {
      studentEmail,
      modules,
      moduleItems: allModuleItems,
      assignmentsById,
      completedSessionsByAssignment,
      turnsBySession,
      evidenceBySession,
    };

    const pkg = buildReviewPackage(input);
    const html = renderReviewPackageHtml(pkg);

    const datePart = new Date().toISOString().slice(0, 10);
    const filename = `VOICE-Review-Package-${sanitizeForFilename(studentEmail)}-${datePart}.html`;

    // Disciplined logging: ids + counts only. Never log email, transcript,
    // evidence, or generated HTML.
    console.log("review-package export generated", {
      courseId,
      studentUserId,
      moduleScoped: Boolean(moduleIdFilter),
      modules: pkg.modules.length,
      sessions: inScopeSessionIds.length,
    });

    return createResponse(HTTP_STATUS.OK, { filename, html });
  } catch (error) {
    // Avoid logging payloads; surface only the error message.
    console.error(
      "review-package export error:",
      error instanceof Error ? error.message : "unknown error"
    );
    return serverErrorResponse("Failed to generate review package");
  }
};
