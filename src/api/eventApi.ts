import { apiGet, apiPost } from "./apiClient";

export interface EventLogEntry {
  eventType: string;
  occurredAt?: string;
  courseId?: string | null;
  moduleId?: string | null;
  moduleItemId?: string | null;
  payload?: Record<string, any>;
}

export const eventApi = {
  log: (event: EventLogEntry) => apiPost("/events", event),
  logBatch: (events: EventLogEntry[]) => apiPost("/events", { events }),
  query: (params: {
    courseId?: string;
    studentUserId?: string;
    eventType?: string;
    since?: string;
  }) => apiGet("/events", params as Record<string, string>),
};
