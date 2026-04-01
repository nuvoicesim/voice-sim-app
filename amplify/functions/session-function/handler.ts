import type { APIGatewayProxyHandler } from "aws-lambda";
import { timingSafeEqual } from "crypto";
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
  issueRuntimeToken,
  requireRuntimeTokenClaims,
  RuntimeTokenError,
} from "../shared";
import { extractCallerIdentity, requireRole, type CallerIdentity } from "../shared/auth-middleware";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";

const SESSION_TABLE = process.env.TABLE_NAME;
const ASSIGNMENT_TABLE = process.env.ASSIGNMENT_TABLE_NAME;
const SCENE_CATALOG_TABLE = process.env.SCENE_CATALOG_TABLE_NAME;
const UNITY_BUILD_TABLE = process.env.UNITY_BUILD_TABLE_NAME;
const ENROLLMENT_TABLE = process.env.ENROLLMENT_TABLE_NAME;
const TURN_TABLE = process.env.TURN_TABLE_NAME;
const EVALUATION_TABLE = process.env.EVALUATION_TABLE_NAME;
const RUNTIME_TOKEN_SECRET = process.env.RUNTIME_TOKEN_SECRET ?? "";
const RUNTIME_TOKEN_TTL_SECONDS = Number(process.env.RUNTIME_TOKEN_TTL_SECONDS ?? "1800");
const UNITY_DEV_BOOTSTRAP_ENABLED = (process.env.UNITY_DEV_BOOTSTRAP_ENABLED ?? "false").toLowerCase() === "true";
const UNITY_DEV_BOOTSTRAP_KEY = process.env.UNITY_DEV_BOOTSTRAP_KEY ?? "";
const dynamo = createDynamoDbClient();

interface SessionRecord {
  sessionId: string;
  assignmentId: string;
  studentUserId: string;
  attemptNo: number;
  mode: string;
  status: "active" | "completed" | "abandoned";
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
}

interface SessionView extends SessionRecord {
  sceneId?: string;
  unityBuildId?: string | null;
  unityLaunchUrl?: string | null;
  unityBuildFolder?: string | null;
}

interface AssignmentLaunchConfig {
  sceneId: string;
  unityBuildId: string;
  unityLaunchUrl: string;
}

interface SessionTurnRecord {
  sessionId: string;
  turnIndex: number;
  userText: string;
  modelText: string;
  emotionCode: number;
  motionCode: number;
  latencyMs: number;
  timestamp: string;
}

interface SessionStartOutcome {
  session: SessionRecord;
  resumed: boolean;
}

async function getAssignmentStatus(assignmentId: string): Promise<string | null> {
  if (!ASSIGNMENT_TABLE) {
    return null;
  }

  const assignment = await getItem(ASSIGNMENT_TABLE, { assignmentId }, dynamo);
  return typeof assignment?.status === "string" ? assignment.status : null;
}

async function isStudentLaunchableAssignment(assignmentId: string): Promise<boolean> {
  const status = await getAssignmentStatus(assignmentId);
  return status === "published";
}

async function canStudentViewSession(session: SessionRecord): Promise<boolean> {
  const status = await getAssignmentStatus(session.assignmentId);
  return status === "published" || session.status === "completed";
}

