import { apiPost } from "./apiClient";

export interface UploadUrlResponse {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  expiresIn: number;
}

export const moduleAssetApi = {
  requestUploadUrl: (contentType: string, sizeBytes: number) =>
    apiPost<UploadUrlResponse>("/module-assets/upload-url", {
      contentType,
      sizeBytes,
    }),
};
