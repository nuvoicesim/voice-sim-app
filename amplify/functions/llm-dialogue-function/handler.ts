import type { APIGatewayProxyHandler } from "aws-lambda";
import { randomUUID } from "crypto";

import {
  createResponse,
  parseJsonBody,
  HTTP_STATUS,
  buildCorsHeaders,
  callOpenAIChat,
  OpenAIUpstreamError,
  type OpenAIMessage,
  requireRuntimeTokenClaims,
  applyRuntimeClaimsToBody,
  RuntimeTokenError,
  putItem,
  generateTimestamp,
  queryItems,
  resolveRuntimeConfig,
  ContextResolutionError,
  createDynamoDbClient,
} from "../shared";

type DialogueRole = "system" | "user" | "assistant";

interface DialogueMessage {
  role: DialogueRole;
  content: string;
}

interface RuntimeContext {
  assignmentId: string;
  sessionId: string;
}

interface DialogueRequestBody {
  userID: string;
  context?: RuntimeContext;
  messages: DialogueMessage[];
  scenario?: string;
  options?: {
    temperature?: number;
    maxOutputTokens?: number;
  };
  metadata?: {
    sessionId?: string;
    turnIndex?: number;
    client?: string;
    userSpeechStartAt?: string;
    patientSpeechStartAt?: string;
    prewarm?: boolean;
  };
}

interface StructuredDialogueResponse {
  responseText: string;
  emotionCode: number;
  motionCode: number;
}

interface ValidatedDialogueRequest {
  userID: string;
  context?: RuntimeContext;
  messages: DialogueMessage[];
  scenario?: string;
  options: {
    temperature?: number;
    maxOutputTokens?: number;
  };
  metadata: {
    sessionId?: string;
    turnIndex?: number;
    client?: string;
    userSpeechStartAt?: string;
    patientSpeechStartAt?: string;
    prewarm?: boolean;
  };
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ALLOWED_ORIGINS = process.env.LLM_ALLOWED_ORIGINS;
const DEFAULT_MODEL = process.env.LLM_DIALOGUE_MODEL || "gpt-4o-mini";
const DEFAULT_TEMPERATURE = Number(process.env.LLM_DIALOGUE_TEMPERATURE ?? "0.2");
const DEFAULT_MAX_OUTPUT_TOKENS = Number(process.env.LLM_DIALOGUE_MAX_OUTPUT_TOKENS ?? "220");
const DEFAULT_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? "12000");
const UPSTREAM_RETRIES = Number(process.env.LLM_UPSTREAM_RETRIES ?? "1");
const MAX_HISTORY_MESSAGES = Number(process.env.LLM_DIALOGUE_MAX_HISTORY ?? "20");
const MAX_INPUT_CHARS = Number(process.env.LLM_MAX_INPUT_CHARS ?? "12000");
const TURN_TABLE_NAME = process.env.TURN_TABLE_NAME;
const RUNTIME_TOKEN_SECRET = process.env.RUNTIME_TOKEN_SECRET ?? "";
const PATIENT_PROFILE_TABLE_NAME = process.env.PATIENT_PROFILE_TABLE_NAME;

const SAFE_FALLBACK_RESPONSE: StructuredDialogueResponse = {
  responseText: "I.. I don't k-know...",
  emotionCode: 7,
  motionCode: 1,
};

const STRICT_RETRY_INSTRUCTION = [
  "CRITICAL OUTPUT REQUIREMENTS:",
  "Return ONLY valid JSON.",
  "Do not include markdown fences.",
  "Do not include extra keys.",
  "Schema keys: responseText (string), emotionCode (integer 0-9), motionCode (integer 0-9).",
].join(" ");

const EMOTION_CODE_INSTRUCTIONS = `IMPORTANT: Analyze emotion from the conversation and provide the selected code in JSON field emotionCode:
- 0: neutral responses or statements
- 1: minor pain or discomfort
- 2: positive responses, gratitude, or feeling better
- 3: pain
- 4: sad
- 5: anger
- 6: frustration due to speech block or not being understood
- 7: thinking or processing information
- 8: apologetic grimace
- 9: crying in frustration when unable to communicate`;

const MOTION_CODE_INSTRUCTIONS = `IMPORTANT: Select animation code and provide it in JSON field motionCode:
- 0: neutral responses or statements
- 1: unable to answer or feeling lost after question
- 2: strong affirmative or emphatic agreement
- 3: agreement with clarification
- 4: actively listening or confirming understanding
- 5: passive or minimal acknowledgment
- 6: disagreement, denial, or inability to answer
- 7: intense frustration when unable to express words
- 8: impatience, agitation, or urging the doctor
- 9: struggling to recall words or thinking of a response`;

