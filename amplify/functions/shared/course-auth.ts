/**
 * Course-scoped authorization helpers.
 *
 * These build on top of `extractCallerIdentity`/`requireRole` and add per-record
 * ownership / enrollment checks for the Canvas-like LMS feature.
 *
 * Conventions:
 *  - Returns `null` when the caller is authorized → continue handler.
 *  - Returns an APIGatewayProxyResult on denial → handler should return it directly.
 */

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { createResponse, HTTP_STATUS } from "./http";
import type { CallerIdentity } from "./auth-middleware";

const COURSE_TABLE = process.env.COURSE_TABLE_NAME;
const COURSE_INSTRUCTOR_TABLE = process.env.COURSE_INSTRUCTOR_TABLE_NAME;
const COURSE_ENROLLMENT_TABLE = process.env.COURSE_ENROLLMENT_TABLE_NAME;
const MODULE_ITEM_TABLE = process.env.MODULE_ITEM_TABLE_NAME;
const MODULE_TABLE = process.env.MODULE_TABLE_NAME;
const ASSIGNMENT_TABLE = process.env.ASSIGNMENT_TABLE_NAME;
const SESSION_TABLE = process.env.SESSION_TABLE_NAME;

function unauthorized(reason: string) {
  return createResponse(HTTP_STATUS.FORBIDDEN, { error: reason });
}

function missingTable(reason: string) {
  return createResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR, { error: reason });
}

async function getInstructorRow(
  dynamo: DynamoDBDocumentClient,
  courseId: string,
  facultyUserId: string
) {
  if (!COURSE_INSTRUCTOR_TABLE) {
    return null;
  }
  const result = await dynamo.send(
    new GetCommand({
      TableName: COURSE_INSTRUCTOR_TABLE,
      Key: { courseId, facultyUserId },
    })
  );
  return result.Item || null;
}

async function getEnrollmentRow(
  dynamo: DynamoDBDocumentClient,
  courseId: string,
  studentUserId: string
) {
  if (!COURSE_ENROLLMENT_TABLE) {
    return null;
  }
  const result = await dynamo.send(
    new GetCommand({
      TableName: COURSE_ENROLLMENT_TABLE,
      Key: { courseId, studentUserId },
    })
  );
  return result.Item || null;
}

async function getCourseRow(dynamo: DynamoDBDocumentClient, courseId: string) {
  if (!COURSE_TABLE) {
    return null;
  }
  const result = await dynamo.send(
    new GetCommand({ TableName: COURSE_TABLE, Key: { courseId } })
  );
  return result.Item || null;
}

/**
 * Allow if caller is admin OR an instructor (owner|co_teacher) of the course.
 */
export async function requireCourseInstructor(
  caller: CallerIdentity,
  courseId: string,
  dynamo: DynamoDBDocumentClient
) {
  if (caller.role === "admin") return null;
  if (!COURSE_INSTRUCTOR_TABLE) return missingTable("COURSE_INSTRUCTOR_TABLE_NAME not configured");
  if (caller.role !== "faculty" && caller.role !== "simulation_designer") {
    return unauthorized("Only faculty, simulation_designer, or admin can act as a course instructor");
  }
  const row = await getInstructorRow(dynamo, courseId, caller.userId);
  if (!row) {
    return unauthorized("Caller is not an instructor of this course");
  }
  return null;
}

/**
 * Allow if caller is admin OR specifically the OWNER of the course.
 * Used for sensitive ops (adding/removing co-teacher, deleting course).
 */
export async function requireCourseOwner(
  caller: CallerIdentity,
  courseId: string,
  dynamo: DynamoDBDocumentClient
) {
  if (caller.role === "admin") return null;
  if (!COURSE_INSTRUCTOR_TABLE) return missingTable("COURSE_INSTRUCTOR_TABLE_NAME not configured");
  if (caller.role !== "faculty" && caller.role !== "simulation_designer") {
    return unauthorized("Only faculty, simulation_designer, or admin can manage instructors");
  }
  const row = await getInstructorRow(dynamo, courseId, caller.userId);
  // Course owner (a faculty professor) AND coordinator (a simulation_designer
  // who set up the course) can both perform owner-level actions like managing
  // instructors and archiving the course.
  if (!row || (row.role !== "owner" && row.role !== "coordinator")) {
    return unauthorized("Only the course owner or coordinator can perform this action");
  }
  return null;
}

/**
 * Allow if caller is admin, an instructor, or an active enrolled student of the course.
 */
export async function requireCourseAccess(
  caller: CallerIdentity,
  courseId: string,
  dynamo: DynamoDBDocumentClient
) {
  if (caller.role === "admin") return null;
  if (caller.role === "faculty" || caller.role === "simulation_designer") {
    return await requireCourseInstructor(caller, courseId, dynamo);
  }
  if (caller.role !== "student") {
    return unauthorized("Unsupported role for course access");
  }
  if (!COURSE_ENROLLMENT_TABLE) return missingTable("COURSE_ENROLLMENT_TABLE_NAME not configured");
  // Default published courses are auto-accessible to every student.
  const course = await getCourseRow(dynamo, courseId);
  if (course && course.isDefault === true && course.status === "published") {
    return null;
  }
  const row = await getEnrollmentRow(dynamo, courseId, caller.userId);
  if (!row || row.status !== "active") {
    return unauthorized("Caller is not enrolled in this course");
  }
  return null;
}

