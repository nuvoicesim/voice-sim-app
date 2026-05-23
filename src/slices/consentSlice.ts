import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { consentApi, type ConsentDecisionRow } from "../api/consentApi";

interface ConsentState {
  byItemId: Record<string, ConsentDecisionRow | null>;
  loading: boolean;
}

const initialState: ConsentState = { byItemId: {}, loading: false };

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
      }),
});

export const selectMyConsentDecision = (itemId: string) => (s: any) =>
  s.consent.byItemId[itemId] as ConsentDecisionRow | null | undefined;

export default slice.reducer;
