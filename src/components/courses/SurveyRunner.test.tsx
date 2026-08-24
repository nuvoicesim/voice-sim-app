import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { describe, expect, it, vi } from "vitest";
import { OTHER_VALUE, otherTextKey, SurveyRunner } from "./SurveyRunner";
import type { SurveyQuestion } from "../../slices/surveyTemplateSlice";

function renderRunner(
  questions: SurveyQuestion[],
  answers: Record<string, unknown>,
  sectionHeaders?: Record<number, string>,
  hideQuestionNumbers?: boolean
) {
  return render(
    <MantineProvider>
      <SurveyRunner
        questions={questions}
        answers={answers}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        sectionHeaders={sectionHeaders}
        hideQuestionNumbers={hideQuestionNumbers}
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

describe("SurveyRunner question numbering", () => {
  const questions: SurveyQuestion[] = Array.from({ length: 3 }, (_, i) => ({
    id: `q${i + 1}`,
    type: "likert" as const,
    prompt: `Prompt ${i + 1}`,
    required: true,
    config: { scale: 7, leftAnchor: "Low", rightAnchor: "High" },
  }));

  it("shows Q{n} badges by default (existing surveys keep their numbering)", () => {
    renderRunner(questions, {});
    expect(screen.getByText("Q1")).toBeInTheDocument();
    expect(screen.getByText("Q2")).toBeInTheDocument();
    expect(screen.getByText("Q3")).toBeInTheDocument();
  });

  it("hides every question number when hideQuestionNumbers is set (Phase 3)", () => {
    renderRunner(
      questions,
      {},
      { 0: "The following questions are about Feedback Card A" },
      true
    );
    // No numbering anywhere — students see only headings, prompts, options.
    expect(screen.queryByText(/^Q\d+$/)).toBeNull();
    // Prompts, section headings, and the Required badge still render.
    expect(screen.getByText("Prompt 1")).toBeInTheDocument();
    expect(screen.getByText(/Feedback Card A$/)).toBeInTheDocument();
    expect(screen.getAllByText("Required").length).toBe(3);
  });

  it("keeps numbering visible when hideQuestionNumbers is false", () => {
    renderRunner(questions, {}, undefined, false);
    expect(screen.getByText("Q1")).toBeInTheDocument();
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
