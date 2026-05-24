import type { APIGatewayProxyHandler } from "aws-lambda";
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import {
  createResponse,
  optionsResponse,
  badRequestResponse,
  notFoundResponse,
  conflictResponse,
  methodNotAllowedResponse,
  serverErrorResponse,
  parseJsonBody,
  HTTP_STATUS,
  createDynamoDbClient,
  getItem,
  putItem,
  deleteItem,
  generateId,
  generateTimestamp,
  requireCourseInstructor,
  requireCourseOwner,
  requireCourseAccess,
  listCourseInstructors,
} from "../shared";
import { extractCallerIdentity, requireRole } from "../shared/auth-middleware";

const COURSE_TABLE = process.env.COURSE_TABLE_NAME!;
const COURSE_INSTRUCTOR_TABLE = process.env.COURSE_INSTRUCTOR_TABLE_NAME!;
const COURSE_ENROLLMENT_TABLE = process.env.COURSE_ENROLLMENT_TABLE_NAME!;
const STUDENT_GROUP_ASSIGNMENT_TABLE =
  process.env.STUDENT_GROUP_ASSIGNMENT_TABLE_NAME || "";
const USER_POOL_ID = process.env.USER_POOL_ID || "";

const dynamo = createDynamoDbClient();
const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION || "us-east-1" });

export const handler: APIGatewayProxyHandler = async (event) => {
  const method = event.httpMethod;
  const pathParams = event.pathParameters || {};
  const resource = event.resource || "";

  if (method === "OPTIONS") return optionsResponse();

  try {
    const caller = await extractCallerIdentity(event);
    const authError = requireRole(caller, ["student", "faculty", "simulation_designer", "admin"]);
    if (authError) return authError;

    // ── Instructors ──
    if (pathParams.courseId && resource.includes("/instructors")) {
      // PUT /courses/{courseId}/instructors/{facultyUserId}/role
      if (
        method === "PUT" &&
        pathParams.facultyUserId &&
        resource.endsWith("/role")
      ) {
        return await handleUpdateInstructorRole(
          caller!,
          pathParams.courseId!,
          pathParams.facultyUserId,
          event.body
        );
      }
      if (method === "GET") {
        return await handleListInstructors(caller!, pathParams.courseId!);
      }
      if (method === "POST") {
        return await handleAddInstructor(caller!, pathParams.courseId!, event.body);
      }
      if (method === "DELETE" && pathParams.facultyUserId) {
        return await handleRemoveInstructor(caller!, pathParams.courseId!, pathParams.facultyUserId);
      }
    }

    // ── Student's own group assignments for this course ──
    if (
      method === "GET" &&
      pathParams.courseId &&
      resource.endsWith("/courses/{courseId}/my-groups")
    ) {
      return await handleListMyGroups(caller!, pathParams.courseId);
    }

    // ── Faculty view: all group assignments for the course ──
    if (
      method === "GET" &&
      pathParams.courseId &&
      resource.endsWith("/courses/{courseId}/group-assignments")
    ) {
      return await handleListGroupAssignments(caller!, pathParams.courseId);
    }

    // ── Enrollments ──
    if (pathParams.courseId && resource.includes("/enrollments")) {
      if (method === "GET") {
        return await handleListEnrollments(caller!, pathParams.courseId!);
      }
      if (method === "POST") {
        return await handleAddEnrollment(caller!, pathParams.courseId!, event.body);
      }
      if (method === "DELETE" && pathParams.studentUserId) {
        return await handleRemoveEnrollment(
          caller!,
          pathParams.courseId!,
          pathParams.studentUserId
        );
      }
    }

    // ── Course status ──
    if (method === "PUT" && pathParams.courseId && resource.includes("/status")) {
      return await handleUpdateStatus(caller!, pathParams.courseId!, event.body);
    }

    // ── Course CRUD ──
    if (pathParams.courseId) {
      if (method === "GET") return await handleGetCourse(caller!, pathParams.courseId!);
      if (method === "PUT") return await handleUpdateCourse(caller!, pathParams.courseId!, event.body);
      if (method === "DELETE") return await handleArchiveCourse(caller!, pathParams.courseId!);
    }

    if (method === "GET") return await handleListCourses(caller!);
    if (method === "POST") return await handleCreateCourse(caller!, event.body);

    return methodNotAllowedResponse(["GET", "POST", "PUT", "DELETE", "OPTIONS"]);
  } catch (error) {
    console.error("course-function unhandled error", error);
    return serverErrorResponse("Internal server error");
  }
};