function toSessionRecord(item: Record<string, unknown>): SessionRecord | null {
  const { sessionId, assignmentId, studentUserId, attemptNo, mode, status, startedAt, endedAt, createdAt } = item;

  if (
    typeof sessionId !== "string" ||
    typeof assignmentId !== "string" ||
    typeof studentUserId !== "string" ||
    typeof attemptNo !== "number" ||
    typeof mode !== "string" ||
    (status !== "active" && status !== "completed" && status !== "abandoned") ||
    typeof startedAt !== "string" ||
    typeof createdAt !== "string"
  ) {
    return null;
  }

  return {
    sessionId,
    assignmentId,
    studentUserId,
    attemptNo,
    mode,
    status,
    startedAt,
    endedAt: typeof endedAt === "string" ? endedAt : null,
    createdAt,
  };
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const method = event.httpMethod;
  const pathParams = event.pathParameters;
  const resource = event.resource ?? "";
  const isSessionListRequest = method === "GET" && !pathParams?.sessionId && !pathParams?.assignmentId;

  if (method === "OPTIONS") return optionsResponse();

  if (isSessionListRequest) {
    const authorizer = event.requestContext.authorizer as { claims?: Record<string, unknown> } | undefined;
    console.log("session auth diagnostic", {
      path: event.path,
      method,
      hasAuthorizationHeader: Boolean(event.headers?.authorization || event.headers?.Authorization),
      hasAuthorizer: Boolean(authorizer),
      hasClaims: Boolean(authorizer?.claims),
      claimKeys: authorizer?.claims ? Object.keys(authorizer.claims).sort() : [],
    });
  }

  try {
    // POST /sessions/dev-bootstrap
    if (method === "POST" && resource.includes("/dev-bootstrap")) {
      return await handleDevBootstrap(event.headers ?? undefined, event.body);
    }

    // POST /sessions/{sessionId}/runtime-token
    if (method === "POST" && pathParams?.sessionId && resource.includes("/runtime-token")) {
      const caller = await extractCallerIdentity(event);
      const authError = requireRole(caller, ["student"]);
      if (authError) return authError;
      return await handleIssueRuntimeToken(pathParams.sessionId, caller!.userId, event.body);
    }

    // PUT /sessions/{sessionId}/complete
    if (method === "PUT" && pathParams?.sessionId && resource.includes("/complete")) {
      try {
        const runtimeClaims = requireRuntimeTokenClaims(event.headers ?? undefined, RUNTIME_TOKEN_SECRET);
        if (runtimeClaims.sessionId !== pathParams.sessionId) {
          return createResponse(HTTP_STATUS.CONFLICT, {
            error: "sessionId does not match runtime token",
          });
        }
        return await handleCompleteSession(pathParams.sessionId, runtimeClaims.sub);
      } catch (error) {
        if (error instanceof RuntimeTokenError) {
          return createResponse(error.statusCode, { error: error.message });
        }
        throw error;
      }
    }

    // GET /sessions/{sessionId}
    if (method === "GET" && pathParams?.sessionId) {
      const caller = await extractCallerIdentity(event);
      const authError = requireRole(caller, ["student", "faculty", "admin"]);
      if (authError) return authError;
      return await handleGetSession(pathParams.sessionId, caller!);
    }

    // GET /assignments/{assignmentId}/sessions
    if (method === "GET" && pathParams?.assignmentId) {
      const caller = await extractCallerIdentity(event);
      const authError = requireRole(caller, ["student", "faculty", "admin"]);
      if (authError) return authError;
      const params = getQueryParams(event.queryStringParameters);
      return await handleListSessionsByAssignment(pathParams.assignmentId, caller!, params);
    }

    // POST /sessions — start a new attempt
    if (method === "POST") {
      const caller = await extractCallerIdentity(event);
      const authError = requireRole(caller, ["student"]);
      if (authError) return authError;
      return await handleStartSession(caller!.userId, event.body);
    }

    // GET /sessions (list for current student)
    if (method === "GET") {
      const caller = await extractCallerIdentity(event);
      return await handleListMySessions(caller);
    }

    return methodNotAllowedResponse(["GET", "POST", "PUT", "OPTIONS"]);
  } catch (error) {
    console.error("Unhandled error:", error);
    return serverErrorResponse("Internal server error");
  }
};

