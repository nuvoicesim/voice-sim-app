import type { APIGatewayProxyHandler } from "aws-lambda";
import {
  createResponse,
  optionsResponse,
  badRequestResponse,
  notFoundResponse,
  conflictResponse,
  methodNotAllowedResponse,
  serverErrorResponse,
  parseJsonBody,
  getQueryParams,
  HTTP_STATUS,
  createDynamoDbClient,
  getItem,
  putItem,
  generateId,
  generateTimestamp,
  queryItems,
} from "../shared";
import { extractCallerIdentity, requireRole } from "../shared/auth-middleware";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";

const SESSION_TABLE = process.env.TABLE_NAME;
const ASSIGNMENT_TABLE = process.env.ASSIGNMENT_TABLE_NAME;
const ENROLLMENT_TABLE = process.env.ENROLLMENT_TABLE_NAME;
const TURN_TABLE = process.env.TURN_TABLE_NAME;
const EVALUATION_TABLE = process.env.EVALUATION_TABLE_NAME;
const dynamo = createDynamoDbClient();

export const handler: APIGatewayProxyHandler = async (event) => {
  const method = event.httpMethod;
  const pathParams = event.pathParameters;

  if (method === "OPTIONS") return optionsResponse();

  try {
    // PUT /sessions/{sessionId}/complete
    if (method === "PUT" && pathParams?.sessionId && event.resource?.includes("/complete")) {
      const caller = extractCallerIdentity(event);
      const authError = requireRole(caller, ["student"]);
      if (authError) return authError;
      return await handleCompleteSession(pathParams.sessionId, caller!.userId);
    }

    // GET /sessions/{sessionId}
    if (method === "GET" && pathParams?.sessionId) {
      return await handleGetSession(pathParams.sessionId);
    }

    // GET /assignments/{assignmentId}/sessions
    if (method === "GET" && pathParams?.assignmentId) {
      const caller = extractCallerIdentity(event);
      const params = getQueryParams(event.queryStringParameters);
      return await handleListSessionsByAssignment(pathParams.assignmentId, caller, params);
    }

    // POST /sessions — start a new attempt
    if (method === "POST") {
      const caller = extractCallerIdentity(event);
      const authError = requireRole(caller, ["student"]);
      if (authError) return authError;
      return await handleStartSession(caller!.userId, event.body);
    }

    // GET /sessions (list for current student)
    if (method === "GET") {
      const caller = extractCallerIdentity(event);
      const params = getQueryParams(event.queryStringParameters);
      return await handleListMySessions(caller, params);
    }

    return methodNotAllowedResponse(["GET", "POST", "PUT", "OPTIONS"]);
  } catch (error) {
    console.error("Unhandled error:", error);
    return serverErrorResponse("Internal server error");
  }
};

async function handleStartSession(studentUserId: string, body: string | null) {
  const payload = parseJsonBody(body);
  const { assignmentId } = payload;

  if (!assignmentId) {
    return badRequestResponse("Missing required field: assignmentId");
  }

  // Look up the assignment to validate it exists and check attempt policy
  const assignment = await getItem(ASSIGNMENT_TABLE, { assignmentId }, dynamo);
  if (!assignment) return notFoundResponse("Assignment not found");
  if (assignment.status !== "published") {
    return badRequestResponse("Assignment is not published");
  }

  // Count existing attempts by this student for this assignment
  const existingSessions = await findSessionsByAssignmentAndStudent(assignmentId, studentUserId);
  const completedAttempts = existingSessions.filter((s: any) => s.status === "completed").length;
  const activeSession = existingSessions.find((s: any) => s.status === "active");

  // If there's already an active session, return it
  if (activeSession) {
    return createResponse(HTTP_STATUS.OK, {
      message: "Resuming existing active session",
      session: activeSession,
    });
  }

  // Check attempt policy
  const maxAttempts = assignment.attemptPolicy?.maxAttempts ?? -1;
  if (maxAttempts > 0 && completedAttempts >= maxAttempts) {
    return conflictResponse(`Maximum attempts (${maxAttempts}) reached for this assignment`);
  }

  const now = generateTimestamp();
  const session = {
    sessionId: generateId(),
    assignmentId,
    studentUserId,
    attemptNo: completedAttempts + 1,
    mode: assignment.mode,
    status: "active",
    startedAt: now,
    endedAt: null,
    createdAt: now,
  };

  await putItem(SESSION_TABLE, session, dynamo);

  // Update enrollment status
  if (ENROLLMENT_TABLE) {
    try {
      const enrollment = await getItem(ENROLLMENT_TABLE, { assignmentId, studentUserId }, dynamo);
      if (enrollment && enrollment.deliveryStatus === "assigned") {
        await putItem(ENROLLMENT_TABLE, {
          ...enrollment,
          deliveryStatus: "in_progress",
          startedAt: now,
          updatedAt: now,
        }, dynamo);
      }
    } catch (e) {
      console.warn("Failed to update enrollment status:", e);
    }
  }

  return createResponse(HTTP_STATUS.CREATED, { session });
}

