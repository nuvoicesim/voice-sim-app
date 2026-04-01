import { apiDelete, apiGet, apiPost, apiPut } from "./apiClient";

export interface UnityBuild {
  unityBuildId: string;
  displayName: string;
  buildKey: string;
  sourceZipKey: string;
  sourceFileName: string;
  entryHtml: string;
  publishedPrefix?: string;
  publicBaseUrl?: string;
  launchUrl?: string;
  status: "uploaded" | "published" | "archived" | "failed";
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UnityBuildUploadUrlResponse {
  unityBuild: UnityBuild;
  uploadUrl: string;
  uploadBucketName?: string | null;
  uploadMethod: "PUT";
  uploadHeaders: {
    "Content-Type": string;
  };
}

export const unityBuildApi = {
  list: () => apiGet<{ unityBuilds: UnityBuild[] }>("/unity-builds"),

  get: (unityBuildId: string) =>
    apiGet<UnityBuild>(`/unity-builds/${unityBuildId}`),

  createUploadUrl: (data: {
    displayName: string;
    buildKey: string;
    fileName: string;
    contentType?: string;
    entryHtml?: string;
  }) =>
    apiPost<UnityBuildUploadUrlResponse>("/unity-builds/upload-url", data),

  replaceUploadUrl: (
    unityBuildId: string,
    data: {
      displayName?: string;
      fileName: string;
      contentType?: string;
      entryHtml?: string;
    }
  ) =>
    apiPost<UnityBuildUploadUrlResponse>(`/unity-builds/${unityBuildId}/upload-url`, data),

  publish: (unityBuildId: string) =>
    apiPost<{ unityBuild: UnityBuild }>(`/unity-builds/${unityBuildId}/publish`, {}),

  update: (unityBuildId: string, data: { displayName?: string; entryHtml?: string }) =>
    apiPut<UnityBuild>(`/unity-builds/${unityBuildId}`, data),

  delete: (unityBuildId: string) =>
    apiDelete(`/unity-builds/${unityBuildId}`),
};