// ───────────── Course CRUD ─────────────

async function handleListCourses(caller: { userId: string; role: string }) {
  if (caller.role === "admin") {
    const result = await dynamo.send(new ScanCommand({ TableName: COURSE_TABLE }));
    return createResponse(HTTP_STATUS.OK, { courses: result.Items || [] });
  }

  if (caller.role === "faculty" || caller.role === "simulation_designer") {
    const instructorScan = await dynamo.send(
      new ScanCommand({
        TableName: COURSE_INSTRUCTOR_TABLE,
        FilterExpression: "facultyUserId = :u",
        ExpressionAttributeValues: { ":u": caller.userId },
      })
    );
    const courseIds = (instructorScan.Items || []).map((row) => row.courseId);
    const courses = [];
    for (const courseId of courseIds) {
      const course = await getItem(COURSE_TABLE, { courseId }, dynamo);
      if (course) courses.push(course);
    }
    return createResponse(HTTP_STATUS.OK, { courses });
  }

  // Student: list courses they are explicitly enrolled in (status=active)
  // PLUS any published default courses (auto-visible to every student).
  const enrollments = await dynamo.send(
    new ScanCommand({
      TableName: COURSE_ENROLLMENT_TABLE,
      FilterExpression: "studentUserId = :u AND #s = :s",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":u": caller.userId, ":s": "active" },
    })
  );
  const courseIds = (enrollments.Items || []).map((row) => row.courseId);
  const seen = new Set<string>();
  const courses: any[] = [];
  for (const courseId of courseIds) {
    const course = await getItem(COURSE_TABLE, { courseId }, dynamo);
    if (course && course.status === "published") {
      seen.add(courseId);
      courses.push(course);
    }
  }
  // Default-course union: scan for isDefault published courses and merge.
  const defaultScan = await dynamo.send(
    new ScanCommand({
      TableName: COURSE_TABLE,
      FilterExpression: "isDefault = :t AND #s = :p",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":t": true, ":p": "published" },
    })
  );
  for (const course of defaultScan.Items || []) {
    if (!seen.has(course.courseId)) {
      seen.add(course.courseId);
      courses.push(course);
    }
  }
  return createResponse(HTTP_STATUS.OK, { courses });
}

async function handleGetCourse(caller: { userId: string; role: string }, courseId: string) {
  const course = await getItem(COURSE_TABLE, { courseId }, dynamo);
  if (!course) return notFoundResponse("Course not found");
  const accessError = await requireCourseAccess(caller as any, courseId, dynamo);
  if (accessError) return accessError;
  if (caller.role === "student" && course.status !== "published") {
    return notFoundResponse("Course not found");
  }
  return createResponse(HTTP_STATUS.OK, course);
}

async function handleCreateCourse(caller: { userId: string; role: string }, body: string | null) {
  if (
    caller.role !== "faculty" &&
    caller.role !== "admin" &&
    caller.role !== "simulation_designer"
  ) {
    return createResponse(HTTP_STATUS.FORBIDDEN, {
      error: "Only faculty, simulation_designer, or admin can create courses",
    });
  }
  const payload = parseJsonBody(body);
  const { title, description, groupConfig, isDefault } = payload;
  if (typeof title !== "string" || !title.trim()) {
    return badRequestResponse("title is required");
  }
  const now = generateTimestamp();
  const courseId = generateId();
  const course = {
    courseId,
    ownerFacultyId: caller.userId,
    title: title.trim(),
    description: description || "",
    status: "draft",
    groupConfig: groupConfig || {},
    isDefault: !!isDefault,
    createdAt: now,
    updatedAt: now,
  };
  await putItem(COURSE_TABLE, course, dynamo);
  // simulation_designer is a course coordinator, not a professor:
  // they manage the course but won't show up as an instructor.
  // The two professors (owner + co_teacher) get added later via /instructors.
  // faculty / admin creators are immediately the owner instructor.
  const initialRole =
    caller.role === "simulation_designer" ? "coordinator" : "owner";
  await putItem(
    COURSE_INSTRUCTOR_TABLE,
    {
      courseId,
      facultyUserId: caller.userId,
      role: initialRole,
      addedAt: now,
      addedBy: caller.userId,
    },
    dynamo
  );
  return createResponse(HTTP_STATUS.CREATED, course);
}

