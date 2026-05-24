import { apiGet, apiPost, apiPut } from "./apiClient";

export interface SurveyInstanceRow {
  moduleItemId: string;
  studentUserId: string;
  surveyInstanceId: string;
  surveyTemplateId: string;
  courseId: string;
  schemaSnapshot?: any;
  answers?: Record<string, any>;
  status: "in_progress" | "submitted";
  startedAt?: string;
  submittedAt?: string;
  updatedAt?: string;
}

export const surveyInstanceApi = {
  getMine: (itemId: string) => apiGet(`/module-items/${itemId}/survey-instance`),
  getForStudent: (itemId: string, studentUserId: string) =>
    apiGet<{ instance: SurveyInstanceRow | null }>(
      `/module-items/${itemId}/survey-instance`,
      { studentUserId }
    ),
  saveAnswers: (itemId: string, answers: Record<string, any>) =>
    apiPut(`/module-items/${itemId}/survey-instance`, { answers }),
  submit: (itemId: string) =>
    apiPost(`/module-items/${itemId}/survey-instance/submit`, {}),
  listByAssignment: (assignmentId: string) =>
    apiGet(`/assignments/${assignmentId}/survey-instances`),
};
