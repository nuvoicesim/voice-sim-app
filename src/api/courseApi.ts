import { apiGet, apiPost, apiPut, apiDelete } from "./apiClient";

export const courseApi = {
  list: () => apiGet("/courses"),
  get: (courseId: string) => apiGet(`/courses/${courseId}`),
  create: (data: { title: string; description?: string; isDefault?: boolean }) =>
    apiPost("/courses", data),
  update: (courseId: string, data: any) => apiPut(`/courses/${courseId}`, data),
  updateStatus: (courseId: string, status: string) =>
    apiPut(`/courses/${courseId}/status`, { status }),
  archive: (courseId: string) => apiDelete(`/courses/${courseId}`),
  listInstructors: (courseId: string) => apiGet(`/courses/${courseId}/instructors`),
  addInstructor: (courseId: string, facultyEmail: string) =>
    apiPost(`/courses/${courseId}/instructors`, { facultyEmail }),
  removeInstructor: (courseId: string, facultyUserId: string) =>
    apiDelete(`/courses/${courseId}/instructors/${facultyUserId}`),
  updateInstructorRole: (courseId: string, facultyUserId: string, role: string) =>
    apiPut(`/courses/${courseId}/instructors/${facultyUserId}/role`, { role }),
  listEnrollments: (courseId: string) => apiGet(`/courses/${courseId}/enrollments`),
  enrollStudents: (courseId: string, emails: string[]) =>
    apiPost(`/courses/${courseId}/enrollments`, { emails }),
  unenroll: (courseId: string, studentUserId: string) =>
    apiDelete(`/courses/${courseId}/enrollments/${studentUserId}`),
};
