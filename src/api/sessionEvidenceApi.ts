import { apiGet } from "./apiClient";

/**
 * Faculty-side read-only client for SessionEvidence.
 *
 * Backed by GET /sessions/{sessionId}/evidence (added in this round). The
 * endpoint returns the persisted /llm-scoring evidence rows for one session
 * — including rawEvidencePayload which carries
 * studyTaskContext.interactionEvents (cue_pressed) entries we render as Cue
 * Support Access events in the faculty session/transcript view.
 *
 * Strictly read-only. No write path. No schema change. No /llm-scoring or
 * /llm-dialogue contract change.
 */

export interface CuePressedInteractionEvent {
  eventType: "cue_pressed";
  // The Unity client has shipped under multiple field names for the cue
  // press time. Frontend extraction tries these in priority order:
  //   timestamp → occurredAt → clientTimestamp → serverTimestamp
  // The interface keeps all four optional so older Unity payloads still
  // parse without TypeScript narrowing complaints.
  timestamp?: string;
  occurredAt?: string;
  clientTimestamp?: string;
  serverTimestamp?: string;
  cueLevel?: string;
  sectionId?: string;
  taskId?: string;
  itemId?: string;
  cueText?: string;
  // Defensive: accept any other unknown fields the backend may forward
  // verbatim from the Unity payload.
  [extra: string]: unknown;
}

export interface SessionEvidenceRow {
  evidenceId: string;
  sessionId: string;
  assignmentId: string;
  studentUserId: string;
  phaseId: string;
  taskType: string | null;
  sectionId: string | null;
  taskId: string | null;
  patientProfileId: string | null;
  /**
   * Verbatim copy of the /llm-scoring envelope persisted at evidence time.
   * Shape may evolve as Unity adds telemetry; downstream consumers must be
   * defensive about missing fields. Notably we look for:
   *   rawEvidencePayload.studyTaskContext.interactionEvents[*].eventType === "cue_pressed"
   */
  rawEvidencePayload: Record<string, unknown> | null;
  submittedAt: string;
  createdAt: string;
}

export interface ListSessionEvidenceResponse {
  evidence: SessionEvidenceRow[];
}

export const sessionEvidenceApi = {
  /**
   * Fetches all evidence rows for a session. Returns an empty array when no
   * evidence has been written (e.g., the session never reached a /llm-scoring
   * finalize). 404 means the session itself does not exist; the caller should
   * treat that as "no cue events recorded" rather than a hard error.
   */
  listBySession: (sessionId: string) =>
    apiGet<ListSessionEvidenceResponse>(`/sessions/${sessionId}/evidence`),
};
