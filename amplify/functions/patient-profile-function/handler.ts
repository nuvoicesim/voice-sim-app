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

const TABLE_NAME = process.env.TABLE_NAME;
const dynamo = createDynamoDbClient();

function parseJsonObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizePromptConfig(value: unknown, fieldName: string) {
  const obj = parseJsonObject(value, fieldName);
  const systemPrompt = asOptionalString(obj.systemPrompt);
  if (!systemPrompt) {
    throw new Error(`${fieldName}.systemPrompt is required`);
  }

  return {
    systemPrompt,
    ...(asOptionalString(obj.version) ? { version: asOptionalString(obj.version) } : {}),
    ...(asOptionalString(obj.model) ? { model: asOptionalString(obj.model) } : {}),
    ...(typeof asOptionalNumber(obj.temperature) === "number" ? { temperature: asOptionalNumber(obj.temperature) } : {}),
    ...(typeof asOptionalNumber(obj.maxOutputTokens) === "number" ? { maxOutputTokens: asOptionalNumber(obj.maxOutputTokens) } : {}),
  };
}

function normalizeTtsConfig(value: unknown) {
  const obj = parseJsonObject(value, "ttsConfig");
  const voiceId = asOptionalString(obj.voiceId);
  const modelId = asOptionalString(obj.modelId);
  if (!voiceId || !modelId) {
    throw new Error("ttsConfig.voiceId and ttsConfig.modelId are required");
  }

  return {
    ...(asOptionalString(obj.profileId) ? { profileId: asOptionalString(obj.profileId) } : {}),
    ...(asOptionalString(obj.version) ? { version: asOptionalString(obj.version) } : {}),
    voiceId,
    modelId,
    ...(typeof asOptionalNumber(obj.stability) === "number" ? { stability: asOptionalNumber(obj.stability) } : {}),
    ...(typeof asOptionalNumber(obj.similarityBoost) === "number" ? { similarityBoost: asOptionalNumber(obj.similarityBoost) } : {}),
    ...(typeof asOptionalNumber(obj.styleExaggeration) === "number" ? { styleExaggeration: asOptionalNumber(obj.styleExaggeration) } : {}),
    ...(typeof asOptionalNumber(obj.speed) === "number" ? { speed: asOptionalNumber(obj.speed) } : {}),
  };
}

function validatePayload(payload: Record<string, unknown>) {
  const displayName = asOptionalString(payload.displayName);
  const profileKey = asOptionalString(payload.profileKey);

  if (!displayName || !profileKey) {
    return { error: "Missing required fields: displayName, profileKey" as const };
  }

  try {
    const status = asOptionalString(payload.status) || "draft";
    if (!["draft", "published", "archived"].includes(status)) {
      return { error: "status must be 'draft', 'published', or 'archived'" as const };
    }

    return {
      value: {
        displayName,
        profileKey,
        dialogueConfig: normalizePromptConfig(payload.dialogueConfig, "dialogueConfig"),
        scoringConfig: normalizePromptConfig(payload.scoringConfig, "scoringConfig"),
        ttsConfig: normalizeTtsConfig(payload.ttsConfig),
        status,
      },
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Invalid patient profile payload",
    };
  }
}

export const handler: APIGatewayProxyHandler = async (event) => {
  if (event.httpMethod === "OPTIONS") return optionsResponse();

  try {
    const method = event.httpMethod;
    const pathParams = event.pathParameters;
    const caller = await extractCallerIdentity(event);

    if (method === "GET") {
      const authError = requireRole(caller, ["faculty", "simulation_designer", "admin"]);
      if (authError) return authError;
      if (pathParams?.patientProfileId) {
        return await handleGetProfile(pathParams.patientProfileId);
      }
      const params = getQueryParams(event.queryStringParameters);
      if (params.patientProfileId) {
        return await handleGetProfile(params.patientProfileId);
      }
      return await handleListProfiles(caller?.role);
    }

    if (method === "POST" && event.resource?.includes("/archive")) {
      const authError = requireRole(caller, ["simulation_designer", "admin"]);
      if (authError) return authError;
      const patientProfileId = pathParams?.patientProfileId;
      if (!patientProfileId) return badRequestResponse("Missing patientProfileId path parameter");
      return await handleArchiveProfile(patientProfileId);
    }

    if (method === "POST") {
      const authError = requireRole(caller, ["simulation_designer", "admin"]);
      if (authError) return authError;
      return await handleCreateProfile(event.body);
    }

    if (method === "PUT") {
      const authError = requireRole(caller, ["simulation_designer", "admin"]);
      if (authError) return authError;
      const patientProfileId = pathParams?.patientProfileId;
      if (!patientProfileId) return badRequestResponse("Missing patientProfileId path parameter");
      return await handleUpdateProfile(patientProfileId, event.body);
    }

    return methodNotAllowedResponse(["GET", "POST", "PUT", "OPTIONS"]);
  } catch (error) {
    console.error("Unhandled error:", error);
    return serverErrorResponse("Internal server error");
  }
};

async function handleListProfiles(role?: string) {
  const { ScanCommand } = await import("@aws-sdk/lib-dynamodb");
  const isFaculty = role === "faculty";
  const result = await dynamo.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: isFaculty ? "#status = :published" : "#status <> :archived",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: isFaculty
      ? { ":published": "published" }
      : { ":archived": "archived" },
  }));

  return createResponse(HTTP_STATUS.OK, { patientProfiles: result.Items || [] });
}

async function handleGetProfile(patientProfileId: string) {
  const item = await getItem(TABLE_NAME, { patientProfileId }, dynamo);
  if (!item) return notFoundResponse("Patient profile not found");
  return createResponse(HTTP_STATUS.OK, item);
}

async function handleCreateProfile(body: string | null) {
  const payload = parseJsonBody(body);
  const validated = validatePayload(payload);
  if (validated.error) {
    return badRequestResponse(validated.error);
  }

  const now = generateTimestamp();
  const item = {
    patientProfileId: generateId(),
    ...validated.value,
    createdAt: now,
    updatedAt: now,
  };

  await putItem(TABLE_NAME, item, dynamo);
  return createResponse(HTTP_STATUS.CREATED, item);
}

async function handleUpdateProfile(patientProfileId: string, body: string | null) {
  const existing = await getItem(TABLE_NAME, { patientProfileId }, dynamo);
  if (!existing) return notFoundResponse("Patient profile not found");

  const payload = parseJsonBody(body);
  const validated = validatePayload({
    ...existing,
    ...payload,
  });
  if (validated.error) {
    return badRequestResponse(validated.error);
  }

  const updated = {
    ...existing,
    ...validated.value,
    patientProfileId,
    createdAt: existing.createdAt,
    updatedAt: generateTimestamp(),
  };

  await putItem(TABLE_NAME, updated, dynamo);
  return createResponse(HTTP_STATUS.OK, updated);
}

async function handleArchiveProfile(patientProfileId: string) {
  const existing = await getItem(TABLE_NAME, { patientProfileId }, dynamo);
  if (!existing) return notFoundResponse("Patient profile not found");

  const updated = {
    ...existing,
    status: "archived",
    updatedAt: generateTimestamp(),
  };

  await putItem(TABLE_NAME, updated, dynamo);
  return createResponse(HTTP_STATUS.OK, { message: "Patient profile archived", patientProfileId });
}
