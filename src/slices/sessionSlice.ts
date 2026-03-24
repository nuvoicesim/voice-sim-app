import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { sessionApi } from "../api/sessionApi";

export interface Session {
  sessionId: string;
  assignmentId: string;
  studentUserId: string;
  attemptNo: number;
  mode: string;
  status: "active" | "completed" | "abandoned";
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
}

export interface SessionTurn {
  sessionId: string;
  turnIndex: number;
  userText: string;
  modelText: string;
  emotionCode: number;
  motionCode: number;
  latencyMs: number;
  timestamp: string;
}

export interface SessionEvaluation {
  sessionId: string;
  totalScore: number;
  performanceLevel: string;
  rubric: any[];
  responseTimeAvgSec: number;
  overallExplanation: string;
  createdAt: string;
}

interface SessionState {
  sessions: Session[];
  currentSession: Session | null;
  currentTurns: SessionTurn[];
  currentEvaluation: SessionEvaluation | null;
  loading: boolean;
  error: string | null;
}

const initialState: SessionState = {
  sessions: [],
  currentSession: null,
  currentTurns: [],
  currentEvaluation: null,
  loading: false,
  error: null,
};

export const startSession = createAsyncThunk(
  "sessions/start",
  async (assignmentId: string) => {
    return await sessionApi.start(assignmentId);
  }
);

export const fetchSession = createAsyncThunk(
  "sessions/fetchOne",
  async (sessionId: string) => {
    return await sessionApi.get(sessionId);
  }
);

export const completeSession = createAsyncThunk(
  "sessions/complete",
  async (sessionId: string) => {
    return await sessionApi.complete(sessionId);
  }
);

export const fetchSessionsByAssignment = createAsyncThunk(
  "sessions/fetchByAssignment",
  async (assignmentId: string) => {
    return await sessionApi.listByAssignment(assignmentId);
  }
);

const sessionSlice = createSlice({
  name: "sessions",
  initialState,
  reducers: {
    clearCurrentSession: (state) => {
      state.currentSession = null;
      state.currentTurns = [];
      state.currentEvaluation = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(startSession.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(startSession.fulfilled, (state, action) => {
        state.loading = false;
        state.currentSession = action.payload.session;
      })
      .addCase(startSession.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || "Failed to start session";
      })
      .addCase(fetchSession.fulfilled, (state, action) => {
        state.currentSession = action.payload.session;
        state.currentTurns = action.payload.turns || [];
        state.currentEvaluation = action.payload.evaluation || null;
      })
      .addCase(completeSession.fulfilled, (state, action) => {
        state.currentSession = action.payload.session;
      })
      .addCase(fetchSessionsByAssignment.fulfilled, (state, action) => {
        state.sessions = action.payload.sessions;
      });
  },
});

export const { clearCurrentSession } = sessionSlice.actions;

export const selectSessions = (state: { sessions: SessionState }) => state.sessions.sessions;
export const selectCurrentSession = (state: { sessions: SessionState }) => state.sessions.currentSession;
export const selectCurrentTurns = (state: { sessions: SessionState }) => state.sessions.currentTurns;
export const selectCurrentEvaluation = (state: { sessions: SessionState }) => state.sessions.currentEvaluation;
export const selectSessionsLoading = (state: { sessions: SessionState }) => state.sessions.loading;

export default sessionSlice.reducer;
