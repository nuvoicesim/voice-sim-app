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
  updateItem,
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
const SESSION_TASK_PROGRESS_TABLE = process.env.SESSION_TASK_PROGRESS_TABLE_NAME;
const SESSION_TASK_PROGRESS_BY_SESSION_INDEX =
  process.env.SESSION_TASK_PROGRESS_BY_SESSION_INDEX_NAME ?? "bySessionProgressKey";
// Course-LMS integration:
const MODULE_ITEM_TABLE = process.env.MODULE_ITEM_TABLE_NAME;
const STUDENT_ITEM_PROGRESS_TABLE = process.env.STUDENT_ITEM_PROGRESS_TABLE_NAME;
const EVENT_LOG_TABLE = process.env.EVENT_LOG_TABLE_NAME;
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
  userSpeechStartAt?: string;
  userSpeechEndAt?: string;
  patientSpeechStartAt?: string;
  patientSpeechEndAt?: string;
  emotionCode: number;
  motionCode: number;
  latencyMs: number;
  timestamp: string;
}

interface SessionTurnView extends SessionTurnRecord {
  userSpeechDurationMs?: number;
  patientSpeechDurationMs?: number;
}

interface SessionTaskProgressRecord {
  progressId: string;
  sessionId: string;
  progressKey: string;
  assignmentId: string;
  studentUserId: string;
  phaseId: string;
  sectionId?: string;
  taskId?: string;
  taskType?: string;
  state: "completed";
  completedAt: string;
  latestEvidenceId?: string;
  createdAt: string;
  updatedAt: string;
}

interface SessionStartOutcome {
  session: SessionRecord;
  resumed: boolean;
}

type TurnTimingField =
  | "userSpeechStartAt"
  | "userSpeechEndAt"
  | "patientSpeechStartAt"
  | "patientSpeechEndAt";
