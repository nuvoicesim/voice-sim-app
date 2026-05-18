// Phase 1 rubric scoring branch for POST /llm-scoring.
//
// Responsibilities:
//   1. Validate the minimal request envelope (runtime token already enforced
//      by handler.ts upstream).
//   2. Resolve the per-section rubric config (Section A/B/C/D).
//   3. Build a constrained OpenAI request using Structured Outputs.
//   4. Parse + retry on malformed output; fall back to a "rubric pending"
//      response rather than 500 when parsing fails.
//   5. Persist a SessionEvidence row carrying the raw Unity payload and the
//      produced rubricAssessment so Phase 3 debrief can reuse it.
//   6. Build the Unity-facing JSON response.

import type { APIGatewayProxyResult } from "aws-lambda";
import { randomUUID } from "crypto";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import {
  HTTP_STATUS,
  createResponse,
  callOpenAIChat,
  OpenAIUpstreamError,
  putItem,
  generateTimestamp,
  type OpenAIMessage,
  type OpenAIUsage,
} from "../shared";
import type { RuntimeTokenClaims } from "../shared/runtime-token";

import {
  PROMPT_VERSION,
  resolvePhase1RubricConfig,
  type Phase1RubricSectionConfig,
} from "./phase1-rubric-config";

const DEFAULT_MODEL = process.env.LLM_SCORING_MODEL || "gpt-4o-2024-08-06";
const DEFAULT_TEMPERATURE = Number(process.env.LLM_SCORING_TEMPERATURE ?? "0.2");
const DEFAULT_MAX_OUTPUT_TOKENS = Number(process.env.LLM_SCORING_MAX_OUTPUT_TOKENS ?? "3000");
const DEFAULT_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? "12000");
const UPSTREAM_RETRIES = Number(process.env.LLM_UPSTREAM_RETRIES ?? "1");
const MAX_INPUT_CHARS = Number(process.env.LLM_SCORING_MAX_INPUT_CHARS ?? "50000");

const STRICT_RETRY_INSTRUCTION = [
  "CRITICAL OUTPUT REQUIREMENTS:",
  "Return ONLY valid JSON matching the rubric response schema.",
  "Do not include markdown fences, prose, or commentary.",
  "All required keys must be present.",
].join(" ");

export interface Phase1RubricDeps {
  dynamo: DynamoDBDocumentClient;
  openAiApiKey: string | undefined;
  requestId: string;
  corsHeaders: Record<string, string>;
  runtimeClaims: RuntimeTokenClaims;
  sessionEvidenceTableName: string | undefined;
}

interface Phase1RequestEnvelope {
  userID?: string;
  context?: { assignmentId?: string; sessionId?: string };
  taskContext?: {
    phaseId?: string;
    scoringMode?: string;
    feedbackUse?: string;
    sectionId?: string;
    taskType?: string;
    taskId?: string;
    patientProfileId?: string;
  };
  studyTaskContext?: {
    items?: unknown[];
    [k: string]: unknown;
  };
  conversationTurns?: unknown[];
  metadata?: Record<string, unknown>;
  [k: string]: unknown;
}

