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
  resolveRuntimeConfig,
  ContextResolutionError,
  createDynamoDbClient,
  putItem,
  generateTimestamp,
  type OpenAIUsage,
} from "../shared";
import { handlePhase1Rubric } from "./phase1-rubric";
import { handlePhase2Evidence } from "./phase2-evidence";

interface ConversationTurn {
  patient: string;
  nurse?: string;
  slpStudent?: string;
}

interface RuntimeContext {
  assignmentId: string;
  sessionId: string;
}

interface ScoringRequestBody {
  userID: string;
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
const RUNTIME_TOKEN_SECRET = process.env.RUNTIME_TOKEN_SECRET ?? "";
const PATIENT_PROFILE_TABLE_NAME = process.env.PATIENT_PROFILE_TABLE_NAME;

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

const ASSIGNMENT_TABLE_NAME = process.env.ASSIGNMENT_TABLE_NAME;
const SCENE_CATALOG_TABLE_NAME = process.env.SCENE_CATALOG_TABLE_NAME;
const EVALUATION_TABLE_NAME = process.env.EVALUATION_TABLE_NAME;
const SESSION_TABLE_NAME = process.env.SESSION_TABLE_NAME;
// Course-LMS integration:
const MODULE_ITEM_TABLE_NAME = process.env.MODULE_ITEM_TABLE_NAME;
const STUDENT_ITEM_PROGRESS_TABLE_NAME = process.env.STUDENT_ITEM_PROGRESS_TABLE_NAME;
const REVIEWER_FEEDBACK_TABLE_NAME = process.env.REVIEWER_FEEDBACK_TABLE_NAME;
const EVENT_LOG_TABLE_NAME = process.env.EVENT_LOG_TABLE_NAME;
// VOICE study evidence persistence (May 18 faculty decision):
const SESSION_EVIDENCE_TABLE_NAME = process.env.SESSION_EVIDENCE_TABLE_NAME;
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

  if (!hasContext) {
    return { error: "Provide context.assignmentId + context.sessionId" };
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
    const slpStudent = (turn as Partial<ConversationTurn>).slpStudent;
    const nurse = (turn as Partial<ConversationTurn>).nurse;
    if (typeof patient !== "string" || patient.trim() === "") {
      return { error: "conversationTurns[].patient must be a non-empty string" };
    }

    const normalizedStudentUtterance =
      typeof slpStudent === "string" && slpStudent.trim() !== ""
        ? slpStudent.trim()
        : typeof nurse === "string" && nurse.trim() !== ""
          ? nurse.trim()
          : null;

    if (!normalizedStudentUtterance) {
      return { error: "conversationTurns[].slpStudent must be a non-empty string" };
    }

    conversationTurns.push({
      patient: patient.trim(),
      nurse: normalizedStudentUtterance,
      slpStudent: normalizedStudentUtterance,
    });
  }

  const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};

  return {
    request: {
      userID: body.userID,
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
        `SLP Student: "${turn.slpStudent || turn.nurse}"`,
        "",
      ].join("\n");
    })
    .join("\n");

  return `Now analyze the following full simulated conversation between the patient and a SLP student:\n\n${conversationText}`;
}

