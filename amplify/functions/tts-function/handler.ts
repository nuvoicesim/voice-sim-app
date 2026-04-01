import type { APIGatewayProxyHandler } from "aws-lambda";
import { randomUUID } from "crypto";

import {
  createResponse,
  parseJsonBody,
  HTTP_STATUS,
  buildCorsHeaders,
  requireRuntimeTokenClaims,
  applyRuntimeClaimsToBody,
  RuntimeTokenError,
  resolveRuntimeConfig,
} from "../shared";
import { validateTtsRequest } from "./validation";
import { applyVoicePolicy, type ValidationMode } from "./voicePolicy";
import { synthesizeWithElevenLabs, ElevenLabsUpstreamError } from "./providers/elevenlabs";
import { ContextResolutionError, createDynamoDbClient } from "../shared";

const ASSIGNMENT_TABLE_NAME = process.env.ASSIGNMENT_TABLE_NAME;
const SCENE_CATALOG_TABLE_NAME = process.env.SCENE_CATALOG_TABLE_NAME;
const PATIENT_PROFILE_TABLE_NAME = process.env.PATIENT_PROFILE_TABLE_NAME;
const dynamo = createDynamoDbClient();

const ELEVENLABS_API_KEY_RAW = process.env.ELEVENLABS_API_KEY;
const ALLOWED_ORIGINS = process.env.TTS_ALLOWED_ORIGINS ?? process.env.LLM_ALLOWED_ORIGINS;
const TTS_TIMEOUT_MS = Number(process.env.TTS_TIMEOUT_MS ?? "20000");
const TTS_MAX_INPUT_CHARS = Number(process.env.TTS_MAX_INPUT_CHARS ?? "800");
const TTS_VALIDATION_MODE = (process.env.TTS_VALIDATION_MODE ?? "lenient") as ValidationMode;
const RUNTIME_TOKEN_SECRET = process.env.RUNTIME_TOKEN_SECRET ?? "";

function getHeaderValue(
  headers: Record<string, string | undefined> | undefined,
  headerName: string
): string | undefined {
  if (!headers) {
    return undefined;
  }

  const targetName = headerName.toLowerCase();
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === targetName && typeof value === "string") {
      return value;
    }
  }

  return undefined;
}

function getRequestId(headers: Record<string, string | undefined> | undefined): string {
  const requestIdHeader = getHeaderValue(headers, "X-Request-ID");
  if (requestIdHeader && requestIdHeader.trim() !== "") {
    return requestIdHeader.trim();
  }
  return randomUUID();
}

