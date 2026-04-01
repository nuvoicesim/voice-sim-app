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
import { extractCallerIdentity, requireRole, type CallerIdentity } from "../shared/auth-middleware";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";

const TABLE_NAME = process.env.TABLE_NAME;
const PATIENT_PROFILE_TABLE_NAME = process.env.PATIENT_PROFILE_TABLE_NAME;
const SCENE_CATALOG_TABLE_NAME = process.env.SCENE_CATALOG_TABLE_NAME;
const dynamo = createDynamoDbClient();

export const handler: APIGatewayProxyHandler = async (event) => {
  const method = event.httpMethod;
  const pathParams = event.pathParameters;

  if (method === "OPTIONS") return optionsResponse();

  try {
    // DELETE /assignments/{assignmentId}
    if (method === "DELETE" && pathParams?.assignmentId) {
      const caller = await extractCallerIdentity(event);
      const authError = requireRole(caller, ["faculty", "admin"]);
      if (authError) return authError;
      return await handleDeleteAssignment(pathParams.assignmentId);
    }

    // PUT /assignments/{assignmentId}/status
    if (method === "PUT" && pathParams?.assignmentId && event.resource?.includes("/status")) {
      const caller = await extractCallerIdentity(event);
      const authError = requireRole(caller, ["faculty", "admin"]);
      if (authError) return authError;
      return await handleUpdateStatus(pathParams.assignmentId, event.body);
    }

    // PUT /assignments/{assignmentId}
    if (method === "PUT" && pathParams?.assignmentId) {
      const caller = await extractCallerIdentity(event);
      const authError = requireRole(caller, ["faculty", "admin"]);
      if (authError) return authError;
      return await handleUpdateAssignment(pathParams.assignmentId, event.body);
    }

    // GET /assignments/{assignmentId}
    if (method === "GET" && pathParams?.assignmentId) {
      const caller = await extractCallerIdentity(event);
      const authError = requireRole(caller, ["student", "faculty", "admin"]);
      if (authError) return authError;
      return await handleGetAssignment(pathParams.assignmentId, caller!);
    }

    // GET /assignments
    if (method === "GET") {
      const caller = await extractCallerIdentity(event);
      const authError = requireRole(caller, ["student", "faculty", "admin"]);
      if (authError) return authError;
      const params = getQueryParams(event.queryStringParameters);
      return await handleListAssignments(caller!, params);
    }

    // POST /assignments
    if (method === "POST") {
      const caller = await extractCallerIdentity(event);
      const authError = requireRole(caller, ["faculty", "admin"]);
      if (authError) return authError;
      return await handleCreateAssignment(caller!.userId, event.body);
    }

    return methodNotAllowedResponse(["GET", "POST", "PUT", "DELETE", "OPTIONS"]);
  } catch (error) {
    console.error("Unhandled error:", error);
    return serverErrorResponse("Internal server error");
  }
};

async function handleCreateAssignment(createdBy: string, body: string | null) {
  const payload = parseJsonBody(body);
  const {
    sceneId,
    patientProfileId,
    title,
    mode,
    attemptPolicy,
    surveyPolicy,
    dueDate,
    targetType,
    targetId,
    description,
  } = payload;

  if (!sceneId || !patientProfileId || !title || !mode) {
    return badRequestResponse("Missing required fields: sceneId, patientProfileId, title, mode");
  }

  if (!["practice", "assessment"].includes(mode)) {
    return badRequestResponse("mode must be 'practice' or 'assessment'");
  }

  if (PATIENT_PROFILE_TABLE_NAME) {
    const patientProfile = await getItem(PATIENT_PROFILE_TABLE_NAME, { patientProfileId }, dynamo);
    if (!patientProfile) {
      return badRequestResponse("patientProfileId does not reference an existing patient profile");
    }
  }

  if (SCENE_CATALOG_TABLE_NAME) {
    const scene = await getItem(SCENE_CATALOG_TABLE_NAME, { sceneId }, dynamo);
    if (!scene) {
      return badRequestResponse("sceneId does not reference an existing scene");
    }
    if (typeof scene.unityBuildId !== "string" || scene.unityBuildId.trim() === "") {
      return badRequestResponse("Assignments require scenes with a published Unity build");
    }
  }

  const now = generateTimestamp();
  const item = {
    assignmentId: generateId(),
    sceneId,
    patientProfileId,
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

async function handleGetAssignment(
  assignmentId: string,
  caller: CallerIdentity
) {
  const item = await getItem(TABLE_NAME, { assignmentId }, dynamo);
  if (!item) return notFoundResponse("Assignment not found");
  if (caller.role === "student" && item.status !== "published") {
    return notFoundResponse("Assignment not found");
  }
  return createResponse(HTTP_STATUS.OK, item);
}

async function handleListAssignments(
  caller: CallerIdentity,
  params: Record<string, string>
) {
  const statusFilter = params.status;
  let filterExpression: string | undefined;
  let expressionValues: Record<string, string> | undefined;

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

  if (payload.patientProfileId && PATIENT_PROFILE_TABLE_NAME) {
    const patientProfile = await getItem(PATIENT_PROFILE_TABLE_NAME, { patientProfileId: payload.patientProfileId }, dynamo);
    if (!patientProfile) {
      return badRequestResponse("patientProfileId does not reference an existing patient profile");
    }
  }

  const nextSceneId =
    typeof payload.sceneId === "string" && payload.sceneId.trim() !== ""
      ? payload.sceneId.trim()
      : typeof existing.sceneId === "string"
        ? existing.sceneId
        : "";

  if (SCENE_CATALOG_TABLE_NAME) {
    const scene = await getItem(SCENE_CATALOG_TABLE_NAME, { sceneId: nextSceneId }, dynamo);
    if (!scene) {
      return badRequestResponse("sceneId does not reference an existing scene");
    }
    if (typeof scene.unityBuildId !== "string" || scene.unityBuildId.trim() === "") {
      return badRequestResponse("Assignments require scenes with a published Unity build");
    }
  }

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

async function handleDeleteAssignment(assignmentId: string) {
  const existing = await getItem(TABLE_NAME, { assignmentId }, dynamo);
  if (!existing) return notFoundResponse("Assignment not found");

  const updated = {
    ...existing,
    status: "archived",
    updatedAt: generateTimestamp(),
  };

  await putItem(TABLE_NAME, updated, dynamo);
  return createResponse(HTTP_STATUS.OK, {
    message: "Assignment archived",
    assignmentId,
  });
}
