import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { consentApi, type ConsentDecisionRow } from "../api/consentApi";

interface ConsentState {
  byItemId: Record<string, ConsentDecisionRow | null>;
  courseConsentsByCourse: Record<string, ConsentDecisionRow[]>;
  loading: boolean;
}

const initialState: ConsentState = {
  byItemId: {},
  courseConsentsByCourse: {},
  loading: false,
};

export const fetchMyConsent = createAsyncThunk(
  "consent/fetchMine",
  async (itemId: string) => ({
    itemId,
    ...(await consentApi.getMine(itemId)),
  })
);

export const submitConsent = createAsyncThunk(
  "consent/submit",
  async ({
    itemId,
    decision,
  }: {
    itemId: string;
    decision: "agreed" | "declined";
  }) => ({
    itemId,
    ...(await consentApi.submit(itemId, decision)),
  })
);

export const fetchCourseConsents = createAsyncThunk(
  "consent/fetchCourseConsents",
  async (courseId: string) => ({
    courseId,
    ...(await consentApi.listForCourse(courseId)),
  })
);

const slice = createSlice({
  name: "consent",
  initialState,
  reducers: {},
  extraReducers: (b) =>
    b
      .addCase(fetchMyConsent.fulfilled, (s, a: any) => {
        s.byItemId[a.payload.itemId] = a.payload.decision || null;
      })
      .addCase(submitConsent.fulfilled, (s, a: any) => {
        s.byItemId[a.payload.itemId] = a.payload.decision || null;
      })
      .addCase(fetchCourseConsents.fulfilled, (s, a: any) => {
        s.courseConsentsByCourse[a.payload.courseId] = a.payload.decisions || [];
      }),
});

export const selectMyConsentDecision = (itemId: string) => (s: any) =>
  s.consent.byItemId[itemId] as ConsentDecisionRow | null | undefined;

export const selectConsentDecisionsByStudent =
  (courseId: string, studentUserId: string) =>
  (s: any): ConsentDecisionRow[] => {
    const rows: ConsentDecisionRow[] =
      s.consent.courseConsentsByCourse[courseId] || [];
    return rows.filter((r) => r.studentUserId === studentUserId);
  };

export const selectLatestConsentByStudent =
  (courseId: string, studentUserId: string) =>
  (s: any): ConsentDecisionRow | null => {
    const rows = selectConsentDecisionsByStudent(courseId, studentUserId)(s);
    if (rows.length === 0) return null;
    return [...rows].sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1))[0];
  };

export default slice.reducer;