async function handleIssueRuntimeToken(
  sessionId: string,
  studentUserId: string,
  body: string | null
) {
  const session = await getItem(SESSION_TABLE, { sessionId }, dynamo);
  if (!session) {
    return notFoundResponse("Session not found");
  }

  if (session.studentUserId !== studentUserId) {
    return createResponse(HTTP_STATUS.FORBIDDEN, { error: "Cannot issue token for another student's session" });
  }

  if (session.status !== "active") {
    return conflictResponse("Session is not active");
  }

  if (!(await isStudentLaunchableAssignment(session.assignmentId))) {
    return notFoundResponse("Session not found");
  }

  if (!(await resolveAssignmentLaunchConfig(session.assignmentId))) {
    return conflictResponse("Session requires a published Unity build before runtime can start");
  }

  const client = resolveRequestedClient(body);
  if (typeof client !== "string") {
    return client;
  }

  try {
    return createResponse(HTTP_STATUS.OK, buildRuntimeTokenPayload(session, studentUserId, client));
  } catch (error) {
    if (error instanceof RuntimeTokenError) {
      return createResponse(error.statusCode, { error: error.message });
    }
    console.error("Failed to issue runtime token:", error);
    return serverErrorResponse("Failed to issue runtime token");
  }
}

async function handleStartSession(studentUserId: string, body: string | null) {
  const payload = parseJsonBody(body);
  const { assignmentId } = payload;

  if (!assignmentId) {
    return badRequestResponse("Missing required field: assignmentId");
  }

  const outcome = await startOrResumeSession(assignmentId, studentUserId);
  if ("statusCode" in outcome) {
    return outcome;
  }

  return createResponse(outcome.resumed ? HTTP_STATUS.OK : HTTP_STATUS.CREATED, {
    message: outcome.resumed ? "Resuming existing active session" : undefined,
    session: await enrichSessionForLaunch(outcome.session),
  });
}

async function handleDevBootstrap(
  headers: Record<string, string | undefined> | undefined,
  body: string | null
) {
  if (!UNITY_DEV_BOOTSTRAP_ENABLED || !UNITY_DEV_BOOTSTRAP_KEY.trim()) {
    return notFoundResponse("Session bootstrap is not available");
  }

  if (!hasValidDevBootstrapKey(headers)) {
    return createResponse(HTTP_STATUS.UNAUTHORIZED, {
      error: "Invalid dev bootstrap key",
    });
  }

  const payload = parseJsonBody(body);
  const assignmentId = typeof payload.assignmentId === "string" ? payload.assignmentId.trim() : "";
  const studentUserId = typeof payload.studentUserId === "string" ? payload.studentUserId.trim() : "";

  if (!assignmentId) {
    return badRequestResponse("Missing required field: assignmentId");
  }

  if (!studentUserId) {
    return badRequestResponse("Missing required field: studentUserId");
  }

  const client = resolveRequestedClient(body);
  if (typeof client !== "string") {
    return client;
  }

  const outcome = await startOrResumeSession(assignmentId, studentUserId);
  if ("statusCode" in outcome) {
    return outcome;
  }

  try {
    return createResponse(HTTP_STATUS.OK, {
      ...buildRuntimeTokenPayload(outcome.session, studentUserId, client),
      mode: "dev-bootstrap",
      message: outcome.resumed ? "Resuming existing active session" : "Created new active session",
      session: await enrichSessionForLaunch(outcome.session),
    });
  } catch (error) {
    if (error instanceof RuntimeTokenError) {
      return createResponse(error.statusCode, { error: error.message });
    }
    console.error("Failed to issue dev bootstrap runtime token:", error);
    return serverErrorResponse("Failed to issue runtime token");
  }
}

function resolveRequestedClient(body: string | null) {
  let client = "unity-webgl";
  if (body) {
    const payload = parseJsonBody(body);
    if (payload.client && typeof payload.client !== "string") {
      return badRequestResponse("client must be a string");
    }
    if (typeof payload.client === "string" && payload.client.trim() !== "") {
      client = payload.client.trim();
    }
  }

  return client;
}

