import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { moduleItemApi } from "../api/moduleItemApi";

export interface StudentItemProgress {
  moduleItemId: string;
  studentUserId: string;
  courseId: string;
  moduleId: string;
  state: "locked" | "unlocked" | "in_progress" | "completed";
  unlockedAt?: string;
  startedAt?: string;
  completedAt?: string;
  manualCheckedAt?: string;
  bestSessionId?: string;
  bestSessionScore?: number;
  unlockedSubKeys?: string[];
}

interface ProgressState {
  byItemId: Record<string, StudentItemProgress>;
  loading: boolean;
}

const initialState: ProgressState = { byItemId: {}, loading: false };

export const fetchMyProgress = createAsyncThunk(
  "progress/fetchMy",
  async (itemId: string) => ({
    itemId,
    ...(await moduleItemApi.getProgress(itemId)),
  })
);

export const markComplete = createAsyncThunk(
  "progress/markComplete",
  async (itemId: string) =>
    ({ itemId, ...(await moduleItemApi.updateProgress(itemId, "completed")) })
);

export const markInProgress = createAsyncThunk(
  "progress/markInProgress",
  async (itemId: string) =>
    ({ itemId, ...(await moduleItemApi.updateProgress(itemId, "in_progress")) })
);

const slice = createSlice({
  name: "progress",
  initialState,
  reducers: {},
  extraReducers: (b) =>
    b
      .addCase(fetchMyProgress.fulfilled, (s, a: any) => {
        if (a.payload.progress) {
          s.byItemId[a.payload.itemId] = a.payload.progress;
        }
      })
      .addCase(markComplete.fulfilled, (s, a: any) => {
        if (a.payload.progress) {
          s.byItemId[a.payload.itemId] = a.payload.progress;
        }
      })
      .addCase(markInProgress.fulfilled, (s, a: any) => {
        if (a.payload.progress) {
          s.byItemId[a.payload.itemId] = a.payload.progress;
        }
      }),
});

export const selectMyProgress = (itemId: string) => (s: any) =>
  s.progress.byItemId[itemId] as StudentItemProgress | undefined;

export default slice.reducer;
