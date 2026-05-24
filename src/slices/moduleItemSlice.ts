import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { moduleItemApi } from "../api/moduleItemApi";
import { moduleApi } from "../api/moduleApi";

export type ModuleItemType =
  | "assignment"
  | "survey"
  | "external_link"
  | "debrief"
  | "instruction"
  | "randomizer"
  | "reveal_trigger"
  | "ai_detection"
  | "consent";

export interface ModuleItem {
  moduleItemId: string;
  moduleId: string;
  courseId: string;
  itemType: ModuleItemType;
  title: string;
  position: number;
  gating?: any;
  payload: any;
  completionRule?: any;
  createdAt: string;
  updatedAt: string;
}

interface ModuleItemState {
  byModuleId: Record<string, ModuleItem[]>;
  currentItem: ModuleItem | null;
  loading: boolean;
}

const initialState: ModuleItemState = {
  byModuleId: {},
  currentItem: null,
  loading: false,
};

export const fetchItems = createAsyncThunk(
  "moduleItems/fetchByModule",
  async (moduleId: string) => ({
    moduleId,
    ...(await moduleItemApi.list(moduleId)),
  })
);

export const fetchItem = createAsyncThunk(
  "moduleItems/fetchOne",
  async (itemId: string) => await moduleItemApi.get(itemId)
);

export const createItem = createAsyncThunk(
  "moduleItems/create",
  async ({ moduleId, data }: { moduleId: string; data: any }) =>
    await moduleItemApi.create(moduleId, data)
);

export const updateItem = createAsyncThunk(
  "moduleItems/update",
  async ({ itemId, data }: { itemId: string; data: any }) =>
    await moduleItemApi.update(itemId, data)
);

export const deleteItem = createAsyncThunk(
  "moduleItems/delete",
  async (itemId: string) => {
    await moduleItemApi.delete(itemId);
    return itemId;
  }
);

export const reorderItems = createAsyncThunk(
  "moduleItems/reorder",
  async ({ moduleId, orderedIds }: { moduleId: string; orderedIds: string[] }) => {
    await moduleApi.reorderItems(moduleId, orderedIds);
    return { moduleId, orderedIds };
  }
);

const moduleItemSlice = createSlice({
  name: "moduleItems",
  initialState,
  reducers: {
    clearCurrentItem: (s) => {
      s.currentItem = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchItems.fulfilled, (state, action: any) => {
        state.byModuleId[action.payload.moduleId] = (action.payload.items || []).sort(
          (a: ModuleItem, b: ModuleItem) => (a.position ?? 0) - (b.position ?? 0)
        );
      })
      .addCase(fetchItem.fulfilled, (state, action) => {
        state.currentItem = action.payload;
      })
      .addCase(createItem.fulfilled, (state, action) => {
        const list = state.byModuleId[action.payload.moduleId] || [];
        list.push(action.payload);
        state.byModuleId[action.payload.moduleId] = list.sort(
          (a, b) => (a.position ?? 0) - (b.position ?? 0)
        );
      })
      .addCase(updateItem.fulfilled, (state, action) => {
        state.currentItem = action.payload;
        const list = state.byModuleId[action.payload.moduleId] || [];
        const idx = list.findIndex((i) => i.moduleItemId === action.payload.moduleItemId);
        if (idx >= 0) list[idx] = action.payload;
      })
      .addCase(deleteItem.fulfilled, (state, action) => {
        for (const mid of Object.keys(state.byModuleId)) {
          state.byModuleId[mid] = state.byModuleId[mid].filter(
            (i) => i.moduleItemId !== action.payload
          );
        }
      })
      .addCase(reorderItems.fulfilled, (state, action) => {
        const { moduleId, orderedIds } = action.payload;
        const list = state.byModuleId[moduleId] || [];
        const byId: Record<string, ModuleItem> = {};
        for (const it of list) byId[it.moduleItemId] = it;
        state.byModuleId[moduleId] = orderedIds
          .map((id, idx) => byId[id] && { ...byId[id], position: idx })
          .filter((x): x is ModuleItem => Boolean(x));
      });
  },
});

export const { clearCurrentItem } = moduleItemSlice.actions;

export const selectItemsByModule = (moduleId: string) => (s: any) =>
  (s.moduleItems.byModuleId[moduleId] as ModuleItem[]) || [];
export const selectAllItemsByModuleId = (s: any) =>
  s.moduleItems.byModuleId as Record<string, ModuleItem[]>;
export const selectCurrentItem = (s: any) =>
  s.moduleItems.currentItem as ModuleItem | null;

export default moduleItemSlice.reducer;