type RuntimeClaims = ReturnType<typeof requireRuntimeTokenClaims>;

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

    // GET /sessions/{sessionId}/task-progress
    if (method === "GET" && pathParams?.sessionId && resource.endsWith("/task-progress")) {
      try {
        const runtimeClaims = requireRuntimeTokenClaims(event.headers ?? undefined, RUNTIME_TOKEN_SECRET);
        if (runtimeClaims.sessionId !== pathParams.sessionId) {
          return createResponse(HTTP_STATUS.CONFLICT, {
            error: "sessionId does not match runtime token",
          });
        }
        return await handleListTaskProgress(pathParams.sessionId, runtimeClaims);
      } catch (error) {
        if (error instanceof RuntimeTokenError) {
          return createResponse(error.statusCode, { error: error.message });
        }
        throw error;
      }
    }

    // PUT /sessions/{sessionId}/task-progress/{progressKey}/complete
    if (
      method === "PUT" &&
      pathParams?.sessionId &&
      pathParams?.progressKey &&
      resource.includes("/task-progress/") &&
      resource.endsWith("/complete")
    ) {
      try {
        const runtimeClaims = requireRuntimeTokenClaims(event.headers ?? undefined, RUNTIME_TOKEN_SECRET);
        if (runtimeClaims.sessionId !== pathParams.sessionId) {
          return createResponse(HTTP_STATUS.CONFLICT, {
            error: "sessionId does not match runtime token",
          });
        }
        return await handleCompleteTaskProgress(
          pathParams.sessionId,
          pathParams.progressKey,
          runtimeClaims,
          event.body
        );
      } catch (error) {
        if (error instanceof RuntimeTokenError) {
          return createResponse(error.statusCode, { error: error.message });
        }
        throw error;
      }
    }

    // PUT /sessions/{sessionId}/complete
    if (method === "PUT" && pathParams?.sessionId && resource.includes("/complete") && !resource.includes("/task-progress/")) {
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

    // PUT /sessions/{sessionId}/turns/{turnIndex}
    if (method === "PUT" && pathParams?.sessionId && pathParams?.turnIndex && resource.includes("/turns/")) {
      try {
        const runtimeClaims = requireRuntimeTokenClaims(event.headers ?? undefined, RUNTIME_TOKEN_SECRET);
        if (runtimeClaims.sessionId !== pathParams.sessionId) {
          return createResponse(HTTP_STATUS.CONFLICT, {
            error: "sessionId does not match runtime token",
          });
        }
        return await handleUpdateTurn(pathParams.sessionId, pathParams.turnIndex, runtimeClaims.sub, event.body);
      } catch (error) {
        if (error instanceof RuntimeTokenError) {
          return createResponse(error.statusCode, { error: error.message });
        }
        console.error("session turn timing update failed", {
          sessionId: pathParams.sessionId,
          turnIndex: pathParams.turnIndex,
          hasBody: Boolean(event.body),
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    // GET /sessions/{sessionId}
    if (method === "GET" && pathParams?.sessionId) {
      const caller = await extractCallerIdentity(event);
      const authError = requireRole(caller, ["student", "faculty", "simulation_designer", "admin"]);
      if (authError) return authError;
      return await handleGetSession(pathParams.sessionId, caller!);
    }

    // GET /assignments/{assignmentId}/sessions
    if (method === "GET" && pathParams?.assignmentId) {
      const caller = await extractCallerIdentity(event);
      const authError = requireRole(caller, ["student", "faculty", "simulation_designer", "admin"]);
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
  let turns: SessionTurnView[] = [];
  if (TURN_TABLE) {
    const storedTurns = await queryItems(
      TURN_TABLE,
      "sessionId = :sid",
      { ":sid": sessionId },
      dynamo,
      { scanIndexForward: true }
    ) as SessionTurnRecord[];
    turns = storedTurns.map(buildSessionTurnView);
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

function normalizeIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function calculateDurationMs(startAt?: string, endAt?: string): number | undefined {
  if (!startAt || !endAt) {
    return undefined;
  }

  const startMs = new Date(startAt).getTime();
  const endMs = new Date(endAt).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return undefined;
  }

  return endMs - startMs;
}

function buildSessionTurnView(turn: SessionTurnRecord): SessionTurnView {
  return {
    ...turn,
    userSpeechDurationMs: calculateDurationMs(turn.userSpeechStartAt, turn.userSpeechEndAt),
    patientSpeechDurationMs: calculateDurationMs(turn.patientSpeechStartAt, turn.patientSpeechEndAt),
  };
}

function validateTimingOrder(
  turn: Pick<SessionTurnRecord, "userSpeechStartAt" | "userSpeechEndAt" | "patientSpeechStartAt" | "patientSpeechEndAt">
): string | null {
  const userDurationMs = calculateDurationMs(turn.userSpeechStartAt, turn.userSpeechEndAt);
  if (turn.userSpeechStartAt && turn.userSpeechEndAt && userDurationMs === undefined) {
    return "userSpeechEndAt must be greater than or equal to userSpeechStartAt";
  }

  const patientDurationMs = calculateDurationMs(turn.patientSpeechStartAt, turn.patientSpeechEndAt);
  if (turn.patientSpeechStartAt && turn.patientSpeechEndAt && patientDurationMs === undefined) {
    return "patientSpeechEndAt must be greater than or equal to patientSpeechStartAt";
  }

  return null;
}

async function handleUpdateTurn(
  sessionId: string,
  turnIndexParam: string,
  studentUserId: string,
  body: string | null
) {
  const session = await getItem(SESSION_TABLE, { sessionId }, dynamo);
  if (!session) return notFoundResponse("Session not found");

  if (session.studentUserId !== studentUserId) {
    return createResponse(HTTP_STATUS.FORBIDDEN, { error: "Cannot update another student's session turn" });
  }

  if (!TURN_TABLE) {
    return serverErrorResponse("Session turns are not configured");
  }

  const turnIndex = Number(turnIndexParam);
  if (!Number.isInteger(turnIndex) || turnIndex < 1) {
    return badRequestResponse("turnIndex must be a positive integer");
  }

  let payload: unknown;
  try {
    payload = parseJsonBody(body);
  } catch (error) {
    return badRequestResponse(error instanceof Error ? error.message : "Invalid JSON format in request body");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return badRequestResponse("Request body must be a JSON object");
  }
  const payloadObj = payload as Record<string, unknown>;

  const turn = await getItem(TURN_TABLE, { sessionId, turnIndex }, dynamo);
  if (!turn) {
    return notFoundResponse("Session turn not found");
  }

  const updates: Partial<Record<TurnTimingField, string>> = {};
  const timingFields: TurnTimingField[] = [
    "userSpeechStartAt",
    "userSpeechEndAt",
    "patientSpeechStartAt",
    "patientSpeechEndAt",
  ];

  for (const field of timingFields) {
    if (field in payloadObj) {
      const normalized = normalizeIsoTimestamp(payloadObj[field]);
      if (!normalized) {
        return badRequestResponse(`${field} must be a valid ISO timestamp`);
      }
      updates[field] = normalized;
    }
  }

  if (Object.keys(updates).length === 0) {
    return badRequestResponse(
      "Provide one or more timing fields: userSpeechStartAt, userSpeechEndAt, patientSpeechStartAt, patientSpeechEndAt"
    );
  }

  const mergedTurn = {
    ...turn,
    ...updates,
  } as SessionTurnRecord;
  const timingError = validateTimingOrder(mergedTurn);
  if (timingError) {
    return badRequestResponse(timingError);
  }

  await updateItem(TURN_TABLE, { sessionId, turnIndex }, updates, dynamo);

  return createResponse(HTTP_STATUS.OK, {
    turn: buildSessionTurnView(mergedTurn),
  });
}

function trimOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function decodePathParam(value: string): string {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

interface TaskProgressIdentity {
  phaseId: string;
  sectionId?: string;
  taskId?: string;
  taskType?: string;
  latestEvidenceId?: string;
  progressKey: string;
}

function parseTaskProgressIdentity(
  progressKeyParam: string,
  payload: Record<string, unknown>
): { identity?: TaskProgressIdentity; error?: string } {
  const phaseId = trimOptionalString(payload.phaseId);
  if (!phaseId) {
    return { error: "phaseId is required" };
  }

  const sectionId = trimOptionalString(payload.sectionId);
  const taskId = trimOptionalString(payload.taskId);
  if (!taskId && !sectionId) {
    return { error: "Provide taskId or sectionId to identify task progress" };
  }

  const state = trimOptionalString(payload.state);
  if (state && state !== "completed") {
    return { error: "state, when provided, must be completed" };
  }

  const taskType = trimOptionalString(payload.taskType);
  const latestEvidenceId = trimOptionalString(payload.latestEvidenceId);
  const derivedProgressKey = `${phaseId}#${taskId || sectionId}`;
  const pathProgressKey = decodePathParam(progressKeyParam);

  if (!pathProgressKey) {
    return { error: "progressKey path parameter is required" };
  }

  if (pathProgressKey !== derivedProgressKey) {
    return {
      error: `progressKey must match task identity: ${derivedProgressKey}`,
    };
  }

  return {
    identity: {
      phaseId,
      ...(sectionId ? { sectionId } : {}),
      ...(taskId ? { taskId } : {}),
      ...(taskType ? { taskType } : {}),
      ...(latestEvidenceId ? { latestEvidenceId } : {}),
      progressKey: derivedProgressKey,
    },
  };
}

function buildTaskProgressId(sessionId: string, progressKey: string): string {
  return `${sessionId}#${progressKey}`;
}

async function resolveRuntimeSession(sessionId: string, runtimeClaims: RuntimeClaims) {
  const session = await getItem(SESSION_TABLE, { sessionId }, dynamo);
  if (!session) return notFoundResponse("Session not found");

  if (session.assignmentId !== runtimeClaims.assignmentId) {
    return createResponse(HTTP_STATUS.CONFLICT, {
      error: "assignmentId does not match runtime token",
    });
  }

  if (session.studentUserId !== runtimeClaims.sub) {
    return createResponse(HTTP_STATUS.FORBIDDEN, {
      error: "Cannot access another student's session",
    });
  }

  return session as SessionRecord;
}

function toTaskProgressView(row: Partial<SessionTaskProgressRecord>): SessionTaskProgressRecord {
  return {
    progressId: String(row.progressId ?? ""),
    sessionId: String(row.sessionId ?? ""),
    progressKey: String(row.progressKey ?? ""),
    assignmentId: String(row.assignmentId ?? ""),
    studentUserId: String(row.studentUserId ?? ""),
    phaseId: String(row.phaseId ?? ""),
    ...(trimOptionalString(row.sectionId) ? { sectionId: trimOptionalString(row.sectionId) } : {}),
    ...(trimOptionalString(row.taskId) ? { taskId: trimOptionalString(row.taskId) } : {}),
    ...(trimOptionalString(row.taskType) ? { taskType: trimOptionalString(row.taskType) } : {}),
    state: "completed",
    completedAt: String(row.completedAt ?? ""),
    ...(trimOptionalString(row.latestEvidenceId) ? { latestEvidenceId: trimOptionalString(row.latestEvidenceId) } : {}),
    createdAt: String(row.createdAt ?? ""),
    updatedAt: String(row.updatedAt ?? ""),
  };
}

async function handleCompleteTaskProgress(
  sessionId: string,
  progressKeyParam: string,
  runtimeClaims: RuntimeClaims,
  body: string | null
) {
  if (!SESSION_TASK_PROGRESS_TABLE) {
    return serverErrorResponse("Session task progress is not configured");
  }

  const sessionOutcome = await resolveRuntimeSession(sessionId, runtimeClaims);
  if ("statusCode" in sessionOutcome) return sessionOutcome;
  const session = sessionOutcome;

  let payload: unknown;
  try {
    payload = parseJsonBody(body);
  } catch (error) {
    return badRequestResponse(error instanceof Error ? error.message : "Invalid JSON format in request body");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return badRequestResponse("Request body must be a JSON object");
  }

  const parsedIdentity = parseTaskProgressIdentity(
    progressKeyParam,
    payload as Record<string, unknown>
  );
  if (!parsedIdentity.identity) {
    return badRequestResponse(parsedIdentity.error ?? "Invalid task progress identity");
  }
  const identity = parsedIdentity.identity;
  const progressId = buildTaskProgressId(sessionId, identity.progressKey);

  const existing = await getItem(
    SESSION_TASK_PROGRESS_TABLE,
    { progressId },
    dynamo
  ) as SessionTaskProgressRecord | null;

  if (existing) {
    if (
      session.status === "active" &&
      identity.latestEvidenceId &&
      existing.latestEvidenceId !== identity.latestEvidenceId
    ) {
      const updated = {
        ...existing,
        latestEvidenceId: identity.latestEvidenceId,
        updatedAt: generateTimestamp(),
      };
      await putItem(SESSION_TASK_PROGRESS_TABLE, updated, dynamo);
      // latestEvidenceId rotation represents a fresh user action on this task,
      // so re-evaluate whole-session completion in case this completes the set.
      await maybeAutoCompleteSessionIfRequiredTasksDone(session);
      return createResponse(HTTP_STATUS.OK, { progress: toTaskProgressView(updated) });
    }

    // Pure idempotent re-read of an existing row with no mutation: skip the
    // auto-complete recomputation; the session state cannot have transitioned
    // because of this call.
    return createResponse(HTTP_STATUS.OK, { progress: toTaskProgressView(existing) });
  }

  if (session.status !== "active") {
    return conflictResponse("Session is not active");
  }

  const now = generateTimestamp();
  const progress: SessionTaskProgressRecord = {
    progressId,
    sessionId,
    progressKey: identity.progressKey,
    assignmentId: session.assignmentId,
    studentUserId: session.studentUserId,
    phaseId: identity.phaseId,
    ...(identity.sectionId ? { sectionId: identity.sectionId } : {}),
    ...(identity.taskId ? { taskId: identity.taskId } : {}),
    ...(identity.taskType ? { taskType: identity.taskType } : {}),
    state: "completed",
    completedAt: now,
    ...(identity.latestEvidenceId ? { latestEvidenceId: identity.latestEvidenceId } : {}),
    createdAt: now,
    updatedAt: now,
  };

  await putItem(SESSION_TASK_PROGRESS_TABLE, progress, dynamo);

  // First-time creation of this internal task's completion row may be the
  // event that completes the whole required set.
  await maybeAutoCompleteSessionIfRequiredTasksDone(session);

  return createResponse(HTTP_STATUS.OK, { progress: toTaskProgressView(progress) });
}

// Loads the scene-configured required-task-key set for the assignment behind
// `assignmentId`. Returns a sanitized, deduplicated array of non-empty strings,
// or null when:
//   - the supporting tables are not configured
//   - the assignment, scene, or assignment.sceneId is missing
//   - `requiredTaskKeys` is absent, null, not an array, or contains only
//     garbage entries after sanitization
// A null return means "auto-completion is not configured for this scene" and
// callers must treat that as a no-op (NOT as an error).
async function loadRequiredTaskKeysForAssignment(
  assignmentId: string | undefined
): Promise<string[] | null> {
  if (!ASSIGNMENT_TABLE || !SCENE_CATALOG_TABLE) return null;
  if (!assignmentId || typeof assignmentId !== "string") return null;

  try {
    const assignment = await getItem(ASSIGNMENT_TABLE, { assignmentId }, dynamo);
    const sceneId = assignment?.sceneId;
    if (typeof sceneId !== "string" || sceneId.trim() === "") return null;

    const scene = await getItem(SCENE_CATALOG_TABLE, { sceneId }, dynamo);
    if (!scene) return null;

    const raw = (scene as Record<string, unknown>).requiredTaskKeys;
    if (!Array.isArray(raw)) return null;

    const sanitized: string[] = [];
    const seen = new Set<string>();
    for (const entry of raw) {
      if (typeof entry !== "string") continue;
      const trimmed = entry.trim();
      if (trimmed === "") continue;
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      sanitized.push(trimmed);
    }
    return sanitized.length > 0 ? sanitized : null;
  } catch (error) {
    console.warn("loadRequiredTaskKeysForAssignment failed", {
      assignmentId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// Evaluates whether every required progressKey for this session's scene is
// covered by completed SessionTaskProgress rows; if so, completes the whole
// session via the shared completeSessionInternal helper.
//
// Safe-fail contract:
//   - Errors are logged and swallowed; auto-complete failure must NEVER fail
//     the task-progress write that just succeeded.
//   - If the session is already completed (race with explicit /complete or a
//     concurrent auto-complete), short-circuit before any writes.
//   - If requiredTaskKeys is missing/empty/malformed, treat as "not configured"
//     and return silently.
async function maybeAutoCompleteSessionIfRequiredTasksDone(
  session: SessionRecord
): Promise<void> {
  try {
    if (session.status === "completed") return;
    if (!SESSION_TASK_PROGRESS_TABLE) return;

    const requiredKeys = await loadRequiredTaskKeysForAssignment(session.assignmentId);
    if (!requiredKeys || requiredKeys.length === 0) return;

    // Required-key coverage MUST use deterministic primary-key reads, not the
    // bySessionProgressKey GSI. The GSI is eventually consistent: the row we
    // just wrote in handleCompleteTaskProgress may not yet appear in a GSI
    // query result, which would make this function falsely conclude the
    // required set is incomplete and leave the session active. The pure
    // idempotent re-read path of handleCompleteTaskProgress does not retry
    // auto-completion, so a missed coverage check would not self-correct.
    //
    // SessionTaskProgress.progressId is the deterministic primary key
    // `${sessionId}#${progressKey}` (see buildTaskProgressId), so a getItem
    // per required key always returns the freshly-written row immediately
    // after the PutItem completes. requiredKeys is a small bounded list, so
    // the per-key getItem cost is acceptable here.
    for (const requiredKey of requiredKeys) {
      const progressId = buildTaskProgressId(session.sessionId, requiredKey);
      // ConsistentRead is required here: this helper runs immediately after
      // a SessionTaskProgress PutItem. A default eventually-consistent read
      // could miss the row we just wrote and falsely conclude the required
      // set is incomplete, leaving the session active. Strong consistency
      // on a deterministic primary-key read closes that window.
      const row = await getItem(
        SESSION_TASK_PROGRESS_TABLE,
        { progressId },
        dynamo,
        { consistentRead: true }
      );
      if (!row) return;
    }

    // Re-fetch the latest session record before completing to avoid acting on
    // a stale snapshot (another concurrent caller may have already completed).
    const latest = await getItem(SESSION_TABLE, { sessionId: session.sessionId }, dynamo);
    if (!latest) return;
    const latestSession = latest as SessionRecord;
    if (latestSession.status === "completed") return;

    await completeSessionInternal(latestSession, generateTimestamp());
  } catch (error) {
    console.warn("maybeAutoCompleteSessionIfRequiredTasksDone failed", {
      sessionId: session?.sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleListTaskProgress(sessionId: string, runtimeClaims: RuntimeClaims) {
  if (!SESSION_TASK_PROGRESS_TABLE) {
    return serverErrorResponse("Session task progress is not configured");
  }

  const sessionOutcome = await resolveRuntimeSession(sessionId, runtimeClaims);
  if ("statusCode" in sessionOutcome) return sessionOutcome;
  const session = sessionOutcome;

  const rows = await queryItems(
    SESSION_TASK_PROGRESS_TABLE,
    "sessionId = :sid",
    { ":sid": sessionId },
    dynamo,
    {
      indexName: SESSION_TASK_PROGRESS_BY_SESSION_INDEX,
      scanIndexForward: true,
    }
  );

  const progress = rows
    .map((row) => toTaskProgressView(row))
    .sort((a, b) => a.progressKey.localeCompare(b.progressKey));

  return createResponse(HTTP_STATUS.OK, {
    sessionId,
    assignmentId: session.assignmentId,
    progress,
  });
}

async function handleCompleteSession(sessionId: string, studentUserId: string) {
  const session = await getItem(SESSION_TABLE, { sessionId }, dynamo);
  if (!session) return notFoundResponse("Session not found");

  if (session.studentUserId !== studentUserId) {
    return createResponse(HTTP_STATUS.FORBIDDEN, { error: "Cannot complete another student's session" });
  }

  // Explicit route preserves the existing external 409 contract: if the
  // session is already completed (e.g. via the auto-complete-from-task-
  // progress path), surface that to the caller rather than silently no-op.
  if (session.status === "completed") {
    return conflictResponse("Session is already completed");
  }

  const now = generateTimestamp();
  const updated = await completeSessionInternal(session as SessionRecord, now);

  return createResponse(HTTP_STATUS.OK, { session: await enrichSessionForLaunch(updated) });
}

// Shared internal helper used by:
//   - the explicit PUT /sessions/{sessionId}/complete route
//   - the auto-complete path triggered from successful task-progress writes
//
// Idempotent: if the session is already completed when called, returns the
// existing record unchanged without re-emitting side effects.
async function completeSessionInternal(
  session: SessionRecord,
  now: string
): Promise<SessionRecord> {
  if (session.status === "completed") {
    return session;
  }

  const updated: SessionRecord = {
    ...session,
    status: "completed",
    endedAt: now,
  };

  await putItem(SESSION_TABLE, updated, dynamo);

  // Course-LMS integration: mark StudentItemProgress completed and emit event when
  // the assignment belongs to a Course ModuleItem. AI evaluation arrives separately
  // via llm-scoring-function which then updates bestSessionId/Score.
  await markCourseProgressCompleted(updated.assignmentId, updated.studentUserId, now);

  return updated;
}

async function markCourseProgressCompleted(
  assignmentId: string,
  studentUserId: string,
  now: string
): Promise<void> {
  if (!ASSIGNMENT_TABLE || !MODULE_ITEM_TABLE || !STUDENT_ITEM_PROGRESS_TABLE) return;
  try {
    const assignment = await getItem(ASSIGNMENT_TABLE, { assignmentId }, dynamo);
    const moduleItemId = assignment?.moduleItemId;
    const courseId = assignment?.courseId;
    if (!moduleItemId || !courseId) return;
    const moduleItem = await getItem(MODULE_ITEM_TABLE, { moduleItemId }, dynamo);
    if (!moduleItem) return;

    const existing = await getItem(
      STUDENT_ITEM_PROGRESS_TABLE,
      { moduleItemId, studentUserId },
      dynamo
    );
    const next = {
      moduleItemId,
      studentUserId,
      courseId,
      moduleId: moduleItem.moduleId,
      ...(existing || {}),
      state: "completed",
      completedAt: now,
      startedAt: existing?.startedAt || now,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    await putItem(STUDENT_ITEM_PROGRESS_TABLE, next, dynamo);

    // Emit event.
    if (EVENT_LOG_TABLE) {
      const dateKey = now.slice(0, 10);
      await putItem(
        EVENT_LOG_TABLE,
        {
          eventId: generateId(),
          studentUserId,
          studentDateKey: `${studentUserId}#${dateKey}`,
          courseId,
          moduleId: moduleItem.moduleId,
          moduleItemId,
          eventType: "voice_simulation_completed",
          payload: { assignmentId },
          createdAt: now,
        },
        dynamo
      );
    }
  } catch (e) {
    console.warn("markCourseProgressCompleted failed", e);
  }
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
