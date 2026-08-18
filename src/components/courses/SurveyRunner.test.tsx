import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { describe, expect, it, vi } from "vitest";
import { OTHER_VALUE, otherTextKey, SurveyRunner } from "./SurveyRunner";
import type { SurveyQuestion } from "../../slices/surveyTemplateSlice";

function renderRunner(
  questions: SurveyQuestion[],
  answers: Record<string, unknown>,
  sectionHeaders?: Record<number, string>
) {
  return render(
    <MantineProvider>
      <SurveyRunner
        questions={questions}
        answers={answers}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        sectionHeaders={sectionHeaders}
      />
    </MantineProvider>
  );
}

describe("SurveyRunner Phase 3 display-only sections", () => {
  it("maps Q1-Q6/Q7-Q12/Q13-Q18 to A/B/C without changing prompts", () => {
    const questions = Array.from({ length: 18 }, (_, i) => ({
      id: `q${i + 1}`,
      type: "likert" as const,
      prompt: `Frozen wording ${i + 1}`,
      required: true,
      config: { scale: 7, leftAnchor: "Low", rightAnchor: "High" },
    }));
    renderRunner(
      questions,
      {},
      {
        0: "The following questions are about Feedback Card A",
        6: "The following questions are about Feedback Card B",
        12: "The following questions are about Feedback Card C",
      }
    );

    expect(screen.getByText(/Feedback Card A$/)).toBeInTheDocument();
    expect(screen.getByText(/Feedback Card B$/)).toBeInTheDocument();
    expect(screen.getByText(/Feedback Card C$/)).toBeInTheDocument();
    expect(screen.getByText("Frozen wording 1")).toBeInTheDocument();
    expect(screen.getByText("Frozen wording 7")).toBeInTheDocument();
    expect(screen.getByText("Frozen wording 13")).toBeInTheDocument();
  });
});

describe("SurveyRunner Q23 Other", () => {
  const q23: SurveyQuestion = {
    id: "q23",
    type: "choice_multi",
    prompt: "Which features influenced your decision?",
    required: true,
    config: {
      options: [{ value: "tone", label: "Tone or word choice" }],
      allowOther: true,
      otherLabel: "Other feature not listed (specify)",
    },
  };

  it("uses __other__, shows the text field, and blocks submit while it is empty", () => {
    renderRunner([q23], { q23: [OTHER_VALUE] });
    expect(
      screen.getByPlaceholderText("Please specify...")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Submit Survey" })
    ).toBeDisabled();
  });

  it("allows submit once the conditional Other text is present", () => {
    renderRunner([q23], {
      q23: [OTHER_VALUE],
      [otherTextKey("q23")]: "Sentence structure",
    });
    expect(screen.getByRole("button", { name: "Submit Survey" })).toBeEnabled();
  });
});
