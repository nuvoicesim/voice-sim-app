import { apiGet, apiPost, apiPut } from "./apiClient";

export const assignmentApi = {
  list: (params?: { status?: string }) =>
    apiGet("/assignments", params as Record<string, string>),

  get: (assignmentId: string) =>
    apiGet(`/assignments/${assignmentId}`),

  create: (data: any) =>
    apiPost("/assignments", data),

  update: (assignmentId: string, data: any) =>
    apiPut(`/assignments/${assignmentId}`, data),

  updateStatus: (assignmentId: string, status: string) =>
    apiPut(`/assignments/${assignmentId}/status`, { status }),
};
