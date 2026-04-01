import { apiGet, apiPost, apiPut } from "./apiClient";

export const sceneCatalogApi = {
  list: () =>
    apiGet("/scene-catalog"),

  get: (sceneId: string) =>
    apiGet("/scene-catalog", { sceneId }),

  create: (data: any) =>
    apiPost("/scene-catalog", data),

  update: (sceneId: string, data: any) =>
    apiPut(`/scene-catalog/${sceneId}`, data),

  archive: (sceneId: string) =>
    apiPost(`/scene-catalog/${sceneId}/archive`, {}),
};
