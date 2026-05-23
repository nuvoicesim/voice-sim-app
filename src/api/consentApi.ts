import { apiGet, apiPost } from "./apiClient";

export interface ConsentDecisionRow {
  consentItemId: string;
  studentUserId: string;
  courseId: string;
  decision: "agreed" | "declined";
  consentVersion?: string | null;
  bodySnapshot?: string | null;
  decidedAt: string;
  updatedAt: string;
}

export const consentApi = {
  getMine: (itemId: string) =>
    apiGet<{ decision: ConsentDecisionRow | null }>(
      `/module-items/${itemId}/consent-decision`
    ),
  submit: (itemId: string, decision: "agreed" | "declined") =>
    apiPost<{ decision: ConsentDecisionRow }>(
      `/module-items/${itemId}/consent-decision`,
      { decision }
    ),
  listForCourse: (courseId: string) =>
    apiGet<{
      decisions: ConsentDecisionRow[];
      counts: { agreed: number; declined: number; total: number };
    }>(`/courses/${courseId}/consent-decisions`),
};
