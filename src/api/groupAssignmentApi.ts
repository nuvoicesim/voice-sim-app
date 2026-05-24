import { apiGet } from "./apiClient";

export interface GroupAssignmentRow {
  scopeKey: string;
  groupKey: string;
  assignedByItemId?: string;
  assignedAt?: string;
}

export interface CourseGroupAssignmentRow extends GroupAssignmentRow {
  courseId: string;
  studentUserId: string;
}

export const groupAssignmentApi = {
  getMine: (courseId: string) =>
    apiGet<{ groups: GroupAssignmentRow[] }>(`/courses/${courseId}/my-groups`),
  listForCourse: (courseId: string) =>
    apiGet<{ assignments: CourseGroupAssignmentRow[] }>(
      `/courses/${courseId}/group-assignments`
    ),
};