async function handleUpdateCourse(
  caller: { userId: string; role: string },
  courseId: string,
  body: string | null
) {
  const existing = await getItem(COURSE_TABLE, { courseId }, dynamo);
  if (!existing) return notFoundResponse("Course not found");
  const authError = await requireCourseInstructor(caller as any, courseId, dynamo);
  if (authError) return authError;

  const payload = parseJsonBody(body);
  delete payload.courseId;
  delete payload.ownerFacultyId;
  delete payload.createdAt;

  const updated = {
    ...existing,
    ...payload,
    updatedAt: generateTimestamp(),
  };
  await putItem(COURSE_TABLE, updated, dynamo);
  return createResponse(HTTP_STATUS.OK, updated);
}

async function handleUpdateStatus(
  caller: { userId: string; role: string },
  courseId: string,
  body: string | null
) {
  const existing = await getItem(COURSE_TABLE, { courseId }, dynamo);
  if (!existing) return notFoundResponse("Course not found");
  const authError = await requireCourseInstructor(caller as any, courseId, dynamo);
  if (authError) return authError;
  const payload = parseJsonBody(body);
  const status = payload.status;
  if (!["draft", "published", "archived"].includes(status)) {
    return badRequestResponse("status must be 'draft', 'published', or 'archived'");
  }
  const updated = { ...existing, status, updatedAt: generateTimestamp() };
  await putItem(COURSE_TABLE, updated, dynamo);
  return createResponse(HTTP_STATUS.OK, updated);
}

async function handleArchiveCourse(
  caller: { userId: string; role: string },
  courseId: string
) {
  const existing = await getItem(COURSE_TABLE, { courseId }, dynamo);
  if (!existing) return notFoundResponse("Course not found");
  const authError = await requireCourseOwner(caller as any, courseId, dynamo);
  if (authError) return authError;
  const updated = { ...existing, status: "archived", updatedAt: generateTimestamp() };
  await putItem(COURSE_TABLE, updated, dynamo);
  return createResponse(HTTP_STATUS.OK, updated);
}

// ───────────── Instructors ─────────────

async function handleListInstructors(caller: any, courseId: string) {
  const course = await getItem(COURSE_TABLE, { courseId }, dynamo);
  if (!course) return notFoundResponse("Course not found");
  const authError = await requireCourseAccess(caller, courseId, dynamo);
  if (authError) return authError;
  const instructors = await listCourseInstructors(dynamo, courseId);
  return createResponse(HTTP_STATUS.OK, { instructors });
}

async function handleAddInstructor(caller: any, courseId: string, body: string | null) {
  const course = await getItem(COURSE_TABLE, { courseId }, dynamo);
  if (!course) return notFoundResponse("Course not found");
  const authError = await requireCourseOwner(caller, courseId, dynamo);
  if (authError) return authError;
  const payload = parseJsonBody(body);
  const email = typeof payload.facultyEmail === "string" ? payload.facultyEmail.trim() : "";
  if (!email) return badRequestResponse("facultyEmail is required");

  // The two professor slots are owner + co_teacher; coordinator (simulation_designer)
  // is tracked separately and doesn't count toward the 2-professor limit.
  const existing = await listCourseInstructors(dynamo, courseId);
  const ownerCount = existing.filter((i) => i.role === "owner").length;
  const coTeacherCount = existing.filter((i) => i.role === "co_teacher").length;
  if (ownerCount >= 1 && coTeacherCount >= 1) {
    return conflictResponse(
      "Course already has both professors (owner + co-teacher). Remove one first."
    );
  }

  // Resolve email -> Cognito sub via ListUsers. Only faculty/admin can be
  // added as professors; simulation_designer cannot become an "instructor"
  // — they are added as coordinators only when they create the course.
  if (!USER_POOL_ID) return serverErrorResponse("USER_POOL_ID not configured");
  const lookup = await cognito.send(
    new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Filter: `email = "${email.replace(/"/g, '\\"')}"`,
      Limit: 5,
    })
  );
  const user = (lookup.Users || []).find((u) => {
    const role = u.Attributes?.find((a) => a.Name === "custom:role")?.Value;
    return role === "faculty" || role === "admin";
  });
  if (!user) {
    return badRequestResponse(
      "No faculty/admin user found with that email. Course instructors must be professors."
    );
  }
  const sub = user.Attributes?.find((a) => a.Name === "sub")?.Value;
  if (!sub) return serverErrorResponse("Resolved Cognito user has no sub");

  if (existing.some((i) => i.facultyUserId === sub)) {
    return conflictResponse("That user is already an instructor of this course");
  }

  // First professor added becomes owner; second becomes co_teacher.
  const newRole: "owner" | "co_teacher" = ownerCount === 0 ? "owner" : "co_teacher";

  const now = generateTimestamp();
  const row = {
    courseId,
    facultyUserId: sub,
    role: newRole,
    addedAt: now,
    addedBy: caller.userId,
  };
  await putItem(COURSE_INSTRUCTOR_TABLE, row, dynamo);

  // If this is the first owner being added (course was created by SD coordinator),
  // backfill Course.ownerFacultyId to point at the actual owner so downstream
  // ownership-by-fk lookups work.
  if (newRole === "owner" && course.ownerFacultyId !== sub) {
    if (caller.role === "simulation_designer" || ownerCount === 0) {
      await putItem(
        COURSE_TABLE,
        { ...course, ownerFacultyId: sub, updatedAt: now },
        dynamo
      );
    }
  }

  return createResponse(HTTP_STATUS.CREATED, row);
}

