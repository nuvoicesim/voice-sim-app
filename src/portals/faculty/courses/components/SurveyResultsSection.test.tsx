import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  SurveyResultsSection,
  type SurveyStatsStudent,
} from "./SurveyResultsSection";
import { MantineTestWrapper } from "../../../../test-utils/renderWithMantine";

vi.mock("../../../../api/surveyInstanceApi", () => ({
  surveyInstanceApi: {
    getForStudent: vi.fn(),
  },
}));

import {
  surveyInstanceApi,
  type SurveyInstanceRow,
} from "../../../../api/surveyInstanceApi";
import type { ModuleItem } from "../../../../slices/moduleItemSlice";

const questions = [
  {
    id: "q1",
    type: "choice_single",
    prompt: "Background?",
    config: {
      options: [
        { value: "opt1", label: "Undergraduate" },
        { value: "opt2", label: "Graduate" },
      ],
    },
  },
];

const students: SurveyStatsStudent[] = [
  {
    studentUserId: "stu-a",
    studentEmail: "a@x.edu",
    consented: true,
    groupKey: "A",
  },
  {
    studentUserId: "stu-b",
    studentEmail: "b@x.edu",
    consented: true,
    groupKey: "B",
  },
  {
    studentUserId: "stu-c",
    studentEmail: "c@x.edu",
    consented: false, // declined → must never be fetched or counted
    groupKey: "A",
  },
];

const sortedModules = [{ moduleId: "m1", title: "Module One", position: 0 }];

const itemsByModule: Record<string, ModuleItem[]> = {
  m1: [
    {
      moduleItemId: "it-survey",
      moduleId: "m1",
      courseId: "c-1",
      itemType: "survey",
      title: "Feedback Survey",
      position: 0,
      payload: { surveyTemplateId: "tpl-1" },
      createdAt: "",
      updatedAt: "",
    },
    // Markdown-only debrief (no surveyTemplateId): must be excluded from the
    // stats view entirely — no card, no GETs.
    {
      moduleItemId: "it-debrief",
      moduleId: "m1",
      courseId: "c-1",
      itemType: "debrief",
      title: "Markdown Debrief",
      position: 1,
      payload: { markdown: "Well done!", ratingPrompts: [] },
      createdAt: "",
      updatedAt: "",
    },
  ],
};

function instanceFor(
  studentUserId: string,
  answer: string
): { instance: SurveyInstanceRow } {
  return {
    instance: {
      moduleItemId: "it-survey",
      studentUserId,
      surveyInstanceId: `sv-${studentUserId}`,
      surveyTemplateId: "tpl-1",
      courseId: "c-1",
      status: "submitted",
      startedAt: "2026-02-01T00:00:00Z",
      submittedAt: "2026-02-01T00:10:00Z",
      updatedAt: "2026-02-01T00:10:00Z",
      schemaSnapshot: { questions },
      answers: { q1: answer },
    },
  };
}

function Harness() {
  return (
    <MantineTestWrapper>
      <SurveyResultsSection
        courseId="c-1"
        students={students}
        sortedModules={sortedModules}
        itemsByModule={itemsByModule}
      />
    </MantineTestWrapper>
  );
}

beforeEach(() => {
  vi.mocked(surveyInstanceApi.getForStudent).mockReset();
  vi.mocked(surveyInstanceApi.getForStudent).mockImplementation(
    async (itemId: string, studentUserId: string) => {
      if (itemId !== "it-survey") {
        throw new Error(`unexpected fetch for item ${itemId}`);
      }
      if (studentUserId === "stu-a") return instanceFor("stu-a", "opt1");
      if (studentUserId === "stu-b") return instanceFor("stu-b", "opt2");
      throw new Error(`unexpected fetch for ${studentUserId}`);
    }
  );
});

describe("SurveyResultsSection", () => {
  it("fetches nothing while collapsed (lazy-load guarantee)", () => {
    render(<Harness />);
    expect(screen.getByText("Survey Results")).toBeInTheDocument();
    expect(surveyInstanceApi.getForStudent).not.toHaveBeenCalled();
  });

  it("loads consented students only and shows labeled distributions on expand", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("Survey Results"));

    await waitFor(() =>
      expect(screen.getByText("Undergraduate")).toBeInTheDocument()
    );
    // Both consented students fetched; the declined student never fetched.
    expect(surveyInstanceApi.getForStudent).toHaveBeenCalledTimes(2);
    expect(surveyInstanceApi.getForStudent).not.toHaveBeenCalledWith(
      "it-survey",
      "stu-c"
    );

    expect(screen.getByText("Feedback Survey")).toBeInTheDocument();
    expect(screen.getByText("Graduate")).toBeInTheDocument();
    // 1 of 2 respondents per option → 50% each.
    expect(screen.getAllByText("1 (50%)")).toHaveLength(2);
    expect(screen.getByText(/2 submitted/)).toBeInTheDocument();

    // The markdown-only debrief is excluded: no card, no fetches.
    expect(screen.queryByText("Markdown Debrief")).not.toBeInTheDocument();
    expect(surveyInstanceApi.getForStudent).not.toHaveBeenCalledWith(
      "it-debrief",
      expect.anything()
    );
    expect(screen.getByText("1 survey")).toBeInTheDocument();
  });

  it("filters statistics by group", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("Survey Results"));
    await waitFor(() =>
      expect(screen.getByText("Undergraduate")).toBeInTheDocument()
    );

    // Only consented students count toward group sizes: A(1), B(1).
    await user.click(screen.getByRole("radio", { name: "A (1)" }));

    // Group A contains only stu-a → opt1 is 100%, opt2 is 0%.
    await waitFor(() =>
      expect(screen.getByText("1 (100%)")).toBeInTheDocument()
    );
    expect(screen.getByText("0 (0%)")).toBeInTheDocument();
    expect(screen.getByText(/1 submitted/)).toBeInTheDocument();
  });
});
