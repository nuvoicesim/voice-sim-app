import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { surveyTemplateApi } from "../api/surveyTemplateApi";

export type SurveyQuestion =
  | {
      id: string;
      type: "likert";
      prompt: string;
      required: boolean;
      config: { scale: number; leftAnchor: string; rightAnchor: string };
    }
  | {
      id: string;
      type: "choice_single" | "choice_multi";
      prompt: string;
      required: boolean;
      config: { options: { value: string; label: string }[]; minSelected?: number };
    }
  | {
      id: string;
      type: "free_text";
      prompt: string;
      required: boolean;
      config: { minWords?: number; maxWords?: number; placeholder?: string };
    };

export interface SurveyTemplate {
  surveyTemplateId: string;
  name: string;
  description?: string;
  questions: SurveyQuestion[];
  ownerFacultyId?: string;
  ownerRole?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SurveyTemplateState {
  templates: SurveyTemplate[];
  currentTemplate: SurveyTemplate | null;
  loading: boolean;
}

const initialState: SurveyTemplateState = {
  templates: [],
  currentTemplate: null,
  loading: false,
};

export const fetchTemplates = createAsyncThunk(
  "surveyTemplates/fetchAll",
  async () => await surveyTemplateApi.list()
);
export const fetchTemplate = createAsyncThunk(
  "surveyTemplates/fetchOne",
  async (id: string) => await surveyTemplateApi.get(id)
);
export const createTemplate = createAsyncThunk(
  "surveyTemplates/create",
  async (data: any) => await surveyTemplateApi.create(data)
);
export const updateTemplate = createAsyncThunk(
  "surveyTemplates/update",
  async ({ id, data }: { id: string; data: any }) =>
    await surveyTemplateApi.update(id, data)
);
export const deleteTemplate = createAsyncThunk(
  "surveyTemplates/delete",
  async (id: string) => {
    await surveyTemplateApi.delete(id);
    return id;
  }
);

const slice = createSlice({
  name: "surveyTemplates",
  initialState,
  reducers: {
    clearCurrentTemplate: (s) => {
      s.currentTemplate = null;
    },
  },
  extraReducers: (b) =>
    b
      .addCase(fetchTemplates.fulfilled, (s, a: any) => {
        s.templates = a.payload.templates || [];
      })
      .addCase(fetchTemplate.fulfilled, (s, a) => {
        s.currentTemplate = a.payload;
      })
      .addCase(createTemplate.fulfilled, (s, a) => {
        s.templates.push(a.payload);
        s.currentTemplate = a.payload;
      })
      .addCase(updateTemplate.fulfilled, (s, a) => {
        s.currentTemplate = a.payload;
        const idx = s.templates.findIndex(
          (t) => t.surveyTemplateId === a.payload.surveyTemplateId
        );
        if (idx >= 0) s.templates[idx] = a.payload;
      })
      .addCase(deleteTemplate.fulfilled, (s, a) => {
        s.templates = s.templates.filter((t) => t.surveyTemplateId !== a.payload);
      }),
});

export const { clearCurrentTemplate } = slice.actions;
export const selectTemplates = (s: any) => s.surveyTemplates.templates as SurveyTemplate[];
export const selectCurrentTemplate = (s: any) =>
  s.surveyTemplates.currentTemplate as SurveyTemplate | null;
export default slice.reducer;
