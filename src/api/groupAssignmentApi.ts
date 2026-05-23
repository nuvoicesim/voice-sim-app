import { apiGet } from "./apiClient";

export interface GroupAssignmentRow {
  scopeKey: string;
  groupKey: string;
  assignedByItemId?: string;
  assignedAt?: string;
}

export const groupAssignmentApi = {
  getMine: (courseId: string) =>
    apiGet<{ groups: GroupAssignmentRow[] }>(`/courses/${courseId}/my-groups`),
};
