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
} from "../shared";

type SimulationLevel = 1 | 2 | 3;
type Scenario = "task1" | "task2" | "task3";

interface ConversationTurn {
  patient: string;
  nurse: string;
}

interface RuntimeContext {
  assignmentId: string;
  sessionId: string;
}

interface ScoringRequestBody {
  userID: string;
  simulationLevel?: SimulationLevel;
  context?: RuntimeContext;
  conversationTurns: ConversationTurn[];
  scenario?: string;
  metadata?: {
    sessionId?: string;
    turnIndex?: number;
    client?: string;
  };
}

interface ScoringCriterion {
  name: string;
  score: number;
  maxScore: number;
  explanation: string;
}

interface ScoringReport {
  criteria: ScoringCriterion[];
  totalScore: number;
  performanceLevel: "Outstanding" | "Proficient" | "Developing" | "Needs Improvement";
  overallExplanation: string;
}

interface ValidatedScoringRequest {
  userID: string;
  simulationLevel?: SimulationLevel;
  context?: RuntimeContext;
  conversationTurns: ConversationTurn[];
  scenario?: string;
  metadata: {
    sessionId?: string;
    turnIndex?: number;
    client?: string;
  };
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ALLOWED_ORIGINS = process.env.LLM_ALLOWED_ORIGINS;
const DEFAULT_MODEL = process.env.LLM_SCORING_MODEL || "gpt-4o-2024-08-06";
const DEFAULT_TEMPERATURE = Number(process.env.LLM_SCORING_TEMPERATURE ?? "0.3");
const DEFAULT_MAX_OUTPUT_TOKENS = Number(process.env.LLM_SCORING_MAX_OUTPUT_TOKENS ?? "3000");
const DEFAULT_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? "12000");
const UPSTREAM_RETRIES = Number(process.env.LLM_UPSTREAM_RETRIES ?? "1");
const MAX_INPUT_CHARS = Number(process.env.LLM_SCORING_MAX_INPUT_CHARS ?? "50000");

const STRICT_RETRY_INSTRUCTION = [
  "CRITICAL OUTPUT REQUIREMENTS:",
  "Return ONLY valid JSON.",
  "Do not include markdown fences.",
  "Ensure all required keys are present.",
  "Follow the scoring schema exactly.",
].join(" ");

const SCORING_RESPONSE_FORMAT: Record<string, unknown> = {
  type: "json_schema",
  json_schema: {
    name: "evaluation_schema",
    strict: true,
    schema: {
      type: "object",
      properties: {
        criteria: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              score: { type: "integer" },
              maxScore: { type: "integer" },
              explanation: { type: "string" },
            },
            required: ["name", "score", "maxScore", "explanation"],
            additionalProperties: false,
          },
        },
        totalScore: { type: "integer" },
        performanceLevel: { type: "string" },
        overallExplanation: { type: "string" },
      },
      required: ["criteria", "totalScore", "performanceLevel", "overallExplanation"],
      additionalProperties: false,
    },
  },
};

const CRITERIA_NAMES = [
  "Greeting and Professional Introduction",
  "Use of Supported Conversation Techniques",
  "Case History Questions",
  "Automatic Speech Tasks",
  "Repetition Tasks",
  "Responsive Naming Tasks",
  "Word Filling or Sentence Completion Tasks",
  "Session Closure",
] as const;

import { SCORING_PROMPTS } from "./promptStrings";
import { resolveScenarioKey, ContextResolutionError, createDynamoDbClient, putItem, generateTimestamp } from "../shared";

const ASSIGNMENT_TABLE_NAME = process.env.ASSIGNMENT_TABLE_NAME;
const SCENE_CATALOG_TABLE_NAME = process.env.SCENE_CATALOG_TABLE_NAME;
const EVALUATION_TABLE_NAME = process.env.EVALUATION_TABLE_NAME;
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

function mapScenarioFromLevel(simulationLevel: SimulationLevel): Scenario {
  if (simulationLevel === 1) return "task1";
  if (simulationLevel === 2) return "task2";
  return "task3";
}

function asInteger(value: unknown): number | null {
  const num = Number(value);
  return Number.isInteger(num) ? num : null;
}

function toPerformanceLevel(totalScore: number): ScoringReport["performanceLevel"] {
  if (totalScore >= 22) return "Outstanding";
  if (totalScore >= 18) return "Proficient";
  if (totalScore >= 14) return "Developing";
  return "Needs Improvement";
}

function fallbackScoringReport(): ScoringReport {
  const criteria = CRITERIA_NAMES.map((name) => ({
    name,
    score: 1,
    maxScore: 3,
    explanation: "Assessment fallback generated due to temporary scoring issue.",
  }));

  const totalScore = criteria.reduce((sum, criterion) => sum + criterion.score, 0);
  return {
    criteria,
    totalScore,
    performanceLevel: toPerformanceLevel(totalScore),
    overallExplanation:
      "The report was generated using fallback mode due to a temporary scoring issue. Please review performance trends with an additional run for a more detailed assessment.",
  };
}

