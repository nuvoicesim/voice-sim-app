import { apiGet } from "./apiClient";

// The faculty Review Package export lives on a separate RestApi (ExportAPI) —
// its own CloudFormation stack — because the legacy NurseTownAPI stack is at
// the 500-resource CFN limit. The frontend resolves "ExportAPI" to its endpoint
// via amplify_outputs.json (populated by backend.addOutput → custom.API).
const EXPORT_API_NAME = "ExportAPI";

export interface ReviewPackageResponse {
  filename: string;
  html: string;
}

export const reviewPackageApi = {
  /**
   * Faculty-only, course-scoped HTML review package for ONE student.
   * Optionally restrict to a single LMS module via opts.moduleId.
   */
  getForStudent: (
    courseId: string,
    studentUserId: string,
    opts?: { moduleId?: string }
  ) =>
    apiGet<ReviewPackageResponse>(
      `/courses/${courseId}/students/${studentUserId}/review-package`,
      { format: "html", ...(opts?.moduleId ? { moduleId: opts.moduleId } : {}) },
      EXPORT_API_NAME
    ),
};
