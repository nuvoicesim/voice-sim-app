import { apiGet, apiPost, apiPut } from "./apiClient";

export const sessionApi = {
  start: (assignmentId: string) =>
    apiPost("/sessions", { assignmentId }),

  get: (sessionId: string) =>
    apiGet(`/sessions/${sessionId}`),

  complete: (sessionId: string) =>
    apiPut(`/sessions/${sessionId}/complete`, {}),

  listByAssignment: (assignmentId: string, params?: Record<string, string>) =>
    apiGet(`/assignments/${assignmentId}/sessions`, params),

  listMy: () =>
    apiGet("/sessions"),
};
