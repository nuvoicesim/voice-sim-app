import { describe, expect, it } from "vitest";
import { projectStudentFeedback } from "./student-feedback";

describe("legacy student feedback REST projection", () => {
  it("denies Phase 3 rows instead of leaking internal display labels or hashes", () => {
    const projected = projectStudentFeedback(
      { payload: { feedbackCardsFromItemId: "p3-ac" } },
      [
        {
          displayLabel: "AI",
          contentHash: "secret",
          source: "ai",
          revealed: false,
        },
      ]
    );
    expect(projected).toEqual({ allowed: false, feedback: [] });
    expect(JSON.stringify(projected)).not.toContain("secret");
    expect(JSON.stringify(projected)).not.toContain("AI");
  });

  it("preserves the existing blind masking for ordinary Phase 1/2 feedback", () => {
    const projected = projectStudentFeedback({ payload: {} }, [
      {
        body: "Feedback",
        displayLabel: "Source A",
        source: "ai",
        reviewerUserId: "r1",
        revealed: false,
      },
    ]);
    expect(projected.allowed).toBe(true);
    expect(projected.feedback[0]).toMatchObject({
      body: "Feedback",
      displayLabel: "Source A",
    });
    expect(projected.feedback[0].source).toBeUndefined();
    expect(projected.feedback[0].reviewerUserId).toBeUndefined();
  });

  it("denies Phase 3 rows even when the queried item carries no payload marker", () => {
    // Rows are filed under `feedbackCardsFromItemId`'s scope item. If that scope
    // is ever pointed at a different item (e.g. the Maria assignment), the item
    // guard cannot see the marker — the row guard must still refuse.
    const projected = projectStudentFeedback({ payload: {} }, [
      {
        body: "Integrated narrative",
        displayLabel: "Faculty 1",
        contentHash: "a".repeat(64),
        dimensionScores: { d1: "3", d2: "N/A", d3: "4" },
        displayKey: "A",
        source: "reviewer",
        revealed: false,
      },
    ]);
    expect(projected.allowed).toBe(false);
    expect(projected.feedback).toEqual([]);
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain("Faculty 1");
    expect(serialized).not.toContain("Integrated narrative");
  });

  it("denies a revealed Phase 3 row (revealed rows are otherwise returned whole)", () => {
    const projected = projectStudentFeedback({ payload: {} }, [
      { displayKey: "B", displayLabel: "AI", source: "ai", revealed: true },
    ]);
    expect(projected.allowed).toBe(false);
    expect(JSON.stringify(projected)).not.toContain("AI");
  });

  it("denies the whole batch when only one row looks like Phase 3", () => {
    const projected = projectStudentFeedback({ payload: {} }, [
      { body: "Legacy", displayLabel: "Reviewer", source: "reviewer", revealed: false },
      { body: "Phase 3", displayKey: "C", source: "ai", revealed: false },
    ]);
    expect(projected.allowed).toBe(false);
    expect(projected.feedback).toEqual([]);
  });

  it("still allows ordinary rows that merely have an undefined marker key", () => {
    const projected = projectStudentFeedback({ payload: {} }, [
      { body: "Legacy", source: "ai", reviewerUserId: null, revealed: false },
    ]);
    expect(projected.allowed).toBe(true);
    expect(projected.feedback).toHaveLength(1);
  });
});