const OUTPUT_FORMAT_INSTRUCTIONS = `IMPORTANT OUTPUT FORMAT:
- Return valid JSON that matches the provided schema.
- Put spoken patient text in responseText.
- Do not append [emotion][motion] suffixes in responseText.`;

const DIALOGUE_RESPONSE_FORMAT: Record<string, unknown> = {
  type: "json_schema",
  json_schema: {
    name: "patient_dialogue_schema",
    strict: true,
    schema: {
      type: "object",
      properties: {
        responseText: { type: "string" },
        emotionCode: { type: "integer", minimum: 0, maximum: 9 },
        motionCode: { type: "integer", minimum: 0, maximum: 9 },
      },
      required: ["responseText", "emotionCode", "motionCode"],
      additionalProperties: false,
    },
  },
};

const ASSIGNMENT_TABLE_NAME = process.env.ASSIGNMENT_TABLE_NAME;
const SCENE_CATALOG_TABLE_NAME = process.env.SCENE_CATALOG_TABLE_NAME;
const dynamo = createDynamoDbClient();

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

function parseStructuredDialogue(content: string): StructuredDialogueResponse | null {
  if (!content || content.trim() === "") {
    return null;
  }

  const candidates = [content];
  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(content.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Partial<StructuredDialogueResponse>;
      if (typeof parsed.responseText !== "string" || parsed.responseText.trim() === "") {
        continue;
      }

      return {
        responseText: parsed.responseText.trim(),
        emotionCode: clampCode(parsed.emotionCode),
        motionCode: clampCode(parsed.motionCode),
      };
    } catch {
      // Continue to next candidate.
    }
  }

  return null;
}

function clampCode(value: unknown): number {
  const num = Number(value);
  if (Number.isInteger(num) && num >= 0 && num <= 9) {
    return num;
  }
  return 0;
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number") {
    return undefined;
  }

  return Number.isFinite(value) ? value : undefined;
}

function normalizeOptionalTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toISOString();
}

function validateDialogueRequest(payload: unknown): { request?: ValidatedDialogueRequest; error?: string } {
  if (!payload || typeof payload !== "object") {
    return { error: "Request body must be a JSON object" };
  }

  const body = payload as Partial<DialogueRequestBody>;
  if (!body.userID || typeof body.userID !== "string") {
    return { error: "Missing required field: userID" };
  }

  const hasContext = body.context && typeof body.context === "object"
    && typeof body.context.assignmentId === "string"
    && typeof body.context.sessionId === "string";

  if (!hasContext) {
    return { error: "Provide context.assignmentId + context.sessionId" };
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return { error: "messages must be a non-empty array" };
  }

  const validatedMessages: DialogueMessage[] = [];
  for (const message of body.messages) {
    if (!message || typeof message !== "object") {
      return { error: "Each message must be an object with role and content" };
    }

    const role = (message as Partial<DialogueMessage>).role;
    const content = (message as Partial<DialogueMessage>).content;
    if (!role || !["system", "user", "assistant"].includes(role)) {
      return { error: "messages[].role must be one of: system, user, assistant" };
    }

    if (typeof content !== "string" || content.trim() === "") {
      return { error: "messages[].content must be a non-empty string" };
    }

    validatedMessages.push({
      role,
      content: content.trim(),
    });
  }

  const options = body.options && typeof body.options === "object" ? body.options : {};
  const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
  const userSpeechStartAt = normalizeOptionalTimestamp(metadata.userSpeechStartAt);
  const patientSpeechStartAt = normalizeOptionalTimestamp(metadata.patientSpeechStartAt);
  const prewarm = typeof metadata.prewarm === "boolean" ? metadata.prewarm : undefined;

  if ("userSpeechStartAt" in metadata && !userSpeechStartAt) {
    return { error: "metadata.userSpeechStartAt must be a valid ISO timestamp" };
  }

  if ("patientSpeechStartAt" in metadata && !patientSpeechStartAt) {
    return { error: "metadata.patientSpeechStartAt must be a valid ISO timestamp" };
  }

  return {
    request: {
      userID: body.userID,
      context: hasContext ? { assignmentId: body.context!.assignmentId, sessionId: body.context!.sessionId } : undefined,
      messages: validatedMessages,
      scenario: typeof body.scenario === "string" ? body.scenario : undefined,
      options: {
        temperature: asFiniteNumber(options.temperature),
        maxOutputTokens: asFiniteNumber(options.maxOutputTokens),
      },
      metadata: {
        sessionId: hasContext ? body.context!.sessionId : (typeof metadata.sessionId === "string" ? metadata.sessionId : undefined),
        turnIndex: typeof metadata.turnIndex === "number" ? metadata.turnIndex : undefined,
        client: typeof metadata.client === "string" ? metadata.client : undefined,
        userSpeechStartAt,
        patientSpeechStartAt,
        prewarm,
      },
    },
  };
}

