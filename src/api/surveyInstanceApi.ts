import { apiGet, apiPost, apiPut } from "./apiClient";

export const surveyInstanceApi = {
  getMine: (itemId: string) => apiGet(`/module-items/${itemId}/survey-instance`),
  saveAnswers: (itemId: string, answers: Record<string, any>) =>
    apiPut(`/module-items/${itemId}/survey-instance`, { answers }),
  submit: (itemId: string) =>
    apiPost(`/module-items/${itemId}/survey-instance/submit`, {}),
  listByAssignment: (assignmentId: string) =>
    apiGet(`/assignments/${assignmentId}/survey-instances`),
};
