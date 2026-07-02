import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SurveyItemDetail } from "./SurveyItemDetail";
import { MantineTestWrapper } from "../../../../../test-utils/renderWithMantine";

vi.mock("../../../../../api/surveyInstanceApi", () => ({
  surveyInstanceApi: {
    getForStudent: vi.fn(),
  },
}));

import { surveyInstanceApi } from "../../../../../api/surveyInstanceApi";

function Harness(props: { itemId: string; studentUserId: string }) {
  return (
    <MantineTestWrapper>
      <SurveyItemDetail {...props} />
    </MantineTestWrapper>
  );
}

beforeEach(() => {
  vi.mocked(surveyInstanceApi.getForStudent).mockReset();
});

describe("SurveyItemDetail", () => {
  it("renders submitted answers against schema snapshot", async () => {
    vi.mocked(surveyInstanceApi.getForStudent).mockResolvedValue({
      instance: {
        moduleItemId: "it-1",
        studentUserId: "stu-A",
        surveyInstanceId: "sv-1",
        surveyTemplateId: "tpl-1",
        courseId: "c-1",
        status: "submitted",
        submittedAt: "2026-02-01T00:00:00Z",
        schemaSnapshot: {
          questions: [{ id: "q1", prompt: "How do you feel?" }],
        },
        answers: { q1: "Great" },
      },
    });

    render(<Harness itemId="it-1" studentUserId="stu-A" />);
    await waitFor(() =>
      expect(screen.getByText(/How do you feel/)).toBeInTheDocument()
    );
    expect(screen.getByText("Great")).toBeInTheDocument();
    expect(screen.getAllByText(/submitted/i).length).toBeGreaterThan(0);
  });

  it("renders 'Not started' when instance is null", async () => {
    vi.mocked(surveyInstanceApi.getForStudent).mockResolvedValue({
      instance: null,
    });
    render(<Harness itemId="it-2" studentUserId="stu-A" />);
    await waitFor(() =>
      expect(screen.getByText(/Not started/i)).toBeInTheDocument()
    );
  });

  it("maps stored choice values to human-readable option labels", async () => {
    vi.mocked(surveyInstanceApi.getForStudent).mockResolvedValue({
      instance: {
        moduleItemId: "it-3",
        studentUserId: "stu-A",
        surveyInstanceId: "sv-3",
        surveyTemplateId: "tpl-1",
        courseId: "c-1",
        status: "submitted",
        submittedAt: "2026-02-01T00:00:00Z",
        schemaSnapshot: {
          questions: [
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
            {
              id: "q2",
              type: "choice_multi",
              prompt: "Skills gained?",
              config: {
                options: [
                  { value: "opt1", label: "Communication" },
                  { value: "opt2", label: "Teamwork" },
                ],
                allowOther: true,
                otherLabel: "Other (specify)",
              },
            },
            {
              id: "q3",
              type: "choice_single",
              prompt: "Orphaned?",
              config: { options: [{ value: "opt1", label: "Kept" }] },
            },
          ],
        },
        answers: {
          q1: "opt2",
          q2: ["opt1", "__other__"],
          q2__other_text: "Patience",
          q3: "opt_gone",
        },
      },
    });

    render(<Harness itemId="it-3" studentUserId="stu-A" />);
    await waitFor(() =>
      expect(screen.getByText("Graduate")).toBeInTheDocument()
    );
    // Raw internal values must not leak into the UI.
    expect(screen.queryByText("opt2")).not.toBeInTheDocument();
    expect(
      screen.getByText("Communication, Other (specify): Patience")
    ).toBeInTheDocument();
    // Orphaned values (option removed after snapshot) fall back to the raw
    // stored value rather than disappearing.
    expect(screen.getByText("opt_gone")).toBeInTheDocument();
  });

  it("shows likert answers with their scale anchors", async () => {
    vi.mocked(surveyInstanceApi.getForStudent).mockResolvedValue({
      instance: {
        moduleItemId: "it-4",
        studentUserId: "stu-A",
        surveyInstanceId: "sv-4",
        surveyTemplateId: "tpl-1",
        courseId: "c-1",
        status: "submitted",
        submittedAt: "2026-02-01T00:00:00Z",
        schemaSnapshot: {
          questions: [
            {
              id: "q1",
              type: "likert",
              prompt: "Confidence?",
              config: {
                scale: 7,
                leftAnchor: "Not at all",
                rightAnchor: "Extremely",
              },
            },
          ],
        },
        answers: { q1: 6 },
      },
    });

    render(<Harness itemId="it-4" studentUserId="stu-A" />);
    await waitFor(() => expect(screen.getByText("6")).toBeInTheDocument());
    expect(
      screen.getByText("1 = Not at all · 7 = Extremely")
    ).toBeInTheDocument();
  });
});
