import { describe, it, expect } from "vitest";
import {
  formatAnswer,
  likertScaleHint,
  choiceOptionLabel,
  otherTextKey,
  OTHER_VALUE,
  type SurveyQuestionDef,
} from "./surveyAnswerFormat";

const choiceSingle: SurveyQuestionDef = {
  id: "q1",
  type: "choice_single",
  prompt: "Which best describes your background?",
  config: {
    options: [
      { value: "opt1", label: "Undergraduate" },
      { value: "opt2", label: "Graduate" },
    ],
    allowOther: true,
    otherLabel: "Other (please specify)",
  },
};

const choiceMulti: SurveyQuestionDef = {
  id: "q2",
  type: "choice_multi",
  prompt: "Select all skills you gained:",
  config: {
    options: [
      { value: "opt1", label: "Communication" },
      { value: "opt2", label: "Critical thinking" },
      { value: "opt3", label: "Teamwork" },
    ],
  },
};

const likert: SurveyQuestionDef = {
  id: "q3",
  type: "likert",
  prompt: "Rate your confidence",
  config: { scale: 7, leftAnchor: "Not at all", rightAnchor: "Extremely" },
};

describe("formatAnswer", () => {
  it("maps a choice_single value to its label", () => {
    expect(formatAnswer(choiceSingle, "opt2")).toBe("Graduate");
  });

  it("falls back to the raw value for orphaned choice values", () => {
    expect(formatAnswer(choiceSingle, "opt9")).toBe("opt9");
  });

  it("renders the Other label with typed text", () => {
    const answers = { q1: OTHER_VALUE, [otherTextKey("q1")]: "Post-doc" };
    expect(formatAnswer(choiceSingle, OTHER_VALUE, answers)).toBe(
      "Other (please specify): Post-doc"
    );
  });

  it("renders the Other label alone when no text was typed", () => {
    expect(formatAnswer(choiceSingle, OTHER_VALUE, { q1: OTHER_VALUE })).toBe(
      "Other (please specify)"
    );
  });

  it("maps choice_multi arrays to joined labels", () => {
    expect(formatAnswer(choiceMulti, ["opt1", "opt3"])).toBe(
      "Communication, Teamwork"
    );
  });

  it("handles Other inside a choice_multi selection", () => {
    const answers = { [otherTextKey("q2")]: "Patience" };
    expect(formatAnswer(choiceMulti, ["opt2", OTHER_VALUE], answers)).toBe(
      "Critical thinking, Other: Patience"
    );
  });

  it("renders likert answers as the numeric rating", () => {
    expect(formatAnswer(likert, 6)).toBe("6");
  });

  it("renders free text and unknown question types as-is", () => {
    const freeText: SurveyQuestionDef = {
      id: "q4",
      type: "free_text",
      prompt: "Comments?",
    };
    expect(formatAnswer(freeText, "Great course")).toBe("Great course");
    const legacy: SurveyQuestionDef = { id: "q5", prompt: "Legacy?" };
    expect(formatAnswer(legacy, "Great")).toBe("Great");
  });

  it("uses the empty text for missing answers", () => {
    expect(formatAnswer(choiceSingle, undefined)).toBe("—");
    expect(formatAnswer(choiceSingle, "", {}, "(no answer)")).toBe(
      "(no answer)"
    );
    expect(formatAnswer(choiceMulti, [])).toBe("—");
  });
});

describe("choiceOptionLabel", () => {
  it("returns the label for a known value and the value otherwise", () => {
    expect(choiceOptionLabel(choiceSingle, "opt1")).toBe("Undergraduate");
    expect(choiceOptionLabel(choiceSingle, "gone")).toBe("gone");
  });
});

describe("likertScaleHint", () => {
  it("describes both anchors", () => {
    expect(likertScaleHint(likert)).toBe("1 = Not at all · 7 = Extremely");
  });

  it("returns null for non-likert questions or missing anchors", () => {
    expect(likertScaleHint(choiceSingle)).toBeNull();
    expect(
      likertScaleHint({ id: "q", type: "likert", prompt: "p", config: { scale: 5 } })
    ).toBeNull();
  });
});