function buildRuntimeTokenPayload(
  session: SessionRecord,
  studentUserId: string,
  client: string
) {
  const { token, claims } = issueRuntimeToken(
    {
      sub: studentUserId,
      role: "student",
      assignmentId: session.assignmentId,
      sessionId: session.sessionId,
      client,
    },
    RUNTIME_TOKEN_SECRET,
    RUNTIME_TOKEN_TTL_SECONDS
  );

  const expiresAt = new Date(claims.exp * 1000).toISOString();
  const refreshSkewSeconds = Math.min(300, Math.max(60, Math.floor(RUNTIME_TOKEN_TTL_SECONDS / 4)));
  const refreshAfter = new Date((claims.exp - refreshSkewSeconds) * 1000).toISOString();

  return {
    tokenType: "Bearer",
    runtimeToken: token,
    expiresAt,
    refreshAfter,
    session: {
      sessionId: session.sessionId,
      assignmentId: session.assignmentId,
      status: session.status,
      attemptNo: session.attemptNo,
    },
  };
}

function getHeaderValue(
  headers: Record<string, string | undefined> | undefined,
  name: string
): string | null {
  if (!headers) {
    return null;
  }

  const expectedName = name.toLowerCase();
  for (const [headerName, value] of Object.entries(headers)) {
    if (headerName.toLowerCase() === expectedName && typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }

  return null;
}

function hasValidDevBootstrapKey(headers: Record<string, string | undefined> | undefined) {
  const providedKey = getHeaderValue(headers, "X-Dev-Bootstrap-Key");
  if (!providedKey) {
    return false;
  }

  const expectedBuffer = Buffer.from(UNITY_DEV_BOOTSTRAP_KEY, "utf8");
  const providedBuffer = Buffer.from(providedKey, "utf8");
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

async function startOrResumeSession(
  assignmentId: string,
  studentUserId: string
): Promise<SessionStartOutcome | ReturnType<typeof createResponse>> {

  // Look up the assignment to validate it exists and check attempt policy
  const assignment = await getItem(ASSIGNMENT_TABLE, { assignmentId }, dynamo);
  if (!assignment) return notFoundResponse("Assignment not found");
  if (assignment.status !== "published") {
    return badRequestResponse("Assignment is not published");
  }

  if (!(await resolveAssignmentLaunchConfig(assignmentId))) {
    return conflictResponse("Assignment requires a published Unity build before students can launch sessions");
  }

  // Count existing attempts by this student for this assignment
  const existingSessions = await findSessionsByAssignmentAndStudent(assignmentId, studentUserId);
  const completedAttempts = existingSessions.filter((session) => session.status === "completed").length;
  const activeSession = existingSessions.find((session) => session.status === "active");

  // If there's already an active session, return it
  if (activeSession) {
    return {
      session: activeSession,
      resumed: true,
    };
  }

  // Check attempt policy
  const maxAttempts = assignment.attemptPolicy?.maxAttempts ?? -1;
  if (maxAttempts > 0 && completedAttempts >= maxAttempts) {
    return conflictResponse(`Maximum attempts (${maxAttempts}) reached for this assignment`);
  }

  const now = generateTimestamp();
  const session: SessionRecord = {
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

  return {
    session,
    resumed: false,
  };
}

async function handleGetSession(
  sessionId: string,
  caller: CallerIdentity
) {
  const session = await getItem(SESSION_TABLE, { sessionId }, dynamo);
  if (!session) return notFoundResponse("Session not found");

  if (caller.role === "student" && session.studentUserId !== caller.userId) {
    return createResponse(HTTP_STATUS.FORBIDDEN, { error: "Cannot access another student's session" });
  }

  if (caller.role === "student" && !(await canStudentViewSession(session))) {
    return notFoundResponse("Session not found");
  }

  // Fetch turns
  let turns: SessionTurnRecord[] = [];
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

  return createResponse(HTTP_STATUS.OK, {
    session: await enrichSessionForLaunch(session),
    turns,
    evaluation,
  });
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
  return createResponse(HTTP_STATUS.OK, { session: await enrichSessionForLaunch(updated) });
}

async function handleListSessionsByAssignment(
  assignmentId: string,
  caller: CallerIdentity,
  params: Record<string, string>
) {
  const studentFilter = params.studentUserId;

  // For students, only show their own sessions
  const filterStudentId = caller?.role === "student" ? caller.userId : studentFilter;

  if (filterStudentId) {
    let sessions = await findSessionsByAssignmentAndStudent(assignmentId, filterStudentId);
    if (caller.role === "student") {
      sessions = (
        await Promise.all(
          sessions.map(async (session) => (await canStudentViewSession(session)) ? session : null)
        )
      ).filter((session): session is SessionRecord => session !== null);
    }
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
  caller: CallerIdentity | null
) {
  if (!caller) {
    return createResponse(HTTP_STATUS.UNAUTHORIZED, { error: "Authentication required" });
  }

  const result = await dynamo.send(new ScanCommand({
    TableName: SESSION_TABLE,
    FilterExpression: "studentUserId = :uid",
    ExpressionAttributeValues: { ":uid": caller.userId },
  }));

  const rawSessions = (result.Items || [])
    .map((item) => toSessionRecord(item))
    .filter((item): item is SessionRecord => item !== null);

  const visibleSessions = (
    await Promise.all(
      rawSessions.map(async (session) =>
        (await canStudentViewSession(session)) ? session : null
      )
    )
  ).filter((session): session is SessionRecord => session !== null);

  return createResponse(HTTP_STATUS.OK, { sessions: visibleSessions });
}

async function findSessionsByAssignmentAndStudent(
  assignmentId: string,
  studentUserId: string
): Promise<SessionRecord[]> {
  const result = await dynamo.send(new ScanCommand({
    TableName: SESSION_TABLE,
    FilterExpression: "assignmentId = :aid AND studentUserId = :uid",
    ExpressionAttributeValues: {
      ":aid": assignmentId,
      ":uid": studentUserId,
    },
  }));
  return (result.Items || [])
    .map((item) => toSessionRecord(item))
    .filter((item): item is SessionRecord => item !== null);
}

async function resolveAssignmentLaunchConfig(
  assignmentId: string
): Promise<AssignmentLaunchConfig | null> {
  if (!ASSIGNMENT_TABLE || !SCENE_CATALOG_TABLE || !UNITY_BUILD_TABLE) {
    return null;
  }

  const assignment = await getItem(ASSIGNMENT_TABLE, { assignmentId }, dynamo);
  if (!assignment?.sceneId || typeof assignment.sceneId !== "string") {
    return null;
  }

  const scene = await getItem(SCENE_CATALOG_TABLE, { sceneId: assignment.sceneId }, dynamo);
  if (!scene?.unityBuildId || typeof scene.unityBuildId !== "string" || scene.unityBuildId.trim() === "") {
    return null;
  }

  const unityBuild = await getItem(UNITY_BUILD_TABLE, { unityBuildId: scene.unityBuildId }, dynamo);
  const unityLaunchUrl =
    typeof unityBuild?.launchUrl === "string" && unityBuild.launchUrl.trim() !== ""
      ? unityBuild.launchUrl.trim()
      : null;

  if (!unityBuild || unityBuild.status !== "published" || !unityLaunchUrl) {
    return null;
  }

  return {
    sceneId: assignment.sceneId,
    unityBuildId: scene.unityBuildId.trim(),
    unityLaunchUrl,
  };
}

async function enrichSessionForLaunch(session: SessionRecord): Promise<SessionView> {
  if (!ASSIGNMENT_TABLE || !SCENE_CATALOG_TABLE) {
    return session;
  }

  try {
    const launchConfig = await resolveAssignmentLaunchConfig(session.assignmentId);
    if (!launchConfig) {
      return session;
    }

    return {
      ...session,
      sceneId: launchConfig.sceneId,
      unityBuildId: launchConfig.unityBuildId,
      unityLaunchUrl: launchConfig.unityLaunchUrl,
      unityBuildFolder: null,
    };
  } catch (error) {
    console.warn("Failed to enrich session with launch metadata:", error);
    return session;
  }
}