async function handleRemoveInstructor(
  caller: any,
  courseId: string,
  facultyUserId: string
) {
  const course = await getItem(COURSE_TABLE, { courseId }, dynamo);
  if (!course) return notFoundResponse("Course not found");
  const authError = await requireCourseOwner(caller, courseId, dynamo);
  if (authError) return authError;
  const row = await getItem(
    COURSE_INSTRUCTOR_TABLE,
    { courseId, facultyUserId },
    dynamo
  );
  if (!row) return notFoundResponse("Instructor row not found");
  // Coordinator (simulation_designer) cannot be removed via this endpoint —
  // they're tied to course creation and managed implicitly. Owner can be
  // removed only after a co_teacher exists who would then become owner;
  // otherwise the course would be left with no professor.
  if (row.role === "coordinator") {
    return badRequestResponse(
      "Cannot remove a course coordinator (simulation_designer)"
    );
  }
  if (row.role === "owner") {
    const all = await listCourseInstructors(dynamo, courseId);
    const coTeacher = all.find((i) => i.role === "co_teacher");
    if (!coTeacher) {
      return badRequestResponse(
        "Cannot remove the course owner: course must always have at least one professor. Add a co-teacher first or remove the co-teacher to swap roles."
      );
    }
    // Promote co_teacher to owner before removing the current owner.
    const promoted = { ...coTeacher, role: "owner", addedAt: generateTimestamp() };
    await putItem(COURSE_INSTRUCTOR_TABLE, promoted, dynamo);
    // Sync Course.ownerFacultyId to the new owner.
    await putItem(
      COURSE_TABLE,
      { ...course, ownerFacultyId: coTeacher.facultyUserId, updatedAt: generateTimestamp() },
      dynamo
    );
  }
  await deleteItem(COURSE_INSTRUCTOR_TABLE, { courseId, facultyUserId }, dynamo);
  return createResponse(HTTP_STATUS.OK, { removed: true });
}

/**
 * PUT /courses/{courseId}/instructors/{facultyUserId}/role
 *
 * Change an instructor's role. Two access patterns:
 *  - admin can change any role to any role
 *  - simulation_designer can convert their own row from "owner" to "coordinator"
 *    (legacy data fix: SD-created courses before the coordinator concept existed
 *    have the SD as role=owner; this lets them migrate themselves out)
 */
