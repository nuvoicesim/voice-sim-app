import { describe, it, expect } from "vitest";
import { selectCourseGroupForStudent } from "./groupAssignmentSlice";

const state = {
  groupAssignment: {
    byCourseId: {},
    courseGroupsByCourse: {
      "course-1": [
        {
          courseId: "course-1",
          studentUserId: "stu-A",
          scopeKey: "course-1",
          groupKey: "A",
          assignedAt: "2026-01-10T00:00:00Z",
        },
        {
          courseId: "course-1",
          studentUserId: "stu-A",
          scopeKey: "module-7",
          groupKey: "X",
          assignedAt: "2026-01-12T00:00:00Z",
        },
        {
          courseId: "course-1",
          studentUserId: "stu-B",
          scopeKey: "course-1",
          groupKey: "B",
          assignedAt: "2026-01-11T00:00:00Z",
        },
      ],
    },
    loading: false,
  },
};

describe("selectCourseGroupForStudent", () => {
  it("returns the course-scope assignment for the student", () => {
    const r = selectCourseGroupForStudent("course-1", "stu-A")(state);
    expect(r?.groupKey).toBe("A");
    expect(r?.scopeKey).toBe("course-1");
  });

  it("ignores non-course-scope assignments", () => {
    const r = selectCourseGroupForStudent("course-1", "stu-A")(state);
    expect(r?.scopeKey).not.toBe("module-7");
  });

  it("returns null when student has no course-scope row", () => {
    expect(selectCourseGroupForStudent("course-1", "stu-X")(state)).toBeNull();
  });

  it("returns null when course is not cached", () => {
    expect(selectCourseGroupForStudent("course-x", "stu-A")(state)).toBeNull();
  });
});