function mapUpstreamError(error: OpenAIUpstreamError): { statusCode: number; message: string; retryable: boolean } {
  if (error.statusCode === 429) {
    return {
      statusCode: 429,
      message: "Rate limit exceeded. Please retry later.",
      retryable: true,
    };
  }

  if (error.statusCode === 413) {
    return {
      statusCode: 413,
      message: "Prompt exceeds allowed size",
      retryable: false,
    };
  }

  if (error.retryable) {
    return {
      statusCode: 502,
      message: "LLM provider timeout or unavailable",
      retryable: true,
    };
  }

  return {
    statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    message: "Internal server error",
    retryable: false,
  };
}

function buildSystemPrompt(baseInstructions: string): string {
  return [
    baseInstructions,
    EMOTION_CODE_INSTRUCTIONS,
    MOTION_CODE_INSTRUCTIONS,
    OUTPUT_FORMAT_INSTRUCTIONS,
  ].join("\n\n");
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const requestOrigin = getHeaderValue(event.headers ?? undefined, "origin");
  const corsHeaders = buildCorsHeaders(requestOrigin, ALLOWED_ORIGINS, "GET,POST,OPTIONS");
  const requestId = getRequestId(event.headers ?? undefined);
  const requestStartedAt = Date.now();

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
      service: "llm-dialogue",
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

  if (!OPENAI_API_KEY) {
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

  const validation = validateDialogueRequest(payload);
  if (!validation.request) {
    return respond(HTTP_STATUS.BAD_REQUEST, {
      error: validation.error ?? "Invalid request",
      requestId,
      retryable: false,
    });
  }

  const request = validation.request;
  const isPrewarm = request.metadata.prewarm === true;

  let scenario: string;
  let runtimeConfig;
  let runtimeConfigMs = 0;
  try {
    const runtimeConfigStartedAt = Date.now();
    runtimeConfig = await resolveRuntimeConfig(
      { context: request.context },
      ASSIGNMENT_TABLE_NAME || "",
      SCENE_CATALOG_TABLE_NAME || "",
      PATIENT_PROFILE_TABLE_NAME || "",
      dynamo
    );
    runtimeConfigMs = Date.now() - runtimeConfigStartedAt;
    scenario = runtimeConfig.scenarioKey;
  } catch (error) {
    if (error instanceof ContextResolutionError) {
      return respond(HTTP_STATUS.BAD_REQUEST, { error: error.message, requestId, retryable: false });
    }
    return respond(HTTP_STATUS.INTERNAL_SERVER_ERROR, { error: "Context resolution failed", requestId, retryable: false });
  }

  const dialogueConfig = runtimeConfig?.dialogue;
  if (!dialogueConfig?.systemPrompt) {
    return respond(HTTP_STATUS.INTERNAL_SERVER_ERROR, {
      error: "Dialogue runtime config is missing for this assignment",
      requestId,
      retryable: false,
    });
  }
  const promptVersion = dialogueConfig.version || "runtime-dialogue";
  const basePrompt = dialogueConfig.systemPrompt;

  const historyMessages = request.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-Math.max(1, MAX_HISTORY_MESSAGES))
    .map((message) => ({ role: message.role, content: message.content })) as OpenAIMessage[];

  if (historyMessages.length === 0) {
    return respond(HTTP_STATUS.BAD_REQUEST, {
      error: "messages must include at least one user or assistant turn",
      requestId,
      retryable: false,
    });
  }

  const lastUserMessage = [...historyMessages].reverse().find((message) => message.role === "user");

  const totalInputChars = historyMessages.reduce(
    (sum, message) => sum + message.content.length,
    0
  );
  if (totalInputChars > MAX_INPUT_CHARS) {
    return respond(413, {
      error: "Prompt exceeds allowed size",
      requestId,
      retryable: false,
    });
  }

  const temperature =
    request.options.temperature
    ?? dialogueConfig?.temperature
    ?? DEFAULT_TEMPERATURE;
  const maxOutputTokens = Math.floor(
    request.options.maxOutputTokens
    ?? dialogueConfig?.maxOutputTokens
    ?? DEFAULT_MAX_OUTPUT_TOKENS
  );
  const systemPrompt = buildSystemPrompt(basePrompt);
  const modelName = dialogueConfig?.model || DEFAULT_MODEL;
  const startedAt = Date.now();

  const invokeDialogueModel = async (strictMode: boolean) => {
    const messages: OpenAIMessage[] = [{ role: "system", content: systemPrompt }];
    if (strictMode) {
      messages.push({ role: "system", content: STRICT_RETRY_INSTRUCTION });
    }
    messages.push(...historyMessages);

    return callOpenAIChat({
      apiKey: OPENAI_API_KEY,
      model: modelName,
      messages,
      temperature,
      maxOutputTokens,
      responseFormat: DIALOGUE_RESPONSE_FORMAT,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      upstreamRetries: UPSTREAM_RETRIES,
    });
  };

  let modelResponse;
  try {
    modelResponse = await invokeDialogueModel(false);
  } catch (error) {
    const upstream = error instanceof OpenAIUpstreamError
      ? mapUpstreamError(error)
      : {
          statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
          message: "Internal server error",
          retryable: false,
        };

    console.error("llm-dialogue upstream error", {
      requestId,
      userID: request.userID,
      scenario,
      promptVersion,
      prewarm: isPrewarm,
      details: error instanceof Error ? error.message : String(error),
      runtimeConfigMs,
      totalRequestMs: Date.now() - requestStartedAt,
    });

    return respond(upstream.statusCode, {
      error: upstream.message,
      requestId,
      retryable: upstream.retryable,
    });
  }

  let parsedResponse = parseStructuredDialogue(modelResponse.content ?? "");
  let fallbackUsed = false;
  let malformedRetryTriggered = false;
  let finalModel = modelResponse.model;
  let finalUsage = modelResponse.usage;

  if (!parsedResponse) {
    malformedRetryTriggered = true;
    try {
      const strictRetryResponse = await invokeDialogueModel(true);
      finalModel = strictRetryResponse.model;
      finalUsage = strictRetryResponse.usage;
      parsedResponse = parseStructuredDialogue(strictRetryResponse.content ?? "");
    } catch (error) {
      console.error("llm-dialogue strict retry failed", {
        requestId,
        userID: request.userID,
        scenario,
        promptVersion,
        prewarm: isPrewarm,
        details: error instanceof Error ? error.message : String(error),
        runtimeConfigMs,
        totalRequestMs: Date.now() - requestStartedAt,
      });
    }
  }

  if (!parsedResponse) {
    fallbackUsed = true;
    parsedResponse = SAFE_FALLBACK_RESPONSE;
  }

  const latencyMs = Date.now() - startedAt;
  let resolvedTurnIndex = request.metadata.turnIndex;

  if (!isPrewarm && request.context?.sessionId && TURN_TABLE_NAME && lastUserMessage) {
    try {
      if (typeof resolvedTurnIndex !== "number") {
        const existingTurns = await queryItems(
          TURN_TABLE_NAME,
          "sessionId = :sid",
          { ":sid": request.context.sessionId },
          dynamo,
          { scanIndexForward: false, limit: 1 }
        );
        resolvedTurnIndex = existingTurns[0]?.turnIndex ? Number(existingTurns[0].turnIndex) + 1 : 1;
      }

      await putItem(
        TURN_TABLE_NAME,
        {
          sessionId: request.context.sessionId,
          turnIndex: resolvedTurnIndex,
          userText: lastUserMessage.content,
          modelText: parsedResponse.responseText,
          ...(request.metadata.userSpeechStartAt ? { userSpeechStartAt: request.metadata.userSpeechStartAt } : {}),
          ...(request.metadata.patientSpeechStartAt ? { patientSpeechStartAt: request.metadata.patientSpeechStartAt } : {}),
          emotionCode: parsedResponse.emotionCode,
          motionCode: parsedResponse.motionCode,
          latencyMs,
          timestamp: generateTimestamp(),
        },
        dynamo
      );
    } catch (error) {
      console.warn("Failed to persist dialogue turn:", error);
    }
  }

  const responseBody = {
    requestId,
    choices: [
      {
        message: {
          role: "assistant",
          content: JSON.stringify(parsedResponse),
        },
      },
    ],
    model: finalModel,
    usage: finalUsage,
    latencyMs,
    createdAt: new Date().toISOString(),
    metadata: {
      promptVersion,
      sessionId: request.metadata.sessionId,
      turnIndex: resolvedTurnIndex,
      prewarm: isPrewarm,
      fallbackUsed,
      malformedRetryTriggered,
    },
  };

  console.log("llm-dialogue request completed", {
    requestId,
    userID: request.userID,
    model: finalModel,
    prewarm: isPrewarm,
    runtimeConfigMs,
    latencyMs,
    totalRequestMs: Date.now() - requestStartedAt,
    usage: finalUsage,
    promptVersion,
    scenario,
    sessionId: request.metadata.sessionId,
    turnIndex: resolvedTurnIndex,
    fallbackUsed,
    malformedRetryTriggered,
  });

  return respond(HTTP_STATUS.OK, responseBody);
};