function mapUpstreamError(error: ElevenLabsUpstreamError): { statusCode: number; message: string; retryable: boolean } {
  if (error.statusCode === 401 || error.statusCode === 403) {
    return {
      statusCode: 502,
      message: "TTS provider authentication failed",
      retryable: false,
    };
  }

  if (error.statusCode === 429) {
    return {
      statusCode: 429,
      message: "Rate limit exceeded. Please retry later.",
      retryable: true,
    };
  }

  if (error.statusCode === 400 || error.statusCode === 404 || error.statusCode === 422) {
    return {
      statusCode: HTTP_STATUS.BAD_REQUEST,
      message: "Invalid TTS request for provider",
      retryable: false,
    };
  }

  if (error.retryable) {
    return {
      statusCode: 502,
      message: "TTS provider timeout or unavailable",
      retryable: true,
    };
  }

  return {
    statusCode: 502,
    message: "TTS provider request failed",
    retryable: false,
  };
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const requestOrigin = getHeaderValue(event.headers ?? undefined, "origin");
  const corsHeaders = buildCorsHeaders(requestOrigin, ALLOWED_ORIGINS, "GET,POST,OPTIONS");
  const requestId = getRequestId(event.headers ?? undefined);

  const respond = (
    statusCode: number,
    body: Record<string, unknown>
  ) => createResponse(statusCode, body, corsHeaders);

  if (event.httpMethod === "OPTIONS") {
    return createResponse(HTTP_STATUS.OK, {}, corsHeaders);
  }

  if (event.httpMethod === "GET" && event.path.endsWith("/health")) {
    return respond(HTTP_STATUS.OK, {
      status: "ok",
      service: "tts",
      timestamp: new Date().toISOString(),
    });
  }

  if (event.httpMethod !== "POST") {
    return createResponse(
      HTTP_STATUS.METHOD_NOT_ALLOWED,
      { error: "Method not allowed", requestId, retryable: false },
      { ...corsHeaders, Allow: "GET,POST,OPTIONS" }
    );
  }

  const elevenLabsApiKey = ELEVENLABS_API_KEY_RAW?.trim();

  if (!elevenLabsApiKey) {
    return respond(HTTP_STATUS.INTERNAL_SERVER_ERROR, {
      error: "Configuration error",
      requestId,
      retryable: false,
    });
  }

  let payload: unknown;
  try {
    payload = parseJsonBody(event.body);
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Invalid JSON format in request body";
    return respond(HTTP_STATUS.BAD_REQUEST, {
      error: message,
      requestId,
      retryable: false,
    });
  }

  try {
    const runtimeClaims = requireRuntimeTokenClaims(event.headers ?? undefined, RUNTIME_TOKEN_SECRET);
    payload = applyRuntimeClaimsToBody((payload as Record<string, unknown>) ?? {}, runtimeClaims);
  } catch (error) {
    if (error instanceof RuntimeTokenError) {
      return respond(error.statusCode, {
        error: error.message,
        requestId,
        retryable: false,
      });
    }
    throw error;
  }

  const validation = validateTtsRequest(payload, { maxTextChars: TTS_MAX_INPUT_CHARS });
  if (!validation.request) {
    return respond(HTTP_STATUS.BAD_REQUEST, {
      error: validation.error ?? "Invalid request",
      requestId,
      retryable: false,
    });
  }

  const request = validation.request;

  let runtimeConfig;
  try {
    runtimeConfig = await resolveRuntimeConfig(
      { context: request.context },
      ASSIGNMENT_TABLE_NAME || "",
      SCENE_CATALOG_TABLE_NAME || "",
      PATIENT_PROFILE_TABLE_NAME || "",
      dynamo
    );
  } catch (error) {
    if (error instanceof ContextResolutionError) {
      return respond(HTTP_STATUS.BAD_REQUEST, { error: error.message, requestId, retryable: false });
    }
    return respond(HTTP_STATUS.INTERNAL_SERVER_ERROR, {
      error: "Context resolution failed",
      requestId,
      retryable: false,
    });
  }

  const assignmentTtsConfig = runtimeConfig?.tts;
  const requestedProfile = assignmentTtsConfig || {};

  const { effectiveProfile, adjustedFields } = applyVoicePolicy(
    requestedProfile,
    {
      mode: TTS_VALIDATION_MODE,
      enforcedVoiceId: assignmentTtsConfig?.voiceId,
      enforcedModelId: assignmentTtsConfig?.modelId,
    }
  );

  if (!effectiveProfile.voiceId) {
    return respond(HTTP_STATUS.INTERNAL_SERVER_ERROR, {
      error: "TTS runtime config is missing a voiceId for this assignment",
      requestId,
      retryable: false,
    });
  }

  if (TTS_VALIDATION_MODE === "strict" && adjustedFields.length > 0) {
    return respond(HTTP_STATUS.BAD_REQUEST, {
      error: `Invalid voice settings: ${adjustedFields.join(", ")}`,
      requestId,
      retryable: false,
    });
  }

  const startedAt = Date.now();

  try {
    const result = await synthesizeWithElevenLabs({
      apiKey: elevenLabsApiKey,
      voiceProfile: effectiveProfile,
      text: request.text,
      format: request.options.format,
      includeAlignment: request.options.includeAlignment,
      timeoutMs: TTS_TIMEOUT_MS,
    });

    const responseBody: Record<string, unknown> = {
      audio_base64: result.audio_base64,
      provider: "elevenlabs",
      requestId,
    };

    if (request.options.includeAlignment && result.alignment) {
      responseBody.alignment = result.alignment;
    }

    const latencyMs = Date.now() - startedAt;
    console.log("tts request completed", {
      requestId,
      userID: request.userID,
      context: request.context,
      scenario: runtimeConfig?.scenarioKey,
      profileId: effectiveProfile.profileId,
      provider: "elevenlabs",
      latencyMs,
      outcome: "success",
      adjustedFields,
      sessionId: request.metadata.sessionId,
      turnIndex: request.metadata.turnIndex,
      client: request.metadata.client,
    });

    return respond(HTTP_STATUS.OK, responseBody);
  } catch (error) {
    const mapped = error instanceof ElevenLabsUpstreamError
      ? mapUpstreamError(error)
      : {
          statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
          message: "Internal server error",
          retryable: false,
        };

    console.error("tts upstream error", {
      requestId,
      userID: request.userID,
      context: request.context,
      scenario: runtimeConfig?.scenarioKey,
      profileId: effectiveProfile.profileId,
      provider: "elevenlabs",
      outcome: "error",
      statusCode: mapped.statusCode,
      details: error instanceof Error ? error.message : String(error),
      sessionId: request.metadata.sessionId,
      turnIndex: request.metadata.turnIndex,
      client: request.metadata.client,
    });

    return respond(mapped.statusCode, {
      error: mapped.message,
      requestId,
      retryable: mapped.retryable,
    });
  }
};
