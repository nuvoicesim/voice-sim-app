import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { groupAssignmentApi, type GroupAssignmentRow } from "../api/groupAssignmentApi";

interface GroupAssignmentState {
  byCourseId: Record<string, GroupAssignmentRow[]>;
  loading: boolean;
}

const initialState: GroupAssignmentState = { byCourseId: {}, loading: false };

export const fetchMyGroups = createAsyncThunk(
  "groupAssignment/fetchMy",
  async (courseId: string) => ({
    courseId,
    ...(await groupAssignmentApi.getMine(courseId)),
  })
);

const slice = createSlice({
  name: "groupAssignment",
  initialState,
  reducers: {},
  extraReducers: (b) =>
    b
      .addCase(fetchMyGroups.pending, (s) => {
        s.loading = true;
      })
      .addCase(fetchMyGroups.fulfilled, (s, a: any) => {
        s.loading = false;
        s.byCourseId[a.payload.courseId] = a.payload.groups || [];
      })
      .addCase(fetchMyGroups.rejected, (s) => {
        s.loading = false;
      }),
});

export const selectMyGroupsForCourse = (courseId: string) => (s: any) =>
  (s.groupAssignment.byCourseId[courseId] as GroupAssignmentRow[]) || [];

export const selectMyGroupKeysForCourse = (courseId: string) => (s: any) => {
  const rows = (s.groupAssignment.byCourseId[courseId] as GroupAssignmentRow[]) || [];
  return rows.map((r) => r.groupKey);
};

export default slice.reducer;