async function handleUpdateInstructorRole(
  caller: any,
  courseId: string,
  facultyUserId: string,
  body: string | null
) {
  const course = await getItem(COURSE_TABLE, { courseId }, dynamo);
  if (!course) return notFoundResponse("Course not found");
  const row = await getItem(
    COURSE_INSTRUCTOR_TABLE,
    { courseId, facultyUserId },
    dynamo
  );
  if (!row) return notFoundResponse("Instructor row not found");

  const payload = parseJsonBody(body);
  const nextRole = payload?.role;
  if (!["owner", "co_teacher", "coordinator"].includes(nextRole)) {
    return badRequestResponse("role must be 'owner', 'co_teacher', or 'coordinator'");
  }

  // Admin: anything goes.
  // simulation_designer self-service: only own row, owner → coordinator transition.
  const isSelfDemote =
    caller.role === "simulation_designer" &&
    facultyUserId === caller.userId &&
    row.role === "owner" &&
    nextRole === "coordinator";

  if (caller.role !== "admin" && !isSelfDemote) {
    return createResponse(HTTP_STATUS.FORBIDDEN, {
      error:
        "Only admin can change instructor roles, except a simulation_designer converting their own owner row to coordinator.",
    });
  }

  const now = generateTimestamp();
  const updated = { ...row, role: nextRole, addedAt: now };
  await putItem(COURSE_INSTRUCTOR_TABLE, updated, dynamo);

  // If we just demoted the owner to coordinator, the course currently has no
  // owner. Clear Course.ownerFacultyId so it no longer points at a non-instructor.
  // (The next faculty added via /instructors will become owner and backfill this.)
  if (row.role === "owner" && nextRole !== "owner") {
    if (course.ownerFacultyId === facultyUserId) {
      await putItem(
        COURSE_TABLE,
        { ...course, ownerFacultyId: null, updatedAt: now },
        dynamo
      );
    }
  }

  return createResponse(HTTP_STATUS.OK, { instructor: updated });
}

// ───────────── Student's own groups in a course ─────────────

async function handleListMyGroups(caller: any, courseId: string) {
  if (!STUDENT_GROUP_ASSIGNMENT_TABLE) {
    return createResponse(HTTP_STATUS.OK, { groups: [] });
  }
  // Caller must be either a student in the course (or a default course),
  // or an instructor / admin (so they can debug; but only their own groups).
  const accessError = await requireCourseAccess(caller, courseId, dynamo);
  if (accessError) return accessError;

  const result = await dynamo.send(
    new ScanCommand({
      TableName: STUDENT_GROUP_ASSIGNMENT_TABLE,
      FilterExpression: "courseId = :c AND studentUserId = :u",
      ExpressionAttributeValues: { ":c": courseId, ":u": caller.userId },
    })
  );
  const groups = (result.Items || []).map((row) => ({
    scopeKey: row.scopeKey,
    groupKey: row.groupKey,
    assignedByItemId: row.assignedByItemId,
    assignedAt: row.assignedAt,
  }));
  return createResponse(HTTP_STATUS.OK, { groups });
}

async function handleListGroupAssignments(caller: any, courseId: string) {
  if (!STUDENT_GROUP_ASSIGNMENT_TABLE) {
    return createResponse(HTTP_STATUS.OK, { assignments: [] });
  }
  const authError = await requireCourseInstructor(caller, courseId, dynamo);
  if (authError) return authError;

  const result = await dynamo.send(
    new ScanCommand({
      TableName: STUDENT_GROUP_ASSIGNMENT_TABLE,
      FilterExpression: "courseId = :c",
      ExpressionAttributeValues: { ":c": courseId },
    })
  );
  const assignments = (result.Items || []).map((row) => ({
    courseId: row.courseId,
    studentUserId: row.studentUserId,
    scopeKey: row.scopeKey,
    groupKey: row.groupKey,
    assignedByItemId: row.assignedByItemId,
    assignedAt: row.assignedAt,
  }));
  return createResponse(HTTP_STATUS.OK, { assignments });
}

// ───────────── Enrollments ─────────────

async function handleListEnrollments(caller: any, courseId: string) {
  const course = await getItem(COURSE_TABLE, { courseId }, dynamo);
  if (!course) return notFoundResponse("Course not found");
  const authError = await requireCourseInstructor(caller, courseId, dynamo);
  if (authError) return authError;
  const result = await dynamo.send(
    new ScanCommand({
      TableName: COURSE_ENROLLMENT_TABLE,
      FilterExpression: "courseId = :c",
      ExpressionAttributeValues: { ":c": courseId },
    })
  );
  return createResponse(HTTP_STATUS.OK, { enrollments: result.Items || [] });
}

