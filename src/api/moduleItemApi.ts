import { apiGet, apiPost, apiPut, apiDelete } from "./apiClient";

export const moduleItemApi = {
  list: (moduleId: string) => apiGet(`/modules/${moduleId}/items`),
  create: (moduleId: string, data: any) =>
    apiPost(`/modules/${moduleId}/items`, data),
  get: (itemId: string) => apiGet(`/module-items/${itemId}`),
  // Idempotent server-side Phase 3 survey-flow setup (Parts A–C + Part D).
  // Shares the /items route (?operation=...) to avoid adding an API Gateway
  // resource — api-stack sits at CloudFormation's 500-resource limit.
  phase3Setup: (
    moduleId: string,
    body: { partsACTemplateId?: string; partDTemplateId?: string }
  ) => apiPost(`/modules/${moduleId}/items?operation=phase3-setup`, body),

  // ── Phase 3 feedback data import ──
  // All four operations share the SAME /modules/{moduleId}/items route via
  // ?operation=... for the same reason as phase3-setup: a dedicated route would
  // add an API Gateway Resource + Method + Lambda Permission to api-stack, which
  // is at CloudFormation's 500-resource limit.
  //
  // The browser only ever sends raw CSV text and confirmation strings. The
  // Parts A–C / Part D item ids, the provenance constants and every gate are
  // derived server-side and re-checked on commit.
  phase3Status: (moduleId: string) =>
    apiPost(`/modules/${moduleId}/items?operation=phase3-status`, {}),
  phase3ImportPreview: (
    moduleId: string,
    body: { mode: "tester" | "formal"; csv: string }
  ) =>
    apiPost(`/modules/${moduleId}/items?operation=phase3-import-preview`, body),
  phase3ImportCommit: (
    moduleId: string,
    body: {
      mode: "tester" | "formal";
      csv: string;
      expectedPlanHash: string;
      confirmTesterEmail?: string;
      confirmProvenance?: { assignmentVersion: string; randomSeed: string };
      confirmFormalPhrase?: string;
    }
  ) =>
    apiPost(`/modules/${moduleId}/items?operation=phase3-import-commit`, body),
  phase3PurgeTester: (
    moduleId: string,
    body: {
      scope: "one" | "all";
      studentUserId?: string;
      commit: boolean;
      confirmText?: string;
    }
  ) => apiPost(`/modules/${moduleId}/items?operation=phase3-purge-tester`, body),

  update: (itemId: string, data: any) => apiPut(`/module-items/${itemId}`, data),
  delete: (itemId: string) => apiDelete(`/module-items/${itemId}`),

  // Progress
  getProgress: (itemId: string, studentUserId?: string) =>
    apiGet(
      `/module-items/${itemId}/progress`,
      studentUserId ? { studentUserId } : undefined
    ),
  updateProgress: (
    itemId: string,
    state: string,
    options?: { submissionImageUrls?: string[] }
  ) =>
    apiPost(`/module-items/${itemId}/progress`, {
      state,
      ...(options?.submissionImageUrls !== undefined
        ? { submissionImageUrls: options.submissionImageUrls }
        : {}),
    }),

  // Randomizer
  randomize: (itemId: string) => apiPost(`/module-items/${itemId}/randomize`, {}),

  // Reviewers
  listReviewers: (itemId: string, studentUserId?: string) =>
    apiGet(
      `/module-items/${itemId}/reviewers`,
      studentUserId ? { studentUserId } : undefined
    ),
  assignReviewers: (
    itemId: string,
    studentUserId: string,
    reviewerUserIds: string[]
  ) =>
    apiPost(`/module-items/${itemId}/reviewers`, {
      studentUserId,
      reviewerUserIds,
    }),

  // Feedback
  listFeedback: (itemId: string, studentUserId?: string) =>
    apiGet(
      `/module-items/${itemId}/feedback`,
      studentUserId ? { studentUserId } : undefined
    ),
  submitFeedback: (
    itemId: string,
    studentUserId: string,
    score: number | null,
    body: string
  ) =>
    apiPost(`/module-items/${itemId}/feedback`, { studentUserId, score, body }),

  // Best session
  getBestSession: (itemId: string, studentUserId: string) =>
    apiGet(`/module-items/${itemId}/best-session`, { studentUserId }),

  // AI detection
  getSubQuestions: (itemId: string, studentUserId?: string) =>
    apiGet(
      `/module-items/${itemId}/sub-questions`,
      studentUserId ? { studentUserId } : undefined
    ),
  submitSubAnswer: (
    itemId: string,
    assignmentItemId: string,
    pickedDisplayKey: string,
    followUpText?: string
  ) =>
    apiPost(`/module-items/${itemId}/sub-answer`, {
      assignmentItemId,
      pickedDisplayKey,
      followUpText,
    }),
};
