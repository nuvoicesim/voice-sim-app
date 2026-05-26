import { useState } from "react";
import {
  Card,
  Group,
  Badge,
  Text,
  Box,
  Collapse,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import type { StudentItemProgress } from "../../../../slices/studentProgressSlice";
import type { ConsentDecisionRow } from "../../../../api/consentApi";
import { progressStateBadgeProps } from "../studentProgressDisplay";
import { GenericItemDetail } from "./itemDetails/GenericItemDetail";
import { ConsentItemDetail } from "./itemDetails/ConsentItemDetail";
import { SurveyItemDetail } from "./itemDetails/SurveyItemDetail";
import { AssignmentItemDetail } from "./itemDetails/AssignmentItemDetail";
import { AIDetectionItemDetail } from "./itemDetails/AIDetectionItemDetail";

interface Props {
  item: {
    moduleItemId: string;
    itemType: string;
    title: string;
    position: number;
    payload?: { assignmentId?: string } | null;
  };
  studentUserId: string;
  courseId: string;
  progress: StudentItemProgress | null | undefined;
  consentDecisions: ConsentDecisionRow[];
}

export function StudentModuleItemRow({
  item,
  studentUserId,
  courseId,
  progress,
  consentDecisions,
}: Props) {
  const [open, setOpen] = useState(false);
  const sb = progressStateBadgeProps(progress);
  const tooltipText = progress
    ? [
        progress.unlockedAt && `unlocked ${progress.unlockedAt}`,
        progress.startedAt && `started ${progress.startedAt}`,
        progress.completedAt && `completed ${progress.completedAt}`,
      ]
        .filter(Boolean)
        .join(" • ") || "(no timestamps)"
    : "no progress row";

  return (
    <Card withBorder mb={6}>
      <UnstyledButton
        onClick={() => setOpen((o) => !o)}
        style={{ width: "100%" }}
      >
        <Group justify="space-between">
          <Group gap="xs">
            {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
            <Badge size="sm" color="parchment" variant="light">
              #{item.position + 1}
            </Badge>
            <Text fw={500}>{item.title}</Text>
            <Badge size="sm" color="parchment" variant="outline">
              {item.itemType}
            </Badge>
          </Group>
          <Tooltip label={tooltipText} withinPortal>
            <Badge color={sb.color} variant={sb.variant}>
              {sb.label}
            </Badge>
          </Tooltip>
        </Group>
      </UnstyledButton>
      <Collapse in={open}>
        <Box mt="xs">
          {open && renderBody(item, studentUserId, courseId, progress, consentDecisions)}
        </Box>
      </Collapse>
    </Card>
  );
}

function renderBody(
  item: Props["item"],
  studentUserId: string,
  courseId: string,
  progress: StudentItemProgress | null | undefined,
  consentDecisions: ConsentDecisionRow[]
) {
  switch (item.itemType) {
    case "assignment":
      return (
        <AssignmentItemDetail
          itemId={item.moduleItemId}
          studentUserId={studentUserId}
          courseId={courseId}
          assignmentId={item.payload?.assignmentId}
        />
      );
    case "survey":
    case "debrief":
      return (
        <SurveyItemDetail
          itemId={item.moduleItemId}
          studentUserId={studentUserId}
        />
      );
    case "ai_detection":
      return (
        <AIDetectionItemDetail
          itemId={item.moduleItemId}
          studentUserId={studentUserId}
        />
      );
    case "consent":
      return (
        <ConsentItemDetail
          itemId={item.moduleItemId}
          decisions={consentDecisions}
        />
      );
    case "randomizer":
      return (
        <GenericItemDetail
          progress={progress}
          note="Resulting group assignment shown in summary above."
        />
      );
    default:
      return <GenericItemDetail progress={progress} />;
  }
}
