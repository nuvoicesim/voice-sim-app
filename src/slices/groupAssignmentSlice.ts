import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import {
  groupAssignmentApi,
  type GroupAssignmentRow,
  type CourseGroupAssignmentRow,
} from "../api/groupAssignmentApi";

interface GroupAssignmentState {
  byCourseId: Record<string, GroupAssignmentRow[]>;
  courseGroupsByCourse: Record<string, CourseGroupAssignmentRow[]>;
  loading: boolean;
}

const initialState: GroupAssignmentState = {
  byCourseId: {},
  courseGroupsByCourse: {},
  loading: false,
};

export const fetchMyGroups = createAsyncThunk(
  "groupAssignment/fetchMy",
  async (courseId: string) => ({
    courseId,
    ...(await groupAssignmentApi.getMine(courseId)),
  })
);

export const fetchCourseGroups = createAsyncThunk(
  "groupAssignment/fetchCourse",
  async (courseId: string) => ({
    courseId,
    ...(await groupAssignmentApi.listForCourse(courseId)),
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
      })
      .addCase(fetchCourseGroups.fulfilled, (s, a: any) => {
        s.courseGroupsByCourse[a.payload.courseId] = a.payload.assignments || [];
      }),
});

export const selectMyGroupsForCourse = (courseId: string) => (s: any) =>
  (s.groupAssignment.byCourseId[courseId] as GroupAssignmentRow[]) || [];

export const selectMyGroupKeysForCourse = (courseId: string) => (s: any) => {
  const rows = (s.groupAssignment.byCourseId[courseId] as GroupAssignmentRow[]) || [];
  return rows.map((r) => r.groupKey);
};

export const selectCourseGroupForStudent =
  (courseId: string, studentUserId: string) =>
  (s: any): CourseGroupAssignmentRow | null => {
    const rows: CourseGroupAssignmentRow[] =
      s.groupAssignment.courseGroupsByCourse[courseId] || [];
    return (
      rows.find(
        (r) => r.studentUserId === studentUserId && r.scopeKey === courseId
      ) || null
    );
  };

export default slice.reducer;
