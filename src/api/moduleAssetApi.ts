import { apiPost } from "./apiClient";

// This endpoint lives on a separate RestApi (ModuleAssetAPI) — its own
// CloudFormation stack — because the legacy NurseTownAPI stack is at the
// 500-resource CFN limit. The frontend resolves "ModuleAssetAPI" to its
// endpoint via amplify_outputs.json (populated by backend.addOutput).
const MODULE_ASSET_API_NAME = "ModuleAssetAPI";

export interface UploadUrlResponse {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  expiresIn: number;
}

export type UploadPurpose = "module-asset" | "submission";

export const moduleAssetApi = {
  requestUploadUrl: (
    contentType: string,
    sizeBytes: number,
    purpose?: UploadPurpose
  ) =>
    apiPost<UploadUrlResponse>(
      "/module-assets/upload-url",
      {
        contentType,
        sizeBytes,
        ...(purpose ? { purpose } : {}),
      },
      {},
      MODULE_ASSET_API_NAME
    ),
};
