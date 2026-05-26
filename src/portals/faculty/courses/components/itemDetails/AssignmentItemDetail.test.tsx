import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AssignmentItemDetail } from "./AssignmentItemDetail";
import { MantineTestWrapper } from "../../../../../test-utils/renderWithMantine";

vi.mock("../../../../../api/sessionApi", () => ({
  sessionApi: {
    listByAssignment: vi.fn(),
    get: vi.fn(),
  },
}));
import { sessionApi } from "../../../../../api/sessionApi";

function Harness(props: any) {
  return (
    <MemoryRouter>
      <MantineTestWrapper>
        <AssignmentItemDetail {...props} />
      </MantineTestWrapper>
    </MemoryRouter>
  );
}

const baseProps = {
  itemId: "it-1",
  studentUserId: "stu-A",
  courseId: "c-1",
  assignmentId: "asg-1",
};

beforeEach(() => {
  vi.mocked(sessionApi.listByAssignment).mockReset();
  vi.mocked(sessionApi.get).mockReset();
});

describe("AssignmentItemDetail", () => {
  it("lists all completed attempts for the selected student and assignment", async () => {
    vi.mocked(sessionApi.listByAssignment).mockResolvedValue({
      sessions: [
        {
          sessionId: "s-1",
          attemptNo: 1,
          mode: "assessment",
          status: "completed",
          startedAt: "2026-02-01T10:00:00Z",
          endedAt: "2026-02-01T10:10:00Z",
        },
        {
          sessionId: "s-2",
          attemptNo: 2,
          mode: "assessment",
          status: "completed",
          startedAt: "2026-02-02T10:00:00Z",
          endedAt: "2026-02-02T10:08:00Z",
        },
        // active attempt must be filtered out (matches Student History)
        {
          sessionId: "s-3",
          attemptNo: 3,
          mode: "assessment",
          status: "active",
          startedAt: "2026-02-03T10:00:00Z",
          endedAt: null,
        },
      ],
    } as any);

    render(<Harness {...baseProps} />);

    await waitFor(() =>
      expect(screen.getByText(/attempt #1/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/attempt #2/i)).toBeInTheDocument();
    expect(screen.queryByText(/attempt #3/i)).not.toBeInTheDocument();
    expect(sessionApi.listByAssignment).toHaveBeenCalledWith("asg-1", {
      studentUserId: "stu-A",
    });
  });

  it("loads full session detail lazily only when an attempt is opened", async () => {
    vi.mocked(sessionApi.listByAssignment).mockResolvedValue({
      sessions: [
        {
          sessionId: "s-1",
          attemptNo: 1,
          mode: "assessment",
          status: "completed",
          startedAt: "2026-02-01T10:00:00Z",
          endedAt: "2026-02-01T10:10:00Z",
        },
      ],
    } as any);
    vi.mocked(sessionApi.get).mockResolvedValue({
      session: {
        sessionId: "s-1",
        attemptNo: 1,
        mode: "assessment",
        status: "completed",
        startedAt: "2026-02-01T10:00:00Z",
        endedAt: "2026-02-01T10:10:00Z",
      },
      turns: [
        { turnIndex: 0, userText: "Hi", modelText: "Hello" },
        { turnIndex: 1, userText: "How are you", modelText: "Fine" },
      ],
      evaluation: { totalScore: 18, performanceLevel: "good", overallExplanation: "Solid attempt" },
    } as any);

    render(<Harness {...baseProps} />);
    await waitFor(() =>
      expect(screen.getByText(/attempt #1/i)).toBeInTheDocument()
    );

    // Detail not fetched until the row is expanded.
    expect(sessionApi.get).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText(/attempt #1/i));

    await waitFor(() =>
      expect(screen.getByText(/Solid attempt/)).toBeInTheDocument()
    );
    expect(sessionApi.get).toHaveBeenCalledWith("s-1");
    expect(screen.getByText(/18\/24/)).toBeInTheDocument();
    expect(screen.getByText("Hi")).toBeInTheDocument();
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("shows 'No evaluation available' when evaluation is null", async () => {
    vi.mocked(sessionApi.listByAssignment).mockResolvedValue({
      sessions: [
        {
          sessionId: "s-1",
          attemptNo: 1,
          mode: "assessment",
          status: "completed",
          startedAt: "2026-02-01T10:00:00Z",
          endedAt: "2026-02-01T10:10:00Z",
        },
      ],
    } as any);
    vi.mocked(sessionApi.get).mockResolvedValue({
      session: {
        sessionId: "s-1",
        attemptNo: 1,
        mode: "assessment",
        status: "completed",
        startedAt: "2026-02-01T10:00:00Z",
        endedAt: "2026-02-01T10:10:00Z",
      },
      turns: [],
      evaluation: null,
    } as any);

    render(<Harness {...baseProps} />);
    await waitFor(() =>
      expect(screen.getByText(/attempt #1/i)).toBeInTheDocument()
    );
    fireEvent.click(screen.getByText(/attempt #1/i));

    await waitFor(() =>
      expect(screen.getByText(/No evaluation available/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/No conversation turns recorded/i)).toBeInTheDocument();
  });

  it("shows 'No completed session yet' when there are no completed attempts", async () => {
    vi.mocked(sessionApi.listByAssignment).mockResolvedValue({
      sessions: [],
    } as any);
    render(<Harness {...baseProps} />);
    await waitFor(() =>
      expect(screen.getByText(/No completed session yet/i)).toBeInTheDocument()
    );
  });

  it("shows 'Assignment link unavailable' and does not call the API when assignmentId is missing", async () => {
    render(<Harness {...baseProps} assignmentId={undefined} />);
    await waitFor(() =>
      expect(screen.getByText(/Assignment link unavailable/i)).toBeInTheDocument()
    );
    expect(sessionApi.listByAssignment).not.toHaveBeenCalled();
  });

  it("shows an inline error for an attempt whose detail fails to load, keeping the list visible", async () => {
    vi.mocked(sessionApi.listByAssignment).mockResolvedValue({
      sessions: [
        {
          sessionId: "s-1",
          attemptNo: 1,
          mode: "assessment",
          status: "completed",
          startedAt: "2026-02-01T10:00:00Z",
          endedAt: "2026-02-01T10:10:00Z",
        },
      ],
    } as any);
    vi.mocked(sessionApi.get).mockRejectedValue(new Error("boom"));

    render(<Harness {...baseProps} />);
    await waitFor(() =>
      expect(screen.getByText(/attempt #1/i)).toBeInTheDocument()
    );
    fireEvent.click(screen.getByText(/attempt #1/i));

    await waitFor(() => expect(screen.getByText(/boom/i)).toBeInTheDocument());
    // attempts list remains visible
    expect(screen.getByText(/attempt #1/i)).toBeInTheDocument();
  });
});
