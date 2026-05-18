import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { moduleApi } from "../api/moduleApi";

export interface CourseModule {
  moduleId: string;
  courseId: string;
  title: string;
  description?: string;
  position: number;
  gating?: any;
  createdAt: string;
  updatedAt: string;
}

interface ModuleState {
  byCourseId: Record<string, CourseModule[]>;
  loading: boolean;
}

const initialState: ModuleState = { byCourseId: {}, loading: false };

export const fetchModules = createAsyncThunk(
  "modules/fetchByCourse",
  async (courseId: string) => ({ courseId, ...(await moduleApi.list(courseId)) })
);

export const createModule = createAsyncThunk(
  "modules/create",
  async ({ courseId, data }: { courseId: string; data: any }) =>
    await moduleApi.create(courseId, data)
);

export const updateModule = createAsyncThunk(
  "modules/update",
  async ({ moduleId, data }: { moduleId: string; data: any }) =>
    await moduleApi.update(moduleId, data)
);

export const deleteModule = createAsyncThunk(
  "modules/delete",
  async (moduleId: string) => {
    await moduleApi.delete(moduleId);
    return moduleId;
  }
);

export const reorderModules = createAsyncThunk(
  "modules/reorder",
  async ({ courseId, orderedIds }: { courseId: string; orderedIds: string[] }) => {
    await moduleApi.reorderModules(courseId, orderedIds);
    return { courseId, orderedIds };
  }
);

const moduleSlice = createSlice({
  name: "modules",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchModules.fulfilled, (state, action: any) => {
        state.byCourseId[action.payload.courseId] = action.payload.modules || [];
      })
      .addCase(createModule.fulfilled, (state, action) => {
        const list = state.byCourseId[action.payload.courseId] || [];
        list.push(action.payload);
        state.byCourseId[action.payload.courseId] = list.sort(
          (a, b) => (a.position ?? 0) - (b.position ?? 0)
        );
      })
      .addCase(updateModule.fulfilled, (state, action) => {
        const list = state.byCourseId[action.payload.courseId] || [];
        const idx = list.findIndex((m) => m.moduleId === action.payload.moduleId);
        if (idx >= 0) list[idx] = action.payload;
      })
      .addCase(deleteModule.fulfilled, (state, action) => {
        for (const cid of Object.keys(state.byCourseId)) {
          state.byCourseId[cid] = state.byCourseId[cid].filter(
            (m) => m.moduleId !== action.payload
          );
        }
      })
      .addCase(reorderModules.fulfilled, (state, action) => {
        const { courseId, orderedIds } = action.payload;
        const list = state.byCourseId[courseId] || [];
        const byId: Record<string, CourseModule> = {};
        for (const m of list) byId[m.moduleId] = m;
        state.byCourseId[courseId] = orderedIds
          .map((id, idx) => byId[id] && { ...byId[id], position: idx })
          .filter((x): x is CourseModule => Boolean(x));
      });
  },
});

export const selectModulesByCourse = (courseId: string) => (s: any) =>
  (s.modules.byCourseId[courseId] as CourseModule[]) || [];

export default moduleSlice.reducer;
