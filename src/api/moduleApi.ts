import { apiGet, apiPost, apiPut, apiDelete } from "./apiClient";

export const moduleApi = {
  list: (courseId: string) => apiGet(`/courses/${courseId}/modules`),
  create: (courseId: string, data: any) =>
    apiPost(`/courses/${courseId}/modules`, data),
  update: (moduleId: string, data: any) => apiPut(`/modules/${moduleId}`, data),
  delete: (moduleId: string) => apiDelete(`/modules/${moduleId}`),
  reorderItems: (moduleId: string, orderedIds: string[]) =>
    apiPost(`/modules/${moduleId}/reorder`, { orderedIds }),
  reorderModules: (courseId: string, orderedIds: string[]) =>
    apiPost(`/courses/${courseId}/modules/reorder`, { orderedIds }),
};
