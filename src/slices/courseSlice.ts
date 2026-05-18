import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { courseApi } from "../api/courseApi";

export interface Course {
  courseId: string;
  ownerFacultyId: string;
  title: string;
  description?: string;
  status: "draft" | "published" | "archived";
  groupConfig?: any;
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CourseInstructor {
  courseId: string;
  facultyUserId: string;
  role: "owner" | "co_teacher" | "coordinator";
  addedAt: string;
  addedBy: string;
}

export interface CourseEnrollment {
  courseId: string;
  studentUserId: string;
  studentEmail?: string;
  enrolledAt: string;
  status: "active" | "removed";
}

interface CourseState {
  courses: Course[];
  currentCourse: Course | null;
  currentInstructors: CourseInstructor[];
  currentEnrollments: CourseEnrollment[];
  loading: boolean;
  error: string | null;
}

const initialState: CourseState = {
  courses: [],
  currentCourse: null,
  currentInstructors: [],
  currentEnrollments: [],
  loading: false,
  error: null,
};

export const fetchCourses = createAsyncThunk("courses/fetchAll", async () => {
  return await courseApi.list();
});

export const fetchCourse = createAsyncThunk(
  "courses/fetchOne",
  async (courseId: string) => await courseApi.get(courseId)
);

export const createCourse = createAsyncThunk(
  "courses/create",
  async (data: { title: string; description?: string; isDefault?: boolean }) =>
    await courseApi.create(data)
);

export const updateCourse = createAsyncThunk(
  "courses/update",
  async ({ courseId, data }: { courseId: string; data: any }) =>
    await courseApi.update(courseId, data)
);

export const updateCourseStatus = createAsyncThunk(
  "courses/updateStatus",
  async ({ courseId, status }: { courseId: string; status: string }) =>
    await courseApi.updateStatus(courseId, status)
);

export const archiveCourse = createAsyncThunk(
  "courses/archive",
  async (courseId: string) => await courseApi.archive(courseId)
);

export const fetchInstructors = createAsyncThunk(
  "courses/fetchInstructors",
  async (courseId: string) => await courseApi.listInstructors(courseId)
);

export const addInstructor = createAsyncThunk(
  "courses/addInstructor",
  async ({ courseId, email }: { courseId: string; email: string }) =>
    await courseApi.addInstructor(courseId, email)
);

export const removeInstructor = createAsyncThunk(
  "courses/removeInstructor",
  async ({ courseId, facultyUserId }: { courseId: string; facultyUserId: string }) => {
    await courseApi.removeInstructor(courseId, facultyUserId);
    return facultyUserId;
  }
);

export const updateInstructorRole = createAsyncThunk(
  "courses/updateInstructorRole",
  async ({
    courseId,
    facultyUserId,
    role,
  }: {
    courseId: string;
    facultyUserId: string;
    role: string;
  }) => {
    const res: any = await courseApi.updateInstructorRole(courseId, facultyUserId, role);
    return res?.instructor;
  }
);

export const fetchEnrollments = createAsyncThunk(
  "courses/fetchEnrollments",
  async (courseId: string) => await courseApi.listEnrollments(courseId)
);

export const enrollStudents = createAsyncThunk(
  "courses/enrollStudents",
  async ({ courseId, emails }: { courseId: string; emails: string[] }) =>
    await courseApi.enrollStudents(courseId, emails)
);

export const unenrollStudent = createAsyncThunk(
  "courses/unenroll",
  async ({ courseId, studentUserId }: { courseId: string; studentUserId: string }) => {
    await courseApi.unenroll(courseId, studentUserId);
    return studentUserId;
  }
);

const courseSlice = createSlice({
  name: "courses",
  initialState,
  reducers: {
    clearCurrentCourse: (state) => {
      state.currentCourse = null;
      state.currentInstructors = [];
      state.currentEnrollments = [];
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchCourses.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchCourses.fulfilled, (state, action) => {
        state.loading = false;
        state.courses = action.payload.courses || [];
      })
      .addCase(fetchCourses.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || "Failed";
      })
      .addCase(fetchCourse.fulfilled, (state, action) => {
        state.currentCourse = action.payload;
      })
      .addCase(createCourse.fulfilled, (state, action) => {
        state.courses.push(action.payload);
      })
      .addCase(updateCourse.fulfilled, (state, action) => {
        state.currentCourse = action.payload;
        const idx = state.courses.findIndex((c) => c.courseId === action.payload.courseId);
        if (idx >= 0) state.courses[idx] = action.payload;
      })
      .addCase(updateCourseStatus.fulfilled, (state, action) => {
        state.currentCourse = action.payload;
        const idx = state.courses.findIndex((c) => c.courseId === action.payload.courseId);
        if (idx >= 0) state.courses[idx] = action.payload;
      })
      .addCase(fetchInstructors.fulfilled, (state, action) => {
        state.currentInstructors = action.payload.instructors || [];
      })
      .addCase(addInstructor.fulfilled, (state, action) => {
        state.currentInstructors.push(action.payload);
      })
      .addCase(removeInstructor.fulfilled, (state, action) => {
        state.currentInstructors = state.currentInstructors.filter(
          (i) => i.facultyUserId !== action.payload
        );
      })
      .addCase(updateInstructorRole.fulfilled, (state, action) => {
        if (!action.payload) return;
        const idx = state.currentInstructors.findIndex(
          (i) => i.facultyUserId === action.payload.facultyUserId
        );
        if (idx >= 0) state.currentInstructors[idx] = action.payload;
      })
      .addCase(fetchEnrollments.fulfilled, (state, action) => {
        state.currentEnrollments = action.payload.enrollments || [];
      })
      .addCase(enrollStudents.fulfilled, (state, action) => {
        const enrolled = (action.payload.results || [])
          .filter((r: any) => r.status === "enrolled")
          .map((r: any) => r.enrollment);
        state.currentEnrollments.push(...enrolled);
      })
      .addCase(unenrollStudent.fulfilled, (state, action) => {
        state.currentEnrollments = state.currentEnrollments.map((e) =>
          e.studentUserId === action.payload ? { ...e, status: "removed" } : e
        );
      });
  },
});

export const { clearCurrentCourse } = courseSlice.actions;

export const selectCourses = (s: any) => s.courses.courses as Course[];
export const selectCurrentCourse = (s: any) => s.courses.currentCourse as Course | null;
export const selectCurrentInstructors = (s: any) =>
  s.courses.currentInstructors as CourseInstructor[];
export const selectCurrentEnrollments = (s: any) =>
  s.courses.currentEnrollments as CourseEnrollment[];
export const selectCoursesLoading = (s: any) => s.courses.loading as boolean;

export default courseSlice.reducer;