function parseScoringReport(content: string): ScoringReport | null {
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
      const parsed = JSON.parse(candidate) as Partial<ScoringReport>;
      if (!Array.isArray(parsed.criteria) || parsed.criteria.length === 0) {
        continue;
      }

      const criteria: ScoringCriterion[] = [];
      for (const criterion of parsed.criteria) {
        if (!criterion || typeof criterion !== "object") {
          return null;
        }

        const score = asInteger((criterion as Partial<ScoringCriterion>).score);
        const maxScore = asInteger((criterion as Partial<ScoringCriterion>).maxScore);
        const name = (criterion as Partial<ScoringCriterion>).name;
        const explanation = (criterion as Partial<ScoringCriterion>).explanation;

        if (
          score === null ||
          maxScore === null ||
          typeof name !== "string" ||
          name.trim() === "" ||
          typeof explanation !== "string" ||
          explanation.trim() === ""
        ) {
          return null;
        }

        criteria.push({
          name: name.trim(),
          score: Math.max(1, Math.min(3, score)),
          maxScore: Math.max(1, maxScore),
          explanation: explanation.trim(),
        });
      }

      const computedTotal = criteria.reduce((sum, criterion) => sum + criterion.score, 0);
      const overallExplanation =
        typeof parsed.overallExplanation === "string" && parsed.overallExplanation.trim() !== ""
          ? parsed.overallExplanation.trim()
          : "Assessment completed.";

      const providedLevel =
        typeof parsed.performanceLevel === "string" ? parsed.performanceLevel : undefined;

      const performanceLevel: ScoringReport["performanceLevel"] =
        providedLevel === "Outstanding" ||
        providedLevel === "Proficient" ||
        providedLevel === "Developing" ||
        providedLevel === "Needs Improvement"
          ? providedLevel
          : toPerformanceLevel(computedTotal);

      return {
        criteria,
        totalScore: computedTotal,
        performanceLevel,
        overallExplanation,
      };
    } catch {
      // Try next parse candidate.
    }
  }

  return null;
}

