import { describe, it, expect } from "vitest";
import {
  selectConsentDecisionsByStudent,
  selectLatestConsentByStudent,
} from "./consentSlice";

const state = {
  consent: {
    byItemId: {},
    loading: false,
    courseConsentsByCourse: {
      "course-1": [
        {
          consentItemId: "ci-1",
          studentUserId: "stu-A",
          courseId: "course-1",
          decision: "agreed",
          decidedAt: "2026-01-10T00:00:00Z",
          updatedAt: "2026-01-10T00:00:00Z",
        },
        {
          consentItemId: "ci-2",
          studentUserId: "stu-A",
          courseId: "course-1",
          decision: "declined",
          decidedAt: "2026-02-10T00:00:00Z",
          updatedAt: "2026-02-10T00:00:00Z",
        },
        {
          consentItemId: "ci-1",
          studentUserId: "stu-B",
          courseId: "course-1",
          decision: "agreed",
          decidedAt: "2026-01-11T00:00:00Z",
          updatedAt: "2026-01-11T00:00:00Z",
        },
      ],
    },
  },
};

describe("selectConsentDecisionsByStudent", () => {
  it("returns only decisions for the given student", () => {
    const result = selectConsentDecisionsByStudent("course-1", "stu-A")(state);
    expect(result).toHaveLength(2);
    expect(result.every((d) => d.studentUserId === "stu-A")).toBe(true);
  });

  it("returns empty array when course is not cached", () => {
    expect(selectConsentDecisionsByStudent("course-x", "stu-A")(state)).toEqual([]);
  });
});

describe("selectLatestConsentByStudent", () => {
  it("returns the decision with the latest decidedAt", () => {
    const latest = selectLatestConsentByStudent("course-1", "stu-A")(state);
    expect(latest?.consentItemId).toBe("ci-2");
  });

  it("returns null when student has no decisions", () => {
    expect(selectLatestConsentByStudent("course-1", "stu-X")(state)).toBeNull();
  });
});
