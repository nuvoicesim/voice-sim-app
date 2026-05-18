import type { APIGatewayProxyHandler } from "aws-lambda";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import {
  createResponse,
  optionsResponse,
  methodNotAllowedResponse,
  serverErrorResponse,
  HTTP_STATUS,
  createDynamoDbClient,
  getItem,
  putItem,
  generateId,
  generateTimestamp,
} from "../shared";
import { extractCallerIdentity, requireRole } from "../shared/auth-middleware";

const ASSIGNMENT_TABLE = process.env.ASSIGNMENT_TABLE_NAME!;
const ENROLLMENT_TABLE = process.env.ENROLLMENT_TABLE_NAME!;
const SESSION_TABLE = process.env.SESSION_TABLE_NAME!;
const EVALUATION_TABLE = process.env.EVALUATION_TABLE_NAME!;
const COURSE_TABLE = process.env.COURSE_TABLE_NAME!;
const COURSE_INSTRUCTOR_TABLE = process.env.COURSE_INSTRUCTOR_TABLE_NAME!;
const COURSE_ENROLLMENT_TABLE = process.env.COURSE_ENROLLMENT_TABLE_NAME!;
const MODULE_TABLE = process.env.MODULE_TABLE_NAME!;
const MODULE_ITEM_TABLE = process.env.MODULE_ITEM_TABLE_NAME!;
const PROGRESS_TABLE = process.env.STUDENT_ITEM_PROGRESS_TABLE_NAME!;
const MIGRATION_LOG_TABLE = process.env.MIGRATION_LOG_TABLE_NAME!;

const MIGRATION_NAME = "course_v1";

const dynamo = createDynamoDbClient();

export const handler: APIGatewayProxyHandler = async (event) => {
  const method = event.httpMethod;
  if (method === "OPTIONS") return optionsResponse();

  try {
    const caller = await extractCallerIdentity(event);
    const authError = requireRole(caller, ["admin"]);
    if (authError) return authError;

    if (method === "POST") return await handleRunMigration();
    if (method === "GET") return await handleGetStatus();
    return methodNotAllowedResponse(["GET", "POST", "OPTIONS"]);
  } catch (error) {
    console.error("migration-function unhandled error", error);
    return serverErrorResponse("Internal server error");
  }
};

async function handleGetStatus() {
  const log = await getItem(MIGRATION_LOG_TABLE, { migrationName: MIGRATION_NAME }, dynamo);
  return createResponse(HTTP_STATUS.OK, { migration: log || null });
}