function resolveMaxOutputTokens(configuredValue: unknown): number {
  const configuredTokens = typeof configuredValue === "number"
    ? Math.floor(configuredValue)
    : Number.NaN;

  if (!Number.isFinite(configuredTokens) || configuredTokens <= 0) {
    return DEFAULT_MAX_OUTPUT_TOKENS;
  }

  return Math.min(configuredTokens, DEFAULT_MAX_OUTPUT_TOKENS);
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

  let runtimeClaims;
  try {
    runtimeClaims = requireRuntimeTokenClaims(event.headers ?? undefined, RUNTIME_TOKEN_SECRET);
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

  // ─── VOICE study dispatch (May 18 faculty decision) ───
  // Route Phase 1 rubric and Phase 2 evidence requests to their own branches
  // before the legacy narrative scoring validator runs. Legacy requests (no
  // matching taskContext discriminators) fall through to the original path
  // unchanged. See phase1-rubric.ts and phase2-evidence.ts.
  const taskContextForRouting = (payload as Record<string, unknown> | undefined)?.taskContext as
    | { phaseId?: string; scoringMode?: string }
    | undefined;
  const phaseId = typeof taskContextForRouting?.phaseId === "string" ? taskContextForRouting.phaseId.trim().toLowerCase() : "";
  const scoringMode = typeof taskContextForRouting?.scoringMode === "string" ? taskContextForRouting.scoringMode.trim().toLowerCase() : "";

  if (phaseId === "phase1" && scoringMode === "phase1-rubric") {
    return handlePhase1Rubric(payload, {
      dynamo,
      openAiApiKey: OPENAI_API_KEY,
      requestId,
      corsHeaders,
      runtimeClaims,
      sessionEvidenceTableName: SESSION_EVIDENCE_TABLE_NAME,
    });
  }
  if (phaseId === "phase2") {
    return handlePhase2Evidence(payload, {
      dynamo,
      requestId,
      corsHeaders,
      runtimeClaims,
      sessionEvidenceTableName: SESSION_EVIDENCE_TABLE_NAME,
    });
  }
  // ─── End VOICE study dispatch — fall through to legacy narrative path ───

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
  let runtimeConfig;
  try {
    runtimeConfig = await resolveRuntimeConfig(
      { context: request.context },
      ASSIGNMENT_TABLE_NAME || "",
      SCENE_CATALOG_TABLE_NAME || "",
      PATIENT_PROFILE_TABLE_NAME || "",
      dynamo
    );
    scenario = runtimeConfig.scenarioKey;
  } catch (error) {
    if (error instanceof ContextResolutionError) {
      return respond(HTTP_STATUS.BAD_REQUEST, { error: error.message, requestId, retryable: false });
    }
    return respond(HTTP_STATUS.INTERNAL_SERVER_ERROR, { error: "Context resolution failed", requestId, retryable: false });
  }

  const scoringConfig = runtimeConfig?.scoring;
  if (!scoringConfig?.systemPrompt) {
    return respond(HTTP_STATUS.INTERNAL_SERVER_ERROR, {
      error: "Scoring runtime config is missing for this assignment",
      requestId,
      retryable: false,
    });
  }
  const promptVersion = scoringConfig.version || "runtime-scoring";
  const scoringPrompt = scoringConfig.systemPrompt;
  const maxOutputTokens = resolveMaxOutputTokens(scoringConfig.maxOutputTokens);

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
      model: scoringConfig?.model || DEFAULT_MODEL,
      messages,
      temperature: scoringConfig?.temperature ?? DEFAULT_TEMPERATURE,
      maxOutputTokens,
      responseFormat: SCORING_RESPONSE_FORMAT,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      upstreamRetries: UPSTREAM_RETRIES,
    });
  };

  let modelResponse:
    | Awaited<ReturnType<typeof callOpenAIChat>>
    | null = null;
  let report: ScoringReport | null = null;
  let fallbackUsed = false;
  let malformedRetryTriggered = false;
  let upstreamFallbackUsed = false;
  let fallbackReason: "provider_error" | "malformed_model_output" | null = null;
  let upstreamFailure: { statusCode: number; retryable: boolean } | null = null;
  let finalModel = scoringConfig?.model || DEFAULT_MODEL;
  let finalUsage: OpenAIUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };

  try {
    modelResponse = await invokeScoringModel(false);
    finalModel = modelResponse.model;
    finalUsage = modelResponse.usage;
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
      promptVersion,
      scenario,
      details: error instanceof Error ? error.message : String(error),
    });

    upstreamFallbackUsed = true;
    fallbackUsed = true;
    fallbackReason = "provider_error";
    upstreamFailure = {
      statusCode: upstream.statusCode,
      retryable: upstream.retryable,
    };
    report = fallbackScoringReport();
  }

  if (modelResponse) {
    report = parseScoringReport(modelResponse.content ?? "");
  }

  if (modelResponse && !report) {
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
        promptVersion,
        scenario,
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!report) {
    fallbackUsed = true;
    fallbackReason = fallbackReason ?? "malformed_model_output";
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
      promptVersion,
      sessionId: request.metadata.sessionId,
      turnIndex: request.metadata.turnIndex,
      fallbackUsed,
      malformedRetryTriggered,
      upstreamFallbackUsed,
      fallbackReason,
      upstreamFailure,
    },
  };

  // Persist evaluation to SessionEvaluation table when using context-based flow
  if (request.context?.sessionId && EVALUATION_TABLE_NAME && report) {
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

      // Course-LMS integration: update best-attempt cache + mirror AI feedback into ReviewerFeedback.
      await updateCourseBestAttempt(
        request.context.sessionId,
        request.context.assignmentId,
        report.totalScore,
        report.overallExplanation
      );
    } catch (e) {
      console.warn("Failed to persist evaluation:", e);
    }
  }

  console.log("llm-scoring request completed", {
    requestId,
    userID: request.userID,
    context: request.context,
    model: finalModel,
    latencyMs,
    usage: finalUsage,
    promptVersion,
    scenario,
    maxOutputTokens,
    sessionId: request.metadata.sessionId,
    turnIndex: request.metadata.turnIndex,
    fallbackUsed,
    malformedRetryTriggered,
    upstreamFallbackUsed,
    fallbackReason,
  });

  return respond(HTTP_STATUS.OK, responseBody);
};

// ───────────── Course-LMS best-attempt + AI feedback mirror ─────────────