async function handleAddEnrollment(caller: any, courseId: string, body: string | null) {
  const course = await getItem(COURSE_TABLE, { courseId }, dynamo);
  if (!course) return notFoundResponse("Course not found");
  const authError = await requireCourseInstructor(caller, courseId, dynamo);
  if (authError) return authError;

  const payload = parseJsonBody(body);
  // Accept either single email or an array of emails (bulk add).
  const emails: string[] = Array.isArray(payload.emails)
    ? payload.emails
    : payload.studentEmail
      ? [payload.studentEmail]
      : [];
  if (emails.length === 0) {
    return badRequestResponse("Provide studentEmail or emails[]");
  }
  if (!USER_POOL_ID) return serverErrorResponse("USER_POOL_ID not configured");

  const results: any[] = [];
  for (const raw of emails) {
    const email = typeof raw === "string" ? raw.trim() : "";
    if (!email) continue;
    const lookup = await findStudentByEmail(email);
    if ("error" in lookup) {
      results.push({ email, status: "not_found", reason: lookup.error });
      continue;
    }
    const now = generateTimestamp();
    const enrollment = {
      courseId,
      studentUserId: lookup.sub,
      studentEmail: lookup.email,
      enrolledAt: now,
      enrolledBy: caller.userId,
      status: "active",
    };
    await putItem(COURSE_ENROLLMENT_TABLE, enrollment, dynamo);
    results.push({ email, status: "enrolled", enrollment });
  }
  return createResponse(HTTP_STATUS.OK, { results });
}

/**
 * Robust student lookup:
 *  1. Try Cognito ListUsers with `email = "..."` (exact)
 *  2. Fallback: `username = "..."` (some Cognito setups store email as username)
 *  3. Fallback: `email ^= "..."` (prefix; helpful when there's a trailing space or
 *     different casing in stored email)
 *  4. If candidates found but none has custom:role=student, surface a helpful
 *     "user exists but role is X" message instead of a vague "not found"
 */
async function findStudentByEmail(
  email: string
): Promise<{ sub: string; email: string } | { error: string }> {
  if (!USER_POOL_ID) return { error: "USER_POOL_ID not configured" };
  const escaped = email.replace(/"/g, '\\"');

  const exact = await cognito.send(
    new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Filter: `email = "${escaped}"`,
      Limit: 5,
    })
  );
  let candidates = exact.Users || [];

  if (candidates.length === 0) {
    const byUsername = await cognito.send(
      new ListUsersCommand({
        UserPoolId: USER_POOL_ID,
        Filter: `username = "${escaped}"`,
        Limit: 5,
      })
    );
    candidates = byUsername.Users || [];
  }

  if (candidates.length === 0) {
    const prefix = await cognito.send(
      new ListUsersCommand({
        UserPoolId: USER_POOL_ID,
        Filter: `email ^= "${escaped}"`,
        Limit: 5,
      })
    );
    candidates = prefix.Users || [];
  }

  if (candidates.length === 0) {
    return { error: `No Cognito user matched email="${email}" (tried exact email, username, and prefix)` };
  }

  // Treat empty / missing custom:role as "student" — Cognito self-signups via
  // Amplify Authenticator don't get a role attribute set automatically, and the
  // frontend already does the same fallback in App.tsx.
  // Reject only when role is explicitly faculty / admin / simulation_designer.
  const isStudentLike = (u: any) => {
    const r = u.Attributes?.find((a: any) => a.Name === "custom:role")?.Value;
    return !r || r === "" || r === "student";
  };
  const studentCandidate = candidates.find(isStudentLike);

  if (!studentCandidate) {
    const first = candidates[0];
    const actualRole =
      first.Attributes?.find((a: any) => a.Name === "custom:role")?.Value || "(none)";
    const actualEmail =
      first.Attributes?.find((a: any) => a.Name === "email")?.Value || first.Username;
    return {
      error: `User exists (email="${actualEmail}") but custom:role="${actualRole}". Cannot enroll a non-student account. Change the role in Admin → Users & Roles first.`,
    };
  }

  const sub = studentCandidate.Attributes?.find((a: any) => a.Name === "sub")?.Value;
  if (!sub) {
    return { error: "Cognito user found but missing sub attribute (data integrity issue)" };
  }
  const actualEmail =
    studentCandidate.Attributes?.find((a: any) => a.Name === "email")?.Value || email;
  return { sub, email: actualEmail };
}

async function handleRemoveEnrollment(
  caller: any,
  courseId: string,
  studentUserId: string
) {
  const course = await getItem(COURSE_TABLE, { courseId }, dynamo);
  if (!course) return notFoundResponse("Course not found");
  const authError = await requireCourseInstructor(caller, courseId, dynamo);
  if (authError) return authError;
  const row = await getItem(
    COURSE_ENROLLMENT_TABLE,
    { courseId, studentUserId },
    dynamo
  );
  if (!row) return notFoundResponse("Enrollment not found");
  await putItem(
    COURSE_ENROLLMENT_TABLE,
    { ...row, status: "removed" },
    dynamo
  );
  return createResponse(HTTP_STATUS.OK, { removed: true });
}