async function handleRunMigration() {
  const startedAt = generateTimestamp();
  const stats = {
    coursesCreated: 0,
    modulesCreated: 0,
    moduleItemsCreated: 0,
    enrollmentsCreated: 0,
    progressCreated: 0,
    instructorsCreated: 0,
  };

  // 1. Scan all assignments and group by createdBy (faculty).
  const assignmentsScan = await dynamo.send(new ScanCommand({ TableName: ASSIGNMENT_TABLE }));
  const allAssignments = assignmentsScan.Items || [];
  const byFaculty = new Map<string, any[]>();
  for (const a of allAssignments) {
    if (!a.createdBy) continue;
    const arr = byFaculty.get(a.createdBy) || [];
    arr.push(a);
    byFaculty.set(a.createdBy, arr);
  }

  // 2. Per-faculty: ensure Default Course + Module + ModuleItem per assignment.
  const courseIdByFaculty = new Map<string, string>();
  const moduleIdByCourse = new Map<string, string>();
  const moduleItemIdByAssignment = new Map<string, { moduleItemId: string; courseId: string; moduleId: string }>();

  for (const [facultyUserId, assignments] of byFaculty.entries()) {
    let courseId: string | undefined;
    // Idempotent lookup by ownerFacultyId + title (cheap scan).
    const courseLookup = await dynamo.send(
      new ScanCommand({
        TableName: COURSE_TABLE,
        FilterExpression: "ownerFacultyId = :u AND #t = :t",
        ExpressionAttributeNames: { "#t": "title" },
        ExpressionAttributeValues: { ":u": facultyUserId, ":t": "My Default Course" },
      })
    );
    if (courseLookup.Items && courseLookup.Items.length > 0) {
      courseId = courseLookup.Items[0].courseId;
    } else {
      courseId = generateId();
      await putItem(
        COURSE_TABLE,
        {
          courseId,
          ownerFacultyId: facultyUserId,
          title: "My Default Course",
          description: "Auto-migrated from your existing assignments.",
          status: "published",
          groupConfig: {},
          createdAt: startedAt,
          updatedAt: startedAt,
        },
        dynamo
      );
      stats.coursesCreated++;
    }
    courseIdByFaculty.set(facultyUserId, courseId!);

    // Ensure CourseInstructor (owner) row.
    const instructorRow = await getItem(
      COURSE_INSTRUCTOR_TABLE,
      { courseId, facultyUserId },
      dynamo
    );
    if (!instructorRow) {
      await putItem(
        COURSE_INSTRUCTOR_TABLE,
        {
          courseId,
          facultyUserId,
          role: "owner",
          addedAt: startedAt,
          addedBy: facultyUserId,
        },
        dynamo
      );
      stats.instructorsCreated++;
    }

    // Ensure Module.
    let moduleId: string | undefined;
    const moduleLookup = await dynamo.send(
      new ScanCommand({
        TableName: MODULE_TABLE,
        FilterExpression: "courseId = :c AND #t = :t",
        ExpressionAttributeNames: { "#t": "title" },
        ExpressionAttributeValues: { ":c": courseId, ":t": "Legacy Assignments" },
      })
    );
    if (moduleLookup.Items && moduleLookup.Items.length > 0) {
      moduleId = moduleLookup.Items[0].moduleId;
    } else {
      moduleId = generateId();
      await putItem(
        MODULE_TABLE,
        {
          moduleId,
          courseId,
          title: "Legacy Assignments",
          description: "Auto-migrated assignments live here.",
          position: 0,
          gating: { kind: "open" },
          createdAt: startedAt,
          updatedAt: startedAt,
        },
        dynamo
      );
      stats.modulesCreated++;
    }
    moduleIdByCourse.set(courseId!, moduleId!);

    // Existing ModuleItems for this module (idempotent skip).
    const existingItemsScan = await dynamo.send(
      new ScanCommand({
        TableName: MODULE_ITEM_TABLE,
        FilterExpression: "moduleId = :m",
        ExpressionAttributeValues: { ":m": moduleId },
      })
    );
    const existingByAssignmentId = new Map<string, string>();
    let nextPosition = 0;
    for (const it of existingItemsScan.Items || []) {
      if (it.payload?.assignmentId) {
        existingByAssignmentId.set(it.payload.assignmentId, it.moduleItemId);
      }
      nextPosition = Math.max(nextPosition, (it.position ?? 0) + 1);
    }

    // Per assignment: create ModuleItem if missing.
    for (const a of assignments) {
      let moduleItemId: string;
      if (a.moduleItemId && a.courseId === courseId) {
        moduleItemId = a.moduleItemId;
      } else if (existingByAssignmentId.has(a.assignmentId)) {
        moduleItemId = existingByAssignmentId.get(a.assignmentId)!;
      } else {
        moduleItemId = generateId();
        await putItem(
          MODULE_ITEM_TABLE,
          {
            moduleItemId,
            moduleId,
            courseId,
            itemType: "assignment",
            title: a.title || "Legacy Assignment",
            position: nextPosition++,
            gating: { kind: "open" },
            payload: { assignmentId: a.assignmentId },
            completionRule: { kind: "auto_on_submit" },
            createdAt: startedAt,
            updatedAt: startedAt,
          },
          dynamo
        );
        stats.moduleItemsCreated++;
      }
      // Backfill assignment.courseId/moduleItemId.
      if (a.courseId !== courseId || a.moduleItemId !== moduleItemId) {
        await putItem(
          ASSIGNMENT_TABLE,
          { ...a, courseId, moduleItemId, updatedAt: startedAt },
          dynamo
        );
      }
      moduleItemIdByAssignment.set(a.assignmentId, {
        moduleItemId,
        courseId: courseId!,
        moduleId: moduleId!,
      });
    }
  }

  // 3. Backfill CourseEnrollment from AssignmentEnrollment.
  const enrollScan = await dynamo.send(new ScanCommand({ TableName: ENROLLMENT_TABLE }));
  const seenEnrollment = new Set<string>();
  for (const ae of enrollScan.Items || []) {
    const map = moduleItemIdByAssignment.get(ae.assignmentId);
    if (!map) continue;
    const key = `${map.courseId}::${ae.studentUserId}`;
    if (seenEnrollment.has(key)) continue;
    seenEnrollment.add(key);
    const existing = await getItem(
      COURSE_ENROLLMENT_TABLE,
      { courseId: map.courseId, studentUserId: ae.studentUserId },
      dynamo
    );
    if (!existing) {
      await putItem(
        COURSE_ENROLLMENT_TABLE,
        {
          courseId: map.courseId,
          studentUserId: ae.studentUserId,
          studentEmail: null,
          enrolledAt: startedAt,
          enrolledBy: "migration",
          status: "active",
        },
        dynamo
      );
      stats.enrollmentsCreated++;
    }
  }

  // 4. Backfill StudentItemProgress + best-attempt cache from completed sessions.
  const sessionScan = await dynamo.send(new ScanCommand({ TableName: SESSION_TABLE }));
  for (const s of sessionScan.Items || []) {
    if (s.status !== "completed") continue;
    const map = moduleItemIdByAssignment.get(s.assignmentId);
    if (!map) continue;
    const evaluation = await getItem(
      EVALUATION_TABLE,
      { sessionId: s.sessionId },
      dynamo
    );
    const score = typeof evaluation?.totalScore === "number" ? evaluation.totalScore : null;

    const existing = await getItem(
      PROGRESS_TABLE,
      { moduleItemId: map.moduleItemId, studentUserId: s.studentUserId },
      dynamo
    );
    const isBetter =
      score !== null && (existing?.bestSessionScore == null || score > existing.bestSessionScore);
    const next = {
      moduleItemId: map.moduleItemId,
      studentUserId: s.studentUserId,
      courseId: map.courseId,
      moduleId: map.moduleId,
      ...(existing || {}),
      state: "completed",
      completedAt: s.endedAt || startedAt,
      startedAt: existing?.startedAt || s.startedAt || startedAt,
      bestSessionId: isBetter ? s.sessionId : existing?.bestSessionId,
      bestSessionScore: isBetter ? score : existing?.bestSessionScore ?? null,
      createdAt: existing?.createdAt || startedAt,
      updatedAt: startedAt,
    };
    await putItem(PROGRESS_TABLE, next, dynamo);
    if (!existing) stats.progressCreated++;
  }

  // 5. Sentinel.
  await putItem(
    MIGRATION_LOG_TABLE,
    {
      migrationName: MIGRATION_NAME,
      version: "1.0.0",
      completedAt: generateTimestamp(),
      meta: stats,
    },
    dynamo
  );

  return createResponse(HTTP_STATUS.OK, { migration: MIGRATION_NAME, stats });
}