async function updateCourseBestAttempt(
  sessionId: string,
  assignmentIdHint: string | undefined,
  totalScore: number,
  overallExplanation: string
): Promise<void> {
  if (
    !ASSIGNMENT_TABLE_NAME ||
    !MODULE_ITEM_TABLE_NAME ||
    !STUDENT_ITEM_PROGRESS_TABLE_NAME ||
    !REVIEWER_FEEDBACK_TABLE_NAME
  ) {
    return;
  }
  try {
    const { GetCommand, ScanCommand } = await import("@aws-sdk/lib-dynamodb");

    let assignmentId = assignmentIdHint;
    let session: any = null;
    if (!assignmentId && SESSION_TABLE_NAME) {
      const sRes = await dynamo.send(
        new GetCommand({ TableName: SESSION_TABLE_NAME, Key: { sessionId } })
      );
      session = sRes.Item;
      assignmentId = session?.assignmentId;
    } else if (SESSION_TABLE_NAME) {
      const sRes = await dynamo.send(
        new GetCommand({ TableName: SESSION_TABLE_NAME, Key: { sessionId } })
      );
      session = sRes.Item;
    }
    if (!assignmentId || !session?.studentUserId) return;
    const studentUserId = session.studentUserId;

    const aRes = await dynamo.send(
      new GetCommand({ TableName: ASSIGNMENT_TABLE_NAME, Key: { assignmentId } })
    );
    const assignment = aRes.Item;
    const moduleItemId = assignment?.moduleItemId;
    const courseId = assignment?.courseId;
    if (!moduleItemId || !courseId) return;

    const miRes = await dynamo.send(
      new GetCommand({ TableName: MODULE_ITEM_TABLE_NAME, Key: { moduleItemId } })
    );
    const moduleItem = miRes.Item;
    if (!moduleItem) return;

    // Read existing progress and decide whether new attempt is the new best.
    const pRes = await dynamo.send(
      new GetCommand({
        TableName: STUDENT_ITEM_PROGRESS_TABLE_NAME,
        Key: { moduleItemId, studentUserId },
      })
    );
    const existing = pRes.Item;
    const isBetter =
      existing?.bestSessionScore == null || totalScore > existing.bestSessionScore;
    if (!isBetter) {
      return;
    }
    const now = generateTimestamp();
    const next = {
      moduleItemId,
      studentUserId,
      courseId,
      moduleId: moduleItem.moduleId,
      ...(existing || {}),
      state: existing?.state || "completed",
      bestSessionId: sessionId,
      bestSessionScore: totalScore,
      completedAt: existing?.completedAt || now,
      startedAt: existing?.startedAt || session.startedAt || now,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    await putItem(STUDENT_ITEM_PROGRESS_TABLE_NAME, next, dynamo);

    // Mirror AI feedback for that (moduleItemId, studentUserId): upsert single AI row.
    const score1to7 = Math.max(1, Math.min(7, Math.round((totalScore / 24) * 7)));
    const fbScan = await dynamo.send(
      new ScanCommand({
        TableName: REVIEWER_FEEDBACK_TABLE_NAME,
        FilterExpression: "moduleItemId = :i AND studentUserId = :s AND #src = :src",
        ExpressionAttributeNames: { "#src": "source" },
        ExpressionAttributeValues: {
          ":i": moduleItemId,
          ":s": studentUserId,
          ":src": "ai",
        },
      })
    );
    const existingAi = (fbScan.Items || [])[0];
    if (existingAi?.locked) {
      // Don't overwrite locked AI feedback (student has submitted ai_detection).
      return;
    }
    const aiRow = {
      feedbackId: existingAi?.feedbackId || cryptoRandomId(),
      moduleItemId,
      studentUserId,
      source: "ai",
      reviewerUserId: null,
      displayLabel: existingAi?.displayLabel || "AI",
      body: overallExplanation,
      score: score1to7,
      basedOnSessionId: sessionId,
      revealed: existingAi?.revealed ?? false,
      locked: false,
      createdAt: existingAi?.createdAt || now,
      updatedAt: now,
    };
    await putItem(REVIEWER_FEEDBACK_TABLE_NAME, aiRow, dynamo);

    // Emit event.
    if (EVENT_LOG_TABLE_NAME) {
      const dateKey = now.slice(0, 10);
      await putItem(
        EVENT_LOG_TABLE_NAME,
        {
          eventId: cryptoRandomId(),
          studentUserId,
          studentDateKey: `${studentUserId}#${dateKey}`,
          courseId,
          moduleId: moduleItem.moduleId,
          moduleItemId,
          eventType: "best_attempt_updated",
          payload: { sessionId, totalScore, score1to7 },
          createdAt: now,
        },
        dynamo
      );
    }
  } catch (e) {
    console.warn("updateCourseBestAttempt failed", e);
  }
}

function cryptoRandomId(): string {
  return randomUUID();
}
