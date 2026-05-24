import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StudentSummaryCard } from "./StudentSummaryCard";
import { MantineTestWrapper } from "../../../../test-utils/renderWithMantine";

const consent = {
  consentItemId: "ci-1",
  studentUserId: "stu-A",
  courseId: "c-1",
  decision: "agreed" as const,
  consentVersion: "v1",
  decidedAt: "2026-01-10T00:00:00Z",
  updatedAt: "2026-01-10T00:00:00Z",
};
const group = {
  courseId: "c-1",
  studentUserId: "stu-A",
  scopeKey: "c-1",
  groupKey: "A",
  assignedAt: "2026-01-10T00:00:00Z",
};
const enrollment = {
  studentUserId: "stu-A",
  studentEmail: "alice@example.com",
  enrolledAt: "2026-01-09T00:00:00Z",
  status: "active",
};

function Harness(props: any) {
  return (
    <MantineTestWrapper>
      <StudentSummaryCard {...props} />
    </MantineTestWrapper>
  );
}

describe("StudentSummaryCard", () => {
  it("shows email, consent, and group info", () => {
    render(
      <Harness
        enrollment={enrollment}
        consentDecisions={[consent]}
        groupAssignments={[group]}
      />
    );
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("agreed")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("shows fallback copy when no consent rows", () => {
    render(
      <Harness
        enrollment={enrollment}
        consentDecisions={[]}
        groupAssignments={[]}
      />
    );
    expect(screen.getByText(/no consent decisions/i)).toBeInTheDocument();
    expect(screen.getByText(/no group assignment/i)).toBeInTheDocument();
  });
});
