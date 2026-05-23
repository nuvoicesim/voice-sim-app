import { apiGet, apiPost, apiPut, apiDelete } from "./apiClient";

export const surveyTemplateApi = {
  list: () => apiGet("/survey-templates"),
  get: (id: string) => apiGet(`/survey-templates/${id}`),
  create: (data: { name: string; description?: string; questions: any[] }) =>
    apiPost("/survey-templates", data),
  update: (id: string, data: any) => apiPut(`/survey-templates/${id}`, data),
  delete: (id: string) => apiDelete(`/survey-templates/${id}`),
};
