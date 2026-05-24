import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AIDetectionItemDetail } from "./AIDetectionItemDetail";
import { MantineTestWrapper } from "../../../../../test-utils/renderWithMantine";

vi.mock("../../../../../api/moduleItemApi", () => ({
  moduleItemApi: {
    getSubQuestions: vi.fn(),
  },
}));
import { moduleItemApi } from "../../../../../api/moduleItemApi";

function Harness(props: any) {
  return (
    <MantineTestWrapper>
      <AIDetectionItemDetail {...props} />
    </MantineTestWrapper>
  );
}

beforeEach(() => {
  vi.mocked(moduleItemApi.getSubQuestions).mockReset();
});

describe("AIDetectionItemDetail", () => {
  it("renders sub-questions with pick and follow-up", async () => {
    vi.mocked(moduleItemApi.getSubQuestions).mockResolvedValue({
      subQuestions: [
        {
          assignmentItemId: "ai-1",
          assignmentTitle: "Patient X",
          locked: false,
          missing: [],
          existingAnswer: {
            pickedDisplayKey: "B",
            followUpText: "Spoke too fast",
          },
        },
      ],
    } as any);

    render(<Harness itemId="it-1" studentUserId="stu-A" />);
    await waitFor(() =>
      expect(screen.getByText("Patient X")).toBeInTheDocument()
    );
    expect(screen.getByText(/B/)).toBeInTheDocument();
    expect(screen.getByText(/Spoke too fast/)).toBeInTheDocument();
  });

  it("renders 'No sub-questions' on empty list", async () => {
    vi.mocked(moduleItemApi.getSubQuestions).mockResolvedValue({
      subQuestions: [],
    } as any);
    render(<Harness itemId="it-2" studentUserId="stu-A" />);
    await waitFor(() =>
      expect(screen.getByText(/no sub-questions/i)).toBeInTheDocument()
    );
  });

  it("shows 'locked' badge when sub-question is locked", async () => {
    vi.mocked(moduleItemApi.getSubQuestions).mockResolvedValue({
      subQuestions: [
        {
          assignmentItemId: "ai-2",
          assignmentTitle: "Patient Y",
          locked: true,
          missing: ["assignment-z"],
          existingAnswer: null,
        },
      ],
    } as any);
    render(<Harness itemId="it-3" studentUserId="stu-A" />);
    await waitFor(() =>
      expect(screen.getByText(/locked/i)).toBeInTheDocument()
    );
  });
});
