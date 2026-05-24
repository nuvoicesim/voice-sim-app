import { Card, Stack, Text, Group, Badge } from "@mantine/core";
import type { ConsentDecisionRow } from "../../../../api/consentApi";
import type { CourseGroupAssignmentRow } from "../../../../api/groupAssignmentApi";

interface Props {
  enrollment: {
    studentUserId: string;
    studentEmail?: string | null;
    enrolledAt: string;
    status: string;
    isImplicit?: boolean;
  };
  consentDecisions: ConsentDecisionRow[];
  groupAssignments: CourseGroupAssignmentRow[];
}

export function StudentSummaryCard({
  enrollment,
  consentDecisions,
  groupAssignments,
}: Props) {
  return (
    <Card withBorder>
      <Stack gap="xs">
        <Text>
          <b>Email:</b> {enrollment.studentEmail || "(unknown)"}
        </Text>
        <Text size="sm" c="dimmed">
          <b>User ID:</b> {enrollment.studentUserId}
        </Text>
        <Text>
          <b>Enrolled:</b>{" "}
          {new Date(enrollment.enrolledAt).toLocaleDateString()} ({enrollment.status})
        </Text>

        <Text mt="xs" fw={600}>
          Consent
        </Text>
        {consentDecisions.length === 0 ? (
          <Text size="sm" c="dimmed">
            No consent decisions on file.
          </Text>
        ) : (
          consentDecisions.map((d) => (
            <Group key={d.consentItemId} gap="xs">
              <Badge
                color="terracotta"
                variant={d.decision === "agreed" ? "filled" : "outline"}
              >
                {d.decision}
              </Badge>
              {d.consentVersion && <Text size="sm">{d.consentVersion}</Text>}
              <Text size="sm" c="dimmed">
                {new Date(d.decidedAt).toLocaleString()}
              </Text>
            </Group>
          ))
        )}

        <Text mt="xs" fw={600}>
          Group assignment
        </Text>
        {groupAssignments.length === 0 ? (
          <Text size="sm" c="dimmed">
            No group assignment yet.
          </Text>
        ) : (
          groupAssignments.map((g) => (
            <Group key={`${g.scopeKey}-${g.studentUserId}`} gap="xs">
              <Badge color="terracotta" variant="light">
                {g.groupKey}
              </Badge>
              <Text size="sm" c="dimmed">
                scope: {g.scopeKey}
                {g.assignedAt
                  ? ` • ${new Date(g.assignedAt).toLocaleString()}`
                  : ""}
              </Text>
            </Group>
          ))
        )}
      </Stack>
    </Card>
  );
}
