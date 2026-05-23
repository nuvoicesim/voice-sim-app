import { apiGet, apiPost, apiPut } from "./apiClient";

export const sessionApi = {
  start: (assignmentId: string) =>
    apiPost("/sessions", { assignmentId }),

  get: (sessionId: string) =>
    apiGet(`/sessions/${sessionId}`),

  getRuntimeToken: (sessionId: string) =>
    apiPost(`/sessions/${sessionId}/runtime-token`, { client: "unity-webgl" }),

  complete: (sessionId: string, runtimeToken: string) =>
    apiPut(
      `/sessions/${sessionId}/complete`,
      {},
      { Authorization: `Bearer ${runtimeToken}` }
    ),

  listByAssignment: (assignmentId: string, params?: Record<string, string>) =>
    apiGet(`/assignments/${assignmentId}/sessions`, params),

  listMy: () =>
    apiGet("/sessions"),
};