async function handleGetSession(sessionId: string) {
  const session = await getItem(SESSION_TABLE, { sessionId }, dynamo);
  if (!session) return notFoundResponse("Session not found");

  // Fetch turns
  let turns: any[] = [];
  if (TURN_TABLE) {
    turns = await queryItems(
      TURN_TABLE,
      "sessionId = :sid",
      { ":sid": sessionId },
      dynamo,
      { scanIndexForward: true }
    );
  }

  // Fetch evaluation
  let evaluation = null;
  if (EVALUATION_TABLE) {
    evaluation = await getItem(EVALUATION_TABLE, { sessionId }, dynamo);
  }

  return createResponse(HTTP_STATUS.OK, { session, turns, evaluation });
}

async function handleCompleteSession(sessionId: string, studentUserId: string) {
  const session = await getItem(SESSION_TABLE, { sessionId }, dynamo);
  if (!session) return notFoundResponse("Session not found");

  if (session.studentUserId !== studentUserId) {
    return createResponse(HTTP_STATUS.FORBIDDEN, { error: "Cannot complete another student's session" });
  }

  if (session.status === "completed") {
    return conflictResponse("Session is already completed");
  }

  const now = generateTimestamp();
  const updated = {
    ...session,
    status: "completed",
    endedAt: now,
  };

  await putItem(SESSION_TABLE, updated, dynamo);
  return createResponse(HTTP_STATUS.OK, { session: updated });
}

async function handleListSessionsByAssignment(
  assignmentId: string,
  caller: ReturnType<typeof extractCallerIdentity>,
  params: Record<string, string>
) {
  const studentFilter = params.studentUserId;

  // For students, only show their own sessions
  const filterStudentId = caller?.role === "student" ? caller.userId : studentFilter;

  if (filterStudentId) {
    const sessions = await findSessionsByAssignmentAndStudent(assignmentId, filterStudentId);
    return createResponse(HTTP_STATUS.OK, { sessions });
  }

  // Faculty/admin: scan all sessions for this assignment
  const result = await dynamo.send(new ScanCommand({
    TableName: SESSION_TABLE,
    FilterExpression: "assignmentId = :aid",
    ExpressionAttributeValues: { ":aid": assignmentId },
  }));

  return createResponse(HTTP_STATUS.OK, { sessions: result.Items || [] });
}

async function handleListMySessions(
  caller: ReturnType<typeof extractCallerIdentity>,
  params: Record<string, string>
) {
  if (!caller) {
    return createResponse(HTTP_STATUS.UNAUTHORIZED, { error: "Authentication required" });
  }

  const result = await dynamo.send(new ScanCommand({
    TableName: SESSION_TABLE,
    FilterExpression: "studentUserId = :uid",
    ExpressionAttributeValues: { ":uid": caller.userId },
  }));

  return createResponse(HTTP_STATUS.OK, { sessions: result.Items || [] });
}

async function findSessionsByAssignmentAndStudent(assignmentId: string, studentUserId: string): Promise<any[]> {
  const result = await dynamo.send(new ScanCommand({
    TableName: SESSION_TABLE,
    FilterExpression: "assignmentId = :aid AND studentUserId = :uid",
    ExpressionAttributeValues: {
      ":aid": assignmentId,
      ":uid": studentUserId,
    },
  }));
  return result.Items || [];
}
