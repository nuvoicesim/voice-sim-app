import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { eventApi, type EventLogEntry } from "../api/eventApi";

const STORAGE_KEY = "voiceSim:eventLogPending";

interface PendingEvent extends EventLogEntry {
  pendingId: string;
  enqueuedAt: string;
}

interface EventLogState {
  pending: PendingEvent[];
  batchBuffer: PendingEvent[];
  flushing: boolean;
}

function loadPersisted(): PendingEvent[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePersisted(pending: PendingEvent[]) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
  } catch {
    /* ignore quota issues */
  }
}

const initialState: EventLogState = {
  pending: loadPersisted(),
  batchBuffer: [],
  flushing: false,
};

const CRITICAL = new Set([
  "course_started",
  "module_item_opened",
  "survey_started",
  "survey_submitted",
  "voice_simulation_launched",
  "voice_simulation_completed",
  "simucase_completion_confirmed",
  "module_item_unlocked",
  "ai_detection_subquestion_submitted",
  "ai_detection_finalized",
  "feedback_submitted_by_teacher",
]);

export function isCriticalEvent(type: string) {
  return CRITICAL.has(type);
}

export const logEventThunk = createAsyncThunk(
  "events/log",
  async (event: EventLogEntry) => {
    await eventApi.log(event);
    return event;
  }
);

export const flushBatch = createAsyncThunk(
  "events/flushBatch",
  async (_: void, { getState }) => {
    const state = getState() as { events: EventLogState };
    const buf = [...state.events.batchBuffer];
    if (buf.length === 0) return { flushed: 0 };
    await eventApi.logBatch(buf);
    return { flushed: buf.length };
  }
);

export const flushPending = createAsyncThunk(
  "events/flushPending",
  async (_: void, { getState }) => {
    const state = getState() as { events: EventLogState };
    const pending = [...state.events.pending];
    if (pending.length === 0) return { flushed: 0 };
    await eventApi.logBatch(pending);
    return { flushed: pending.length };
  }
);

const slice = createSlice({
  name: "events",
  initialState,
  reducers: {
    enqueueForBatch: (s, a: { payload: EventLogEntry }) => {
      s.batchBuffer.push({
        ...a.payload,
        pendingId: `${Date.now()}-${Math.random()}`,
        enqueuedAt: new Date().toISOString(),
      });
    },
  },
  extraReducers: (b) =>
    b
      .addCase(logEventThunk.rejected, (s, a) => {
        // Append to pending for later retry.
        if (a.meta.arg) {
          s.pending.push({
            ...a.meta.arg,
            pendingId: `${Date.now()}-${Math.random()}`,
            enqueuedAt: new Date().toISOString(),
          });
          savePersisted(s.pending);
        }
      })
      .addCase(flushBatch.fulfilled, (s) => {
        s.batchBuffer = [];
      })
      .addCase(flushBatch.rejected, (s) => {
        // Move buffer into pending.
        s.pending.push(...s.batchBuffer);
        s.batchBuffer = [];
        savePersisted(s.pending);
      })
      .addCase(flushPending.pending, (s) => {
        s.flushing = true;
      })
      .addCase(flushPending.fulfilled, (s) => {
        s.pending = [];
        s.flushing = false;
        savePersisted(s.pending);
      })
      .addCase(flushPending.rejected, (s) => {
        s.flushing = false;
      }),
});

export const { enqueueForBatch } = slice.actions;
export const selectPendingCount = (s: any) =>
  ((s.events as EventLogState).pending || []).length;
export default slice.reducer;
