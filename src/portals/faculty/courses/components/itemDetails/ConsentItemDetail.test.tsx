import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConsentItemDetail } from "./ConsentItemDetail";
import { MantineTestWrapper } from "../../../../../test-utils/renderWithMantine";

function Harness(props: any) {
  return (
    <MantineTestWrapper>
      <ConsentItemDetail {...props} />
    </MantineTestWrapper>
  );
}

const decision = {
  consentItemId: "ci-1",
  studentUserId: "stu-A",
  courseId: "c-1",
  decision: "agreed" as const,
  consentVersion: "v2",
  decidedAt: "2026-01-10T00:00:00Z",
  updatedAt: "2026-01-10T00:00:00Z",
};

describe("ConsentItemDetail", () => {
  it("renders decision, version, and date", () => {
    render(<Harness itemId="ci-1" decisions={[decision]} />);
    expect(screen.getByText("agreed")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it("renders 'no decision yet' when missing", () => {
    render(<Harness itemId="ci-99" decisions={[]} />);
    expect(screen.getByText(/no decision yet/i)).toBeInTheDocument();
  });
});
