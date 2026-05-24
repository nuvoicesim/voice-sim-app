import { useCallback, useState } from "react";
import { moduleAssetApi } from "../../../api/moduleAssetApi";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_BYTES = 5 * 1024 * 1024;

export interface SubmissionUploadResult {
  publicUrl: string;
  fileName: string;
}

export function useSubmissionImageUpload() {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (file: File): Promise<SubmissionUploadResult> => {
      setError(null);
      if (!ALLOWED_TYPES.includes(file.type)) {
        const msg = `Unsupported file type: ${file.type || "unknown"}`;
        setError(msg);
        throw new Error(msg);
      }
      if (file.size > MAX_BYTES) {
        const msg = `File too large: ${(file.size / 1024 / 1024).toFixed(2)} MB (max 5 MB)`;
        setError(msg);
        throw new Error(msg);
      }
      setUploading(true);
      try {
        const presign = await moduleAssetApi.requestUploadUrl(
          file.type,
          file.size,
          "submission"
        );
        const put = await fetch(presign.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!put.ok) {
          throw new Error(`Upload failed (status ${put.status})`);
        }
        return { publicUrl: presign.publicUrl, fileName: file.name };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Upload failed";
        setError(msg);
        throw new Error(msg);
      } finally {
        setUploading(false);
      }
    },
    []
  );

  return { upload, uploading, error, MAX_BYTES, ALLOWED_TYPES };
}
