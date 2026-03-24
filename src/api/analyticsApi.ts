import { apiGet } from "./apiClient";

export const analyticsApi = {
  student: (studentUserId: string) =>
    apiGet(`/analytics/student/${studentUserId}`),

  cohort: (params?: Record<string, string>) =>
    apiGet("/analytics/cohort", params),

  platform: () =>
    apiGet("/analytics/platform"),

  surveys: (params?: Record<string, string>) =>
    apiGet("/analytics/surveys", params),
};