interface ParsedRubricResponse {
  sectionId?: string;
  taskType?: string;
  assessmentGranularity?: string;
  taskSummary?: string;
  itemFeedback?: unknown[];
  taskFeedback?: Record<string, unknown>;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function respond(
  deps: Phase1RubricDeps,
  statusCode: number,
  body: Record<string, unknown>
): APIGatewayProxyResult {
  return createResponse(statusCode, body, deps.corsHeaders);
}

// Validates the bare minimum the Phase 1 rubric branch needs. Optional and
// future-compat fields are NOT validated — they propagate verbatim into
// SessionEvidence.rawEvidencePayload.
function validatePhase1Envelope(payload: unknown): {
  body?: Phase1RequestEnvelope;
  error?: string;
} {
  const obj = asObject(payload);
  if (!obj) return { error: "Request body must be a JSON object" };

  const ctx = asObject(obj.context);
  const assignmentId = typeof ctx?.assignmentId === "string" ? ctx.assignmentId.trim() : "";
  const sessionId = typeof ctx?.sessionId === "string" ? ctx.sessionId.trim() : "";
  if (!assignmentId || !sessionId) {
    return { error: "Phase 1 rubric requires context.assignmentId and context.sessionId" };
  }

  if (typeof obj.userID !== "string" || !obj.userID.trim()) {
    return { error: "Missing required field: userID" };
  }

  const tc = asObject(obj.taskContext);
  if (!tc) {
    return { error: "Phase 1 rubric requires taskContext" };
  }

  const studyCtx = asObject(obj.studyTaskContext);
  if (!studyCtx) {
    return { error: "Phase 1 rubric requires studyTaskContext" };
  }

  return {
    body: {
      userID: obj.userID,
      context: { assignmentId, sessionId },
      taskContext: tc as Phase1RequestEnvelope["taskContext"],
      studyTaskContext: studyCtx as Phase1RequestEnvelope["studyTaskContext"],
      conversationTurns: Array.isArray(obj.conversationTurns) ? (obj.conversationTurns as unknown[]) : undefined,
      metadata: asObject(obj.metadata),
      ...obj,
    },
  };
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

function buildUserPrompt(envelope: Phase1RequestEnvelope, cfg: Phase1RubricSectionConfig): string {
  const items = envelope.studyTaskContext?.items ?? [];
  // Section B prompt also benefits from the full conversation transcript for
  // detecting examiner examples (horse/tiger) — include it when present.
  const include_transcript = cfg.sectionId === "B" && Array.isArray(envelope.conversationTurns);

  const promptPayload: Record<string, unknown> = {
    sectionId: cfg.sectionId,
    taskType: cfg.taskType,
    assessmentGranularity: cfg.granularity,
    scoreRange: { min: cfg.scoreMin, max: cfg.scoreMax },
    studyTaskContext: { items },
  };

  if (include_transcript) {
    promptPayload.conversationTurns = envelope.conversationTurns;
  }

  return [
    "Score the following student-conducted Phase 1 evidence using the rubric described in your system prompt.",
    "",
    "Evidence JSON:",
    safeJsonStringify(promptPayload),
  ].join("\n");
}

function parseRubricJson(content: string | null | undefined): ParsedRubricResponse | null {
  if (!content || content.trim() === "") return null;

  const candidates = [content];
  const first = content.indexOf("{");
  const last = content.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(content.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as ParsedRubricResponse;
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // try next
    }
  }
  return null;
}

function emptyItemsCheck(envelope: Phase1RequestEnvelope): boolean {
  const items = envelope.studyTaskContext?.items;
  return !Array.isArray(items) || items.length === 0;
}

function nullableString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

async function persistEvidence(
  deps: Phase1RubricDeps,
  envelope: Phase1RequestEnvelope,
  cfg: Phase1RubricSectionConfig,
  rubricPayload: Record<string, unknown> | null
): Promise<string | null> {
  if (!deps.sessionEvidenceTableName) return null;

  const evidenceId = randomUUID();
  const now = generateTimestamp();
  const tc = envelope.taskContext ?? {};
  const studentUserId =
    nullableString(deps.runtimeClaims.sub) ||
    nullableString(envelope.userID) ||
    "";

  const row = {
    evidenceId,
    sessionId: envelope.context?.sessionId ?? "",
    assignmentId: envelope.context?.assignmentId ?? "",
    studentUserId,
    phaseId: "phase1",
    taskType: nullableString(tc.taskType) ?? cfg.taskType,
    sectionId: nullableString(tc.sectionId) ?? cfg.sectionId,
    taskId: nullableString(tc.taskId),
    itemId: undefined,
    patientProfileId: nullableString(tc.patientProfileId),
    feedbackUse: nullableString(tc.feedbackUse) ?? "phase1_rubric_assessment",
    scoringMode: nullableString(tc.scoringMode) ?? "phase1-rubric",
    promptVersion: PROMPT_VERSION,
    rawEvidencePayload: envelope as unknown as Record<string, unknown>,
    rubricAssessmentPayload: rubricPayload ?? undefined,
    submittedAt: now,
    createdAt: now,
  };

  try {
    await putItem(deps.sessionEvidenceTableName, row, deps.dynamo);
    return evidenceId;
  } catch (e) {
    console.warn("[phase1-rubric] SessionEvidence putItem failed", e);
    return null;
  }
}

// Build the Unity-facing rubricAssessment object from the parsed model output,
// echoing only fields permitted by the per-section schema.
function buildRubricAssessmentPayload(
  cfg: Phase1RubricSectionConfig,
  parsed: ParsedRubricResponse
): Record<string, unknown> {
  if (cfg.granularity === "task_level") {
    return {
      sectionId: cfg.sectionId,
      taskType: cfg.taskType,
      assessmentGranularity: "task_level",
      taskSummary: typeof parsed.taskSummary === "string" ? parsed.taskSummary : undefined,
      taskFeedback: parsed.taskFeedback ?? undefined,
    };
  }

  return {
    sectionId: cfg.sectionId,
    taskType: cfg.taskType,
    assessmentGranularity: "item_level",
    taskSummary: typeof parsed.taskSummary === "string" ? parsed.taskSummary : undefined,
    itemFeedback: Array.isArray(parsed.itemFeedback) ? parsed.itemFeedback : [],
  };
}

export async function handlePhase1Rubric(
  payload: unknown,
  deps: Phase1RubricDeps
): Promise<APIGatewayProxyResult> {
  const validation = validatePhase1Envelope(payload);
  if (!validation.body) {
    return respond(deps, HTTP_STATUS.BAD_REQUEST, {
      error: validation.error ?? "Invalid Phase 1 rubric request",
      requestId: deps.requestId,
      retryable: false,
    });
  }

  const envelope = validation.body;
  const tc = envelope.taskContext ?? {};
  const cfg = resolvePhase1RubricConfig(tc.sectionId, tc.taskType);

  if (!cfg) {
    return respond(deps, HTTP_STATUS.BAD_REQUEST, {
      error: "Phase 1 rubric requires a recognized taskContext.sectionId (A/B/C/D) or taskContext.taskType",
      requestId: deps.requestId,
      retryable: false,
    });
  }

  const createdAt = new Date().toISOString();
  const startedAt = Date.now();

  // Soft-fail when items[] is empty: A/B Unity wiring is still pending and
  // Brandon's smoke tests should not 500 just because the scene hasn't sent
  // items yet. Unity renders the rubric placeholder via ShowRubricWaitingState.
  if (emptyItemsCheck(envelope)) {
    const evidenceId = await persistEvidence(deps, envelope, cfg, null);
    return respond(deps, HTTP_STATUS.OK, {
      requestId: deps.requestId,
      rubricAssessment: null,
      metadata: {
        sessionId: envelope.context!.sessionId,
        feedbackUse: "phase1_rubric_assessment",
        promptVersion: PROMPT_VERSION,
        sectionId: cfg.sectionId,
        taskType: cfg.taskType,
        fallbackUsed: true,
        fallbackReason: "empty_items",
        evidenceId,
      },
      createdAt,
      latencyMs: Date.now() - startedAt,
    });
  }

  if (!deps.openAiApiKey) {
    const evidenceId = await persistEvidence(deps, envelope, cfg, null);
    return respond(deps, HTTP_STATUS.INTERNAL_SERVER_ERROR, {
      error: "Phase 1 rubric service not configured",
      requestId: deps.requestId,
      retryable: false,
      metadata: { evidenceId, promptVersion: PROMPT_VERSION, sectionId: cfg.sectionId },
    });
  }

  const userPrompt = buildUserPrompt(envelope, cfg);
  if (userPrompt.length > MAX_INPUT_CHARS) {
    return respond(deps, 413, {
      error: "Phase 1 rubric prompt exceeds allowed size",
      requestId: deps.requestId,
      retryable: false,
    });
  }

  const invokeRubricModel = async (strictMode: boolean) => {
    const messages: OpenAIMessage[] = [
      { role: "system", content: cfg.systemPrompt },
      { role: "user", content: userPrompt },
    ];
    if (strictMode) {
      messages.splice(1, 0, { role: "system", content: STRICT_RETRY_INSTRUCTION });
    }
    return callOpenAIChat({
      apiKey: deps.openAiApiKey!,
      model: cfg.model || DEFAULT_MODEL,
      messages,
      temperature: cfg.temperature ?? DEFAULT_TEMPERATURE,
      maxOutputTokens: cfg.maxOutputTokens || DEFAULT_MAX_OUTPUT_TOKENS,
      responseFormat: cfg.responseFormat,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      upstreamRetries: UPSTREAM_RETRIES,
    });
  };

  let parsed: ParsedRubricResponse | null = null;
  let finalModel = cfg.model || DEFAULT_MODEL;
  let finalUsage: OpenAIUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let fallbackUsed = false;
  let fallbackReason: "provider_error" | "malformed_model_output" | null = null;
  let malformedRetryTriggered = false;
  let upstreamFailure: { statusCode: number; retryable: boolean } | null = null;

  try {
    const first = await invokeRubricModel(false);
    finalModel = first.model;
    finalUsage = first.usage;
    parsed = parseRubricJson(first.content);
    if (!parsed) {
      malformedRetryTriggered = true;
      try {
        const retry = await invokeRubricModel(true);
        finalModel = retry.model;
        finalUsage = retry.usage;
        parsed = parseRubricJson(retry.content);
      } catch (retryErr) {
        console.error("[phase1-rubric] strict retry failed", {
          requestId: deps.requestId,
          sectionId: cfg.sectionId,
          details: retryErr instanceof Error ? retryErr.message : String(retryErr),
        });
      }
    }
  } catch (err) {
    fallbackUsed = true;
    fallbackReason = "provider_error";
    if (err instanceof OpenAIUpstreamError) {
      upstreamFailure = { statusCode: err.statusCode, retryable: err.retryable };
    }
    console.error("[phase1-rubric] upstream error", {
      requestId: deps.requestId,
      sectionId: cfg.sectionId,
      details: err instanceof Error ? err.message : String(err),
    });
  }

  if (!parsed) {
    fallbackUsed = true;
    fallbackReason = fallbackReason ?? "malformed_model_output";
  }

  const rubricAssessment = parsed ? buildRubricAssessmentPayload(cfg, parsed) : null;
  const evidenceId = await persistEvidence(deps, envelope, cfg, rubricAssessment);

  return respond(deps, HTTP_STATUS.OK, {
    requestId: deps.requestId,
    rubricAssessment,
    metadata: {
      sessionId: envelope.context!.sessionId,
      feedbackUse: "phase1_rubric_assessment",
      promptVersion: PROMPT_VERSION,
      sectionId: cfg.sectionId,
      taskType: cfg.taskType,
      fallbackUsed,
      fallbackReason,
      malformedRetryTriggered,
      upstreamFailure,
      evidenceId,
    },
    createdAt,
    latencyMs: Date.now() - startedAt,
    model: finalModel,
    usage: finalUsage,
  });
}