/**
 * Same as requireCourseAccess but for student role only.
 */
export async function requireCourseEnrollment(
  caller: CallerIdentity,
  courseId: string,
  dynamo: DynamoDBDocumentClient
) {
  if (caller.role === "admin") return null;
  if (caller.role === "faculty" || caller.role === "simulation_designer") {
    return await requireCourseInstructor(caller, courseId, dynamo);
  }
  if (caller.role !== "student") {
    return unauthorized("Unsupported role for course enrollment");
  }
  if (!COURSE_ENROLLMENT_TABLE) return missingTable("COURSE_ENROLLMENT_TABLE_NAME not configured");
  // Default published courses are auto-accessible to every student.
  const course = await getCourseRow(dynamo, courseId);
  if (course && course.isDefault === true && course.status === "published") {
    return null;
  }
  const row = await getEnrollmentRow(dynamo, courseId, caller.userId);
  if (!row || row.status !== "active") {
    return unauthorized("Caller is not enrolled in this course");
  }
  return null;
}

/**
 * Resolve courseId from a moduleItemId by reading ModuleItem table.
 */
export async function resolveModuleItemCourseId(
  dynamo: DynamoDBDocumentClient,
  moduleItemId: string
): Promise<{ courseId: string; moduleId: string; item: Record<string, any> } | null> {
  if (!MODULE_ITEM_TABLE) return null;
  const result = await dynamo.send(
    new GetCommand({ TableName: MODULE_ITEM_TABLE, Key: { moduleItemId } })
  );
  const item = result.Item;
  if (!item) return null;
  return { courseId: item.courseId, moduleId: item.moduleId, item };
}

/**
 * Resolve courseId from a moduleId.
 */
export async function resolveModuleCourseId(
  dynamo: DynamoDBDocumentClient,
  moduleId: string
): Promise<{ courseId: string; mod: Record<string, any> } | null> {
  if (!MODULE_TABLE) return null;
  const result = await dynamo.send(
    new GetCommand({ TableName: MODULE_TABLE, Key: { moduleId } })
  );
  const mod = result.Item;
  if (!mod) return null;
  return { courseId: mod.courseId, mod };
}

/**
 * Allow caller to read a session if:
 *  - admin
 *  - the session's owner student
 *  - an instructor of the course that owns the session's assignment
 */
export async function requireSessionVisibility(
  caller: CallerIdentity,
  sessionId: string,
  dynamo: DynamoDBDocumentClient
): Promise<{ session: Record<string, any> | null; error: ReturnType<typeof createResponse> | null }> {
  if (!SESSION_TABLE) {
    return { session: null, error: missingTable("SESSION_TABLE_NAME not configured") };
  }
  const result = await dynamo.send(
    new GetCommand({ TableName: SESSION_TABLE, Key: { sessionId } })
  );
  const session = result.Item;
  if (!session) {
    return {
      session: null,
      error: createResponse(HTTP_STATUS.NOT_FOUND, { error: "Session not found" }),
    };
  }
  if (caller.role === "admin") return { session, error: null };
  if (caller.role === "student") {
    if (session.studentUserId !== caller.userId) {
      return { session: null, error: unauthorized("You cannot view another student's session") };
    }
    return { session, error: null };
  }
  if (caller.role !== "faculty" && caller.role !== "simulation_designer") {
    return { session: null, error: unauthorized("Unsupported role for session visibility") };
  }
  // Faculty / simulation_designer: must be an instructor of the course that owns the session's assignment
  if (!ASSIGNMENT_TABLE) {
    return {
      session: null,
      error: missingTable("ASSIGNMENT_TABLE_NAME not configured"),
    };
  }
  const assignmentResult = await dynamo.send(
    new GetCommand({ TableName: ASSIGNMENT_TABLE, Key: { assignmentId: session.assignmentId } })
  );
  const assignment = assignmentResult.Item;
  if (!assignment || !assignment.courseId) {
    return {
      session: null,
      error: unauthorized("Session is not part of any course you instruct"),
    };
  }
  const instructor = await getInstructorRow(dynamo, assignment.courseId, caller.userId);
  if (!instructor) {
    return {
      session: null,
      error: unauthorized("You are not an instructor of this session's course"),
    };
  }
  return { session, error: null };
}

/**
 * Convenience: list instructors of a course (owner first).
 */
export async function listCourseInstructors(
  dynamo: DynamoDBDocumentClient,
  courseId: string
): Promise<Array<Record<string, any>>> {
  if (!COURSE_INSTRUCTOR_TABLE) return [];
  const { ScanCommand } = await import("@aws-sdk/lib-dynamodb");
  const result = await dynamo.send(
    new ScanCommand({
      TableName: COURSE_INSTRUCTOR_TABLE,
      FilterExpression: "courseId = :c",
      ExpressionAttributeValues: { ":c": courseId },
    })
  );
  const rows = result.Items || [];
  return rows.sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : 0));
}

export {
  COURSE_TABLE,
  COURSE_INSTRUCTOR_TABLE,
  COURSE_ENROLLMENT_TABLE,
  MODULE_TABLE,
  MODULE_ITEM_TABLE,
  ASSIGNMENT_TABLE,
  SESSION_TABLE,
  getCourseRow,
  getInstructorRow,
  getEnrollmentRow,
};
