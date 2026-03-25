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
  queryItems,
} from "../shared";
import { extractCallerIdentity, requireRole } from "../shared/auth-middleware";

const TABLE_NAME = process.env.TABLE_NAME;
const dynamo = createDynamoDbClient();

export const handler: APIGatewayProxyHandler = async (event) => {
  const method = event.httpMethod;

  if (method === "OPTIONS") return optionsResponse();

  try {
    if (method === "GET") {
      const params = getQueryParams(event.queryStringParameters);
      if (params.sceneId) {
        return await handleGetScene(params.sceneId);
      }
      return await handleListScenes();
    }

    if (method === "POST") {
      const caller = extractCallerIdentity(event);
      const authError = requireRole(caller, ["faculty", "admin"]);
      if (authError) return authError;
      return await handleCreateScene(event.body);
    }

    if (method === "PUT") {
      const caller = extractCallerIdentity(event);
      const authError = requireRole(caller, ["faculty", "admin"]);
      if (authError) return authError;
      const sceneId = event.pathParameters?.sceneId;
      if (!sceneId) return badRequestResponse("Missing sceneId path parameter");
      return await handleUpdateScene(sceneId, event.body);
    }

    if (method === "DELETE") {
      const caller = extractCallerIdentity(event);
      const authError = requireRole(caller, ["faculty", "admin"]);
      if (authError) return authError;
      const sceneId = event.pathParameters?.sceneId;
      if (!sceneId) return badRequestResponse("Missing sceneId path parameter");
      return await handleDeleteScene(sceneId);
    }

    return methodNotAllowedResponse(["GET", "POST", "PUT", "DELETE", "OPTIONS"]);
  } catch (error) {
    console.error("Unhandled error:", error);
    return serverErrorResponse("Internal server error");
  }
};

async function handleGetScene(sceneId: string) {
  const item = await getItem(TABLE_NAME, { sceneId }, dynamo);
  if (!item) return notFoundResponse("Scene not found");
  return createResponse(HTTP_STATUS.OK, item);
}

async function handleListScenes() {
  const { ScanCommand } = await import("@aws-sdk/lib-dynamodb");
  const result = await dynamo.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: "isActive = :active",
    ExpressionAttributeValues: { ":active": true },
  }));
  return createResponse(HTTP_STATUS.OK, { scenes: result.Items || [] });
}

async function handleCreateScene(body: string | null) {
  const payload = parseJsonBody(body);
  const { scenarioKey, title, description, difficulty, tags, unityBuildFolder } = payload;

  if (!scenarioKey || !title) {
    return badRequestResponse("Missing required fields: scenarioKey, title");
  }

  const now = generateTimestamp();
  const item = {
    sceneId: generateId(),
    scenarioKey,
    title,
    description: description || "",
    difficulty: difficulty || "medium",
    tags: tags || [],
    unityBuildFolder: unityBuildFolder || "",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  await putItem(TABLE_NAME, item, dynamo);
  return createResponse(HTTP_STATUS.CREATED, item);
}

async function handleUpdateScene(sceneId: string, body: string | null) {
  const existing = await getItem(TABLE_NAME, { sceneId }, dynamo);
  if (!existing) return notFoundResponse("Scene not found");

  const payload = parseJsonBody(body);
  const updated = {
    ...existing,
    ...payload,
    sceneId,
    updatedAt: generateTimestamp(),
  };

  await putItem(TABLE_NAME, updated, dynamo);
  return createResponse(HTTP_STATUS.OK, updated);
}

async function handleDeleteScene(sceneId: string) {
  const existing = await getItem(TABLE_NAME, { sceneId }, dynamo);
  if (!existing) return notFoundResponse("Scene not found");

  const updated = {
    ...existing,
    isActive: false,
    updatedAt: generateTimestamp(),
  };

  await putItem(TABLE_NAME, updated, dynamo);
  return createResponse(HTTP_STATUS.OK, { message: "Scene deactivated", sceneId });
}
