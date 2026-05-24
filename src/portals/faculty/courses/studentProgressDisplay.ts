import type { ConsentDecisionRow } from "../../../api/consentApi";
import type { CourseGroupAssignmentRow } from "../../../api/groupAssignmentApi";
import type { StudentItemProgress } from "../../../slices/studentProgressSlice";

export interface BadgeDisplay {
  label: string;
  color: string;
  variant: "filled" | "light" | "outline";
}

export function consentBadgeProps(
  decision: ConsentDecisionRow | null
): BadgeDisplay {
  if (!decision)
    return { label: "—", color: "parchment", variant: "light" };
  if (decision.decision === "agreed")
    return { label: "agreed", color: "terracotta", variant: "filled" };
  return { label: "declined", color: "terracotta", variant: "outline" };
}

export function groupBadgeProps(
  assignment: CourseGroupAssignmentRow | null
): BadgeDisplay {
  if (!assignment)
    return { label: "—", color: "parchment", variant: "light" };
  return { label: assignment.groupKey, color: "terracotta", variant: "light" };
}

export function progressStateBadgeProps(
  progress: StudentItemProgress | null | undefined
): BadgeDisplay {
  if (!progress)
    return { label: "not started", color: "parchment", variant: "outline" };
  switch (progress.state) {
    case "completed":
      return { label: "completed", color: "terracotta", variant: "filled" };
    case "in_progress":
      return { label: "in progress", color: "terracotta", variant: "light" };
    case "unlocked":
      return { label: "unlocked", color: "parchment", variant: "light" };
    case "locked":
    default:
      return { label: "locked", color: "parchment", variant: "outline" };
  }
}