function validateScoringRequest(payload: unknown): { request?: ValidatedScoringRequest; error?: string } {
  if (!payload || typeof payload !== "object") {
    return { error: "Request body must be a JSON object" };
  }

  const body = payload as Partial<ScoringRequestBody>;
  if (!body.userID || typeof body.userID !== "string") {
    return { error: "Missing required field: userID" };
  }

  const hasContext = body.context && typeof body.context === "object"
    && typeof body.context.assignmentId === "string"
    && typeof body.context.sessionId === "string";
  const hasLevel = typeof body.simulationLevel === "number" && [1, 2, 3].includes(body.simulationLevel);

  if (!hasContext && !hasLevel) {
    return { error: "Provide context.assignmentId + context.sessionId, or simulationLevel (1, 2, or 3)" };
  }

  if (!Array.isArray(body.conversationTurns) || body.conversationTurns.length === 0) {
    return { error: "conversationTurns must be a non-empty array" };
  }

  const conversationTurns: ConversationTurn[] = [];
  for (const turn of body.conversationTurns) {
    if (!turn || typeof turn !== "object") {
      return { error: "Each conversation turn must be an object with patient and nurse fields" };
    }

    const patient = (turn as Partial<ConversationTurn>).patient;
    const nurse = (turn as Partial<ConversationTurn>).nurse;
    if (typeof patient !== "string" || patient.trim() === "") {
      return { error: "conversationTurns[].patient must be a non-empty string" };
    }

    if (typeof nurse !== "string" || nurse.trim() === "") {
      return { error: "conversationTurns[].nurse must be a non-empty string" };
    }

    conversationTurns.push({
      patient: patient.trim(),
      nurse: nurse.trim(),
    });
  }

  const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};

  return {
    request: {
      userID: body.userID,
      simulationLevel: hasLevel ? body.simulationLevel : undefined,
      context: hasContext ? { assignmentId: body.context!.assignmentId, sessionId: body.context!.sessionId } : undefined,
      conversationTurns,
      scenario: typeof body.scenario === "string" ? body.scenario : undefined,
      metadata: {
        sessionId: hasContext ? body.context!.sessionId : (typeof metadata.sessionId === "string" ? metadata.sessionId : undefined),
        turnIndex: typeof metadata.turnIndex === "number" ? metadata.turnIndex : undefined,
        client: typeof metadata.client === "string" ? metadata.client : undefined,
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

function buildScoringPrompt(conversationTurns: ConversationTurn[]): string {
  const conversationText = conversationTurns
    .map((turn, index) => {
      return [
        `Turn ${index + 1}:`,
        `Patient: "${turn.patient}"`,
        `Nursing Student: "${turn.nurse}"`,
        "",
      ].join("\n");
    })
    .join("\n");

  return `Now analyze the following full simulated conversation between the patient and a SLP student:\n\n${conversationText}`;
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
      service: "llm-scoring",
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

  const validation = validateScoringRequest(payload);
  if (!validation.request) {
    return respond(HTTP_STATUS.BAD_REQUEST, {
      error: validation.error ?? "Invalid request",
      requestId,
      retryable: false,
    });
  }

  const request = validation.request;

  let scenario: string;
  let isLegacy = true;
  try {
    const resolved = await resolveScenarioKey(
      { context: request.context, simulationLevel: request.simulationLevel },
      ASSIGNMENT_TABLE_NAME || "",
      SCENE_CATALOG_TABLE_NAME || "",
      dynamo
    );
    scenario = resolved.scenarioKey;
    isLegacy = resolved.isLegacy;
  } catch (error) {
    if (error instanceof ContextResolutionError) {
      return respond(HTTP_STATUS.BAD_REQUEST, { error: error.message, requestId, retryable: false });
    }
    if (request.simulationLevel) {
      scenario = mapScenarioFromLevel(request.simulationLevel);
    } else {
      return respond(HTTP_STATUS.INTERNAL_SERVER_ERROR, { error: "Context resolution failed", requestId, retryable: false });
    }
  }

  const promptVersion = `${scenario}-scoring-v1`;
  const scoringPrompt = SCORING_PROMPTS[scenario as keyof typeof SCORING_PROMPTS];
  if (!scoringPrompt) {
    return respond(HTTP_STATUS.INTERNAL_SERVER_ERROR, {
      error: "Configuration error",
      requestId,
      retryable: false,
    });
  }

  const userPrompt = buildScoringPrompt(request.conversationTurns);
  if (userPrompt.length > MAX_INPUT_CHARS) {
    return respond(413, {
      error: "Prompt exceeds allowed size",
      requestId,
      retryable: false,
    });
  }

  const startedAt = Date.now();
  const invokeScoringModel = async (strictMode: boolean) => {
    const messages: OpenAIMessage[] = [
      { role: "system", content: scoringPrompt },
      { role: "user", content: userPrompt },
    ];

    if (strictMode) {
      messages.splice(1, 0, { role: "system", content: STRICT_RETRY_INSTRUCTION });
    }

    return callOpenAIChat({
      apiKey: OPENAI_API_KEY,
      model: DEFAULT_MODEL,
      messages,
      temperature: DEFAULT_TEMPERATURE,
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
      responseFormat: SCORING_RESPONSE_FORMAT,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      upstreamRetries: UPSTREAM_RETRIES,
    });
  };

  let modelResponse;
  try {
    modelResponse = await invokeScoringModel(false);
  } catch (error) {
    const upstream = error instanceof OpenAIUpstreamError
      ? mapUpstreamError(error)
      : {
          statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
          message: "Internal server error",
          retryable: false,
        };

    console.error("llm-scoring upstream error", {
      requestId,
      userID: request.userID,
      simulationLevel: request.simulationLevel,
      promptVersion,
      scenario,
      details: error instanceof Error ? error.message : String(error),
    });

    return respond(upstream.statusCode, {
      error: upstream.message,
      requestId,
      retryable: upstream.retryable,
    });
  }

  let report = parseScoringReport(modelResponse.content ?? "");
  let fallbackUsed = false;
  let malformedRetryTriggered = false;
  let finalModel = modelResponse.model;
  let finalUsage = modelResponse.usage;

  if (!report) {
    malformedRetryTriggered = true;
    try {
      const strictRetryResponse = await invokeScoringModel(true);
      finalModel = strictRetryResponse.model;
      finalUsage = strictRetryResponse.usage;
      report = parseScoringReport(strictRetryResponse.content ?? "");
    } catch (error) {
      console.error("llm-scoring strict retry failed", {
        requestId,
        userID: request.userID,
        simulationLevel: request.simulationLevel,
        promptVersion,
        scenario,
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!report) {
    fallbackUsed = true;
    report = fallbackScoringReport();
  }

  const latencyMs = Date.now() - startedAt;
  const responseBody = {
    requestId,
    report,
    model: finalModel,
    usage: finalUsage,
    latencyMs,
    createdAt: new Date().toISOString(),
    metadata: {
      scenario,
      promptVersion,
      sessionId: request.metadata.sessionId,
      turnIndex: request.metadata.turnIndex,
      fallbackUsed,
      malformedRetryTriggered,
    },
  };

  // Persist evaluation to SessionEvaluation table when using context-based flow
  if (!isLegacy && request.context?.sessionId && EVALUATION_TABLE_NAME && report) {
    try {
      await putItem(EVALUATION_TABLE_NAME, {
        sessionId: request.context.sessionId,
        totalScore: report.totalScore,
        performanceLevel: report.performanceLevel,
        rubric: report.criteria,
        responseTimeAvgSec: latencyMs / 1000,
        overallExplanation: report.overallExplanation,
        createdAt: generateTimestamp(),
      }, dynamo);
    } catch (e) {
      console.warn("Failed to persist evaluation:", e);
    }
  }

  console.log("llm-scoring request completed", {
    requestId,
    userID: request.userID,
    simulationLevel: request.simulationLevel,
    context: request.context,
    model: finalModel,
    latencyMs,
    usage: finalUsage,
    promptVersion,
    scenario,
    sessionId: request.metadata.sessionId,
    turnIndex: request.metadata.turnIndex,
    fallbackUsed,
    malformedRetryTriggered,
  });

  return respond(HTTP_STATUS.OK, responseBody);
};

