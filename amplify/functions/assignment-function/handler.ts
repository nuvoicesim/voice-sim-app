import type { APIGatewayProxyHandler } from "aws-lambda";
import {
  createResponse,
  optionsResponse,
  badRequestResponse,
  notFoundResponse,
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
} from "../shared";
import { extractCallerIdentity, requireRole } from "../shared/auth-middleware";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";

const TABLE_NAME = process.env.TABLE_NAME;
const ENROLLMENT_TABLE_NAME = process.env.ENROLLMENT_TABLE_NAME;
const dynamo = createDynamoDbClient();

export const handler: APIGatewayProxyHandler = async (event) => {
  const method = event.httpMethod;
  const pathParams = event.pathParameters;

  if (method === "OPTIONS") return optionsResponse();

  try {
    // PUT /assignments/{assignmentId}/status
    if (method === "PUT" && pathParams?.assignmentId && event.resource?.includes("/status")) {
      const caller = extractCallerIdentity(event);
      const authError = requireRole(caller, ["faculty", "admin"]);
      if (authError) return authError;
      return await handleUpdateStatus(pathParams.assignmentId, event.body);
    }

    // PUT /assignments/{assignmentId}
    if (method === "PUT" && pathParams?.assignmentId) {
      const caller = extractCallerIdentity(event);
      const authError = requireRole(caller, ["faculty", "admin"]);
      if (authError) return authError;
      return await handleUpdateAssignment(pathParams.assignmentId, event.body);
    }

    // GET /assignments/{assignmentId}
    if (method === "GET" && pathParams?.assignmentId) {
      return await handleGetAssignment(pathParams.assignmentId);
    }

    // GET /assignments
    if (method === "GET") {
      const caller = extractCallerIdentity(event);
      const params = getQueryParams(event.queryStringParameters);
      return await handleListAssignments(caller, params);
    }

    // POST /assignments
    if (method === "POST") {
      const caller = extractCallerIdentity(event);
      const authError = requireRole(caller, ["faculty", "admin"]);
      if (authError) return authError;
      return await handleCreateAssignment(caller!.userId, event.body);
    }

    return methodNotAllowedResponse(["GET", "POST", "PUT", "OPTIONS"]);
  } catch (error) {
    console.error("Unhandled error:", error);
    return serverErrorResponse("Internal server error");
  }
};

async function handleCreateAssignment(createdBy: string, body: string | null) {
  const payload = parseJsonBody(body);
  const { sceneId, title, mode, attemptPolicy, surveyPolicy, dueDate, targetType, targetId, description } = payload;

  if (!sceneId || !title || !mode) {
    return badRequestResponse("Missing required fields: sceneId, title, mode");
  }

  if (!["practice", "assessment"].includes(mode)) {
    return badRequestResponse("mode must be 'practice' or 'assessment'");
  }

  const now = generateTimestamp();
  const item = {
    assignmentId: generateId(),
    sceneId,
    title,
    description: description || "",
    mode,
    attemptPolicy: attemptPolicy || { maxAttempts: mode === "practice" ? -1 : 1 },
    surveyPolicy: surveyPolicy || { enabled: false, required: false, templateId: null, displayTiming: "post-session" },
    dueDate: dueDate || null,
    targetType: targetType || "cohort",
    targetId: targetId || null,
    status: "draft",
    createdBy,
    createdAt: now,
    updatedAt: now,
  };

  await putItem(TABLE_NAME, item, dynamo);
  return createResponse(HTTP_STATUS.CREATED, item);
}

async function handleGetAssignment(assignmentId: string) {
  const item = await getItem(TABLE_NAME, { assignmentId }, dynamo);
  if (!item) return notFoundResponse("Assignment not found");
  return createResponse(HTTP_STATUS.OK, item);
}

async function handleListAssignments(
  caller: ReturnType<typeof extractCallerIdentity>,
  params: Record<string, string>
) {
  const statusFilter = params.status;
  let filterExpression: string | undefined;
  let expressionValues: Record<string, any> | undefined;

  if (statusFilter) {
    filterExpression = "#s = :status";
    expressionValues = { ":status": statusFilter };
  }

  const result = await dynamo.send(new ScanCommand({
    TableName: TABLE_NAME,
    ...(filterExpression && {
      FilterExpression: filterExpression,
      ExpressionAttributeValues: expressionValues,
      ExpressionAttributeNames: { "#s": "status" },
    }),
  }));

  let assignments = result.Items || [];

  // Students only see published assignments
  if (caller?.role === "student") {
    assignments = assignments.filter((a) => a.status === "published");
  }

  return createResponse(HTTP_STATUS.OK, { assignments });
}

async function handleUpdateAssignment(assignmentId: string, body: string | null) {
  const existing = await getItem(TABLE_NAME, { assignmentId }, dynamo);
  if (!existing) return notFoundResponse("Assignment not found");

  const payload = parseJsonBody(body);
  // Prevent overwriting key fields
  delete payload.assignmentId;
  delete payload.createdBy;
  delete payload.createdAt;

  const updated = {
    ...existing,
    ...payload,
    updatedAt: generateTimestamp(),
  };

  await putItem(TABLE_NAME, updated, dynamo);
  return createResponse(HTTP_STATUS.OK, updated);
}

async function handleUpdateStatus(assignmentId: string, body: string | null) {
  const existing = await getItem(TABLE_NAME, { assignmentId }, dynamo);
  if (!existing) return notFoundResponse("Assignment not found");

  const payload = parseJsonBody(body);
  const { status } = payload;

  if (!["draft", "published", "archived"].includes(status)) {
    return badRequestResponse("status must be 'draft', 'published', or 'archived'");
  }

  const updated = {
    ...existing,
    status,
    updatedAt: generateTimestamp(),
  };

  await putItem(TABLE_NAME, updated, dynamo);
  return createResponse(HTTP_STATUS.OK, updated);
}
