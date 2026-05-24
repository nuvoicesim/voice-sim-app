import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AssignmentItemDetail } from "./AssignmentItemDetail";
import { MantineTestWrapper } from "../../../../../test-utils/renderWithMantine";

vi.mock("../../../../../api/moduleItemApi", () => ({
  moduleItemApi: {
    getBestSession: vi.fn(),
  },
}));
import { moduleItemApi } from "../../../../../api/moduleItemApi";

function Harness(props: any) {
  return (
    <MemoryRouter>
      <MantineTestWrapper>
        <AssignmentItemDetail {...props} />
      </MantineTestWrapper>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.mocked(moduleItemApi.getBestSession).mockReset();
});

describe("AssignmentItemDetail", () => {
  it("renders score, evaluation, and transcript", async () => {
    vi.mocked(moduleItemApi.getBestSession).mockResolvedValue({
      session: {
        sessionId: "s-1",
        attemptNo: 2,
        startedAt: "2026-02-01T10:00:00Z",
        endedAt: "2026-02-01T10:10:00Z",
        status: "completed",
      },
      turns: [
        { turnIndex: 0, userText: "Hi", modelText: "Hello" },
        { turnIndex: 1, userText: "How are you", modelText: "Fine" },
      ],
      evaluation: { totalScore: 18, overallExplanation: "Solid attempt" },
    } as any);

    render(<Harness itemId="it-1" studentUserId="stu-A" courseId="c-1" />);
    await waitFor(() =>
      expect(screen.getByText(/Solid attempt/)).toBeInTheDocument()
    );
    expect(screen.getByText(/18\/24/)).toBeInTheDocument();
    expect(screen.getByText("Hi")).toBeInTheDocument();
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("renders 'No completed attempt yet' when session null", async () => {
    vi.mocked(moduleItemApi.getBestSession).mockResolvedValue({
      session: null,
    } as any);
    render(<Harness itemId="it-2" studentUserId="stu-A" courseId="c-1" />);
    await waitFor(() =>
      expect(screen.getByText(/No completed attempt yet/i)).toBeInTheDocument()
    );
  });
});
