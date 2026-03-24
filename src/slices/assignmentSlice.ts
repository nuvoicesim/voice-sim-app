import { createSlice, createAsyncThunk, PayloadAction } from "@reduxjs/toolkit";
import { assignmentApi } from "../api/assignmentApi";

export interface Assignment {
  assignmentId: string;
  sceneId: string;
  title: string;
  description?: string;
  mode: "practice" | "assessment";
  attemptPolicy: { maxAttempts: number };
  surveyPolicy: {
    enabled: boolean;
    required: boolean;
    templateId: string | null;
    displayTiming: string;
  };
  dueDate: string | null;
  targetType: string;
  targetId: string | null;
  status: "draft" | "published" | "archived";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface AssignmentState {
  assignments: Assignment[];
  currentAssignment: Assignment | null;
  loading: boolean;
  error: string | null;
}

const initialState: AssignmentState = {
  assignments: [],
  currentAssignment: null,
  loading: false,
  error: null,
};

export const fetchAssignments = createAsyncThunk(
  "assignments/fetchAll",
  async (params?: { status?: string }) => {
    return await assignmentApi.list(params);
  }
);

export const fetchAssignment = createAsyncThunk(
  "assignments/fetchOne",
  async (assignmentId: string) => {
    return await assignmentApi.get(assignmentId);
  }
);

export const createAssignment = createAsyncThunk(
  "assignments/create",
  async (data: Partial<Assignment>) => {
    return await assignmentApi.create(data);
  }
);

const assignmentSlice = createSlice({
  name: "assignments",
  initialState,
  reducers: {
    clearCurrentAssignment: (state) => {
      state.currentAssignment = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAssignments.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchAssignments.fulfilled, (state, action) => {
        state.loading = false;
        state.assignments = action.payload.assignments;
      })
      .addCase(fetchAssignments.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || "Failed to fetch assignments";
      })
      .addCase(fetchAssignment.fulfilled, (state, action) => {
        state.currentAssignment = action.payload;
      })
      .addCase(createAssignment.fulfilled, (state, action) => {
        state.assignments.push(action.payload);
      });
  },
});

export const { clearCurrentAssignment } = assignmentSlice.actions;

export const selectAssignments = (state: { assignments: AssignmentState }) => state.assignments.assignments;
export const selectCurrentAssignment = (state: { assignments: AssignmentState }) => state.assignments.currentAssignment;
export const selectAssignmentsLoading = (state: { assignments: AssignmentState }) => state.assignments.loading;

export default assignmentSlice.reducer;
