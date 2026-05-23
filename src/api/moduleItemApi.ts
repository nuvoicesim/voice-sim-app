import { apiGet, apiPost, apiPut, apiDelete } from "./apiClient";

export const moduleItemApi = {
  list: (moduleId: string) => apiGet(`/modules/${moduleId}/items`),
  create: (moduleId: string, data: any) =>
    apiPost(`/modules/${moduleId}/items`, data),
  get: (itemId: string) => apiGet(`/module-items/${itemId}`),
  update: (itemId: string, data: any) => apiPut(`/module-items/${itemId}`, data),
  delete: (itemId: string) => apiDelete(`/module-items/${itemId}`),

  // Progress
  getProgress: (itemId: string, studentUserId?: string) =>
    apiGet(
      `/module-items/${itemId}/progress`,
      studentUserId ? { studentUserId } : undefined
    ),
  updateProgress: (itemId: string, state: string) =>
    apiPost(`/module-items/${itemId}/progress`, { state }),

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
