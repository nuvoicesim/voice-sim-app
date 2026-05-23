import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { surveyInstanceApi } from "../api/surveyInstanceApi";

export interface SurveyInstance {
  moduleItemId: string;
  studentUserId: string;
  surveyInstanceId: string;
  surveyTemplateId: string;
  courseId: string;
  schemaSnapshot: any;
  answers: Record<string, any>;
  status: "in_progress" | "submitted";
  startedAt: string;
  submittedAt: string | null;
  updatedAt: string;
}

interface SurveyInstanceState {
  byItemId: Record<string, SurveyInstance>;
  loading: boolean;
}

const initialState: SurveyInstanceState = { byItemId: {}, loading: false };

export const fetchInstance = createAsyncThunk(
  "surveyInstance/fetch",
  async (itemId: string) => await surveyInstanceApi.getMine(itemId)
);
export const saveAnswers = createAsyncThunk(
  "surveyInstance/save",
  async ({ itemId, answers }: { itemId: string; answers: Record<string, any> }) =>
    await surveyInstanceApi.saveAnswers(itemId, answers)
);
export const submitInstance = createAsyncThunk(
  "surveyInstance/submit",
  async (itemId: string) => await surveyInstanceApi.submit(itemId)
);

const slice = createSlice({
  name: "surveyInstances",
  initialState,
  reducers: {},
  extraReducers: (b) =>
    b
      .addCase(fetchInstance.fulfilled, (s, a: any) => {
        if (a.payload.instance) {
          s.byItemId[a.payload.instance.moduleItemId] = a.payload.instance;
        }
      })
      .addCase(saveAnswers.fulfilled, (s, a: any) => {
        if (a.payload.instance) {
          s.byItemId[a.payload.instance.moduleItemId] = a.payload.instance;
        }
      })
      .addCase(submitInstance.fulfilled, (s, a: any) => {
        if (a.payload.instance) {
          s.byItemId[a.payload.instance.moduleItemId] = a.payload.instance;
        }
      }),
});

export const selectInstance = (itemId: string) => (s: any) =>
  s.surveyInstances.byItemId[itemId] as SurveyInstance | undefined;

export default slice.reducer;
