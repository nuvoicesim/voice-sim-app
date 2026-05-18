// Phase 2 evidence persistence branch for POST /llm-scoring.
//
// Per the May 18 faculty decision, Phase 2 training submissions must NOT
// produce a student-facing AI training report. Instead, the full Unity
// evidence body is persisted to SessionEvidence so future Phase 3 debrief and
// future Phase 2 cue telemetry can reuse it without any backend change.
//
// This branch:
//   - validates only the minimal envelope (auth already done in handler.ts)
//   - calls NO OpenAI
//   - writes NO SessionEvaluation
//   - writes NO ReviewerFeedback
//   - persists the full raw body verbatim as rawEvidencePayload
//   - returns a compatibility success response sufficient for current Unity
//     Finish flow.

import type { APIGatewayProxyResult } from "aws-lambda";
import { randomUUID } from "crypto";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { HTTP_STATUS, createResponse, putItem, generateTimestamp } from "../shared";
import type { RuntimeTokenClaims } from "../shared/runtime-token";

export interface Phase2EvidenceDeps {
  dynamo: DynamoDBDocumentClient;
  requestId: string;
  corsHeaders: Record<string, string>;
  runtimeClaims: RuntimeTokenClaims;
  sessionEvidenceTableName: string | undefined;
}

interface Phase2RequestEnvelope {
  userID?: string;
  context?: { assignmentId?: string; sessionId?: string };
  taskContext?: {
    phaseId?: string;
    feedbackUse?: string;
    scoringMode?: string;
    sectionId?: string;
    taskType?: string;
    taskId?: string;
    patientProfileId?: string;
  };
  studyTaskContext?: Record<string, unknown>;
  [k: string]: unknown;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function nullableString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function respond(
  deps: Phase2EvidenceDeps,
  statusCode: number,
  body: Record<string, unknown>
): APIGatewayProxyResult {
  return createResponse(statusCode, body, deps.corsHeaders);
}

function validatePhase2Envelope(payload: unknown): {
  body?: Phase2RequestEnvelope;
  error?: string;
} {
  const obj = asObject(payload);
  if (!obj) return { error: "Request body must be a JSON object" };

  const ctx = asObject(obj.context);
  const assignmentId = typeof ctx?.assignmentId === "string" ? ctx.assignmentId.trim() : "";
  const sessionId = typeof ctx?.sessionId === "string" ? ctx.sessionId.trim() : "";
  if (!assignmentId || !sessionId) {
    return { error: "Phase 2 evidence requires context.assignmentId and context.sessionId" };
  }

  if (typeof obj.userID !== "string" || !obj.userID.trim()) {
    return { error: "Missing required field: userID" };
  }

  const tc = asObject(obj.taskContext);
  if (!tc) {
    return { error: "Phase 2 evidence requires taskContext" };
  }

  const studyCtx = asObject(obj.studyTaskContext);
  if (!studyCtx) {
    return { error: "Phase 2 evidence requires studyTaskContext" };
  }

  return {
    body: {
      userID: obj.userID,
      context: { assignmentId, sessionId },
      taskContext: tc as Phase2RequestEnvelope["taskContext"],
      studyTaskContext: studyCtx as Phase2RequestEnvelope["studyTaskContext"],
      ...obj,
    },
  };
}

export async function handlePhase2Evidence(
  payload: unknown,
  deps: Phase2EvidenceDeps
): Promise<APIGatewayProxyResult> {
  const validation = validatePhase2Envelope(payload);
  if (!validation.body) {
    return respond(deps, HTTP_STATUS.BAD_REQUEST, {
      error: validation.error ?? "Invalid Phase 2 evidence request",
      requestId: deps.requestId,
      retryable: false,
    });
  }
  const envelope = validation.body;

  if (!deps.sessionEvidenceTableName) {
    return respond(deps, HTTP_STATUS.INTERNAL_SERVER_ERROR, {
      error: "Phase 2 evidence persistence is not configured",
      requestId: deps.requestId,
      retryable: false,
    });
  }

  const tc = envelope.taskContext ?? {};
  const evidenceId = randomUUID();
  const now = generateTimestamp();
  const studentUserId =
    nullableString(deps.runtimeClaims.sub) ||
    nullableString(envelope.userID) ||
    "";

  const row = {
    evidenceId,
    sessionId: envelope.context!.sessionId!,
    assignmentId: envelope.context!.assignmentId!,
    studentUserId,
    phaseId: "phase2",
    taskType: nullableString(tc.taskType),
    sectionId: nullableString(tc.sectionId),
    taskId: nullableString(tc.taskId),
    itemId: undefined,
    patientProfileId: nullableString(tc.patientProfileId),
    feedbackUse: nullableString(tc.feedbackUse) ?? "phase2_training_evidence",
    scoringMode: nullableString(tc.scoringMode),
    promptVersion: undefined,
    rawEvidencePayload: envelope as unknown as Record<string, unknown>,
    rubricAssessmentPayload: undefined,
    submittedAt: now,
    createdAt: now,
  };

  try {
    await putItem(deps.sessionEvidenceTableName, row, deps.dynamo);
  } catch (e) {
    console.error("[phase2-evidence] SessionEvidence putItem failed", {
      requestId: deps.requestId,
      sessionId: row.sessionId,
      details: e instanceof Error ? e.message : String(e),
    });
    return respond(deps, HTTP_STATUS.INTERNAL_SERVER_ERROR, {
      error: "Failed to persist Phase 2 evidence",
      requestId: deps.requestId,
      retryable: true,
    });
  }

  console.log("[phase2-evidence] persisted", {
    requestId: deps.requestId,
    evidenceId,
    sessionId: row.sessionId,
    assignmentId: row.assignmentId,
    taskType: row.taskType,
  });

  return respond(deps, HTTP_STATUS.OK, {
    requestId: deps.requestId,
    status: "ok",
    persisted: true,
    evidenceId,
    metadata: {
      sessionId: row.sessionId,
      phaseId: "phase2",
      feedbackUse: "phase2_training_evidence",
    },
    createdAt: new Date().toISOString(),
  });
}
