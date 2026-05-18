import { apiGet, apiPost } from "./apiClient";

export const migrationApi = {
  status: () => apiGet("/admin/migrate-to-courses"),
  run: () => apiPost("/admin/migrate-to-courses", {}),
};
