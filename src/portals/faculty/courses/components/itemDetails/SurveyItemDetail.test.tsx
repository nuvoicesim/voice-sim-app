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

function Harness(props: any) {
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
    } as any);

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
    } as any);
    render(<Harness itemId="it-2" studentUserId="stu-A" />);
    await waitFor(() =>
      expect(screen.getByText(/Not started/i)).toBeInTheDocument()
    );
  });
});
