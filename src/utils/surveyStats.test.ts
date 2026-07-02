import { describe, it, expect } from "vitest";
import { aggregateSurvey, type SurveyInstanceLike } from "./surveyStats";
import { OTHER_VALUE, type SurveyQuestionDef } from "./surveyAnswerFormat";

const questions: SurveyQuestionDef[] = [
  {
    id: "q1",
    type: "choice_single",
    prompt: "Background?",
    config: {
      options: [
        { value: "opt1", label: "Undergraduate" },
        { value: "opt2", label: "Graduate" },
      ],
      allowOther: true,
      otherLabel: "Other (specify)",
    },
  },
  {
    id: "q2",
    type: "choice_multi",
    prompt: "Skills gained?",
    config: {
      options: [
        { value: "opt1", label: "Communication" },
        { value: "opt2", label: "Teamwork" },
      ],
    },
  },
  {
    id: "q3",
    type: "likert",
    prompt: "Confidence?",
    config: { scale: 5, leftAnchor: "Low", rightAnchor: "High" },
  },
  { id: "q4", type: "free_text", prompt: "Comments?", config: {} },
];

function inst(
  studentUserId: string,
  status: string,
  answers: Record<string, unknown>
): SurveyInstanceLike {
  return { studentUserId, status, answers };
}

describe("aggregateSurvey", () => {
  it("aggregates only submitted instances and counts in-progress separately", () => {
    const agg = aggregateSurvey(questions, [
      inst("s1", "submitted", { q1: "opt1" }),
      inst("s2", "in_progress", { q1: "opt2" }),
    ]);
    expect(agg.submitted).toBe(1);
    expect(agg.inProgress).toBe(1);
    const q1 = agg.questions[0];
    expect(q1.respondents).toBe(1);
    expect(q1.options?.find((o) => o.value === "opt2")?.count).toBe(0);
  });

  it("computes choice_single counts, percentages, and skips", () => {
    const agg = aggregateSurvey(questions, [
      inst("s1", "submitted", { q1: "opt1" }),
      inst("s2", "submitted", { q1: "opt1" }),
      inst("s3", "submitted", { q1: "opt2" }),
      inst("s4", "submitted", {}),
    ]);
    const q1 = agg.questions[0];
    expect(q1.respondents).toBe(3);
    expect(q1.skipped).toBe(1);
    const opt1 = q1.options?.find((o) => o.value === "opt1");
    expect(opt1?.count).toBe(2);
    expect(opt1?.pct).toBeCloseTo((2 / 3) * 100);
    expect(opt1?.label).toBe("Undergraduate");
  });

  it("collects Other selections and their typed texts", () => {
    const agg = aggregateSurvey(questions, [
      inst("s1", "submitted", {
        q1: OTHER_VALUE,
        q1__other_text: "Post-doc",
      }),
      inst("s2", "submitted", { q1: "opt2" }),
    ]);
    const q1 = agg.questions[0];
    const other = q1.options?.find((o) => o.isOther);
    expect(other?.label).toBe("Other (specify)");
    expect(other?.count).toBe(1);
    expect(q1.otherTexts).toEqual(["Post-doc"]);
  });

  it("surfaces orphaned stored values instead of dropping them", () => {
    const agg = aggregateSurvey(questions, [
      inst("s1", "submitted", { q1: "opt_deleted" }),
    ]);
    const q1 = agg.questions[0];
    const orphan = q1.options?.find((o) => o.isOrphan);
    expect(orphan?.value).toBe("opt_deleted");
    expect(orphan?.count).toBe(1);
  });

  it("counts each selection in choice_multi (percentages may exceed 100 in total)", () => {
    const agg = aggregateSurvey(questions, [
      inst("s1", "submitted", { q2: ["opt1", "opt2"] }),
      inst("s2", "submitted", { q2: ["opt1"] }),
    ]);
    const q2 = agg.questions[1];
    expect(q2.respondents).toBe(2);
    expect(q2.options?.find((o) => o.value === "opt1")?.count).toBe(2);
    expect(q2.options?.find((o) => o.value === "opt1")?.pct).toBe(100);
    expect(q2.options?.find((o) => o.value === "opt2")?.pct).toBe(50);
  });

  it("computes likert distribution, mean, and median", () => {
    const agg = aggregateSurvey(questions, [
      inst("s1", "submitted", { q3: 5 }),
      inst("s2", "submitted", { q3: 4 }),
      inst("s3", "submitted", { q3: 4 }),
      inst("s4", "submitted", { q3: 99 }), // out of range → ignored
    ]);
    const likert = agg.questions[2].likert;
    expect(likert?.scale).toBe(5);
    expect(likert?.counts[4]).toBe(2);
    expect(likert?.counts[5]).toBe(1);
    expect(likert?.mean).toBeCloseTo(13 / 3);
    expect(likert?.median).toBe(4);
    expect(likert?.leftAnchor).toBe("Low");
  });

  it("returns null mean/median with no valid likert answers", () => {
    const agg = aggregateSurvey(questions, [inst("s1", "submitted", {})]);
    const likert = agg.questions[2].likert;
    expect(likert?.mean).toBeNull();
    expect(likert?.median).toBeNull();
  });

  it("collects free text answers with their author", () => {
    const agg = aggregateSurvey(questions, [
      inst("s1", "submitted", { q4: "Loved it" }),
      inst("s2", "submitted", { q4: "   " }),
    ]);
    const q4 = agg.questions[3];
    expect(q4.texts).toEqual([{ studentUserId: "s1", text: "Loved it" }]);
  });

  it("falls back to text listing for unknown question types", () => {
    const legacy: SurveyQuestionDef[] = [{ id: "q9", prompt: "Legacy?" }];
    const agg = aggregateSurvey(legacy, [
      inst("s1", "submitted", { q9: "Great" }),
    ]);
    expect(agg.questions[0].texts).toEqual([
      { studentUserId: "s1", text: "Great" },
    ]);
  });

  it("collapses duplicate option values into one row", () => {
    const dupe: SurveyQuestionDef[] = [
      {
        id: "q1",
        type: "choice_single",
        prompt: "Dupe?",
        config: {
          options: [
            { value: "opt1", label: "First" },
            { value: "opt1", label: "Second" },
          ],
        },
      },
    ];
    const agg = aggregateSurvey(dupe, [
      inst("s1", "submitted", { q1: "opt1" }),
    ]);
    const rows = agg.questions[0].options ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("First");
    expect(rows[0].count).toBe(1);
  });
});
