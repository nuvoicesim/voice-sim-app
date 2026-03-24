import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export type UserRole = "student" | "faculty" | "admin";

interface AuthState {
  userId: string | null;
  email: string | null;
  role: UserRole;
  isAuthenticated: boolean;
}

const initialState: AuthState = {
  userId: null,
  email: null,
  role: "student",
  isAuthenticated: false,
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setAuth: (state, action: PayloadAction<{ userId: string; email?: string; role: UserRole }>) => {
      state.userId = action.payload.userId;
      state.email = action.payload.email || null;
      state.role = action.payload.role;
      state.isAuthenticated = true;
    },
    clearAuth: (state) => {
      state.userId = null;
      state.email = null;
      state.role = "student";
      state.isAuthenticated = false;
    },
    setRole: (state, action: PayloadAction<UserRole>) => {
      state.role = action.payload;
    },
  },
});

export const { setAuth, clearAuth, setRole } = authSlice.actions;

export const selectAuth = (state: { auth: AuthState }) => state.auth;
export const selectRole = (state: { auth: AuthState }) => state.auth.role;
export const selectUserId = (state: { auth: AuthState }) => state.auth.userId;
export const selectIsAuthenticated = (state: { auth: AuthState }) => state.auth.isAuthenticated;

export default authSlice.reducer;
