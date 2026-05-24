import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GenericItemDetail } from "./GenericItemDetail";
import { MantineTestWrapper } from "../../../../../test-utils/renderWithMantine";

function Harness(props: any) {
  return (
    <MantineTestWrapper>
      <GenericItemDetail {...props} />
    </MantineTestWrapper>
  );
}

describe("GenericItemDetail", () => {
  it("shows completed timestamp when progress.completedAt set", () => {
    render(
      <Harness
        progress={{
          state: "completed",
          completedAt: "2026-03-01T12:00:00Z",
        }}
      />
    );
    expect(screen.getByText(/completed/i)).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it("shows 'not completed' when no progress", () => {
    render(<Harness progress={null} />);
    expect(screen.getByText(/not completed/i)).toBeInTheDocument();
  });

  it("renders extra note when provided", () => {
    render(<Harness progress={null} note="Group shown in summary above" />);
    expect(screen.getByText(/Group shown in summary/)).toBeInTheDocument();
  });
});
