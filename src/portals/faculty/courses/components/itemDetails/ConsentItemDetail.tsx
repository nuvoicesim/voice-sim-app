import { Group, Badge, Text, Stack } from "@mantine/core";
import type { ConsentDecisionRow } from "../../../../../api/consentApi";

interface Props {
  itemId: string;
  decisions: ConsentDecisionRow[];
}

export function ConsentItemDetail({ itemId, decisions }: Props) {
  const row = decisions.find((d) => d.consentItemId === itemId) || null;
  if (!row) {
    return (
      <Text size="sm" c="dimmed">
        No decision yet.
      </Text>
    );
  }
  return (
    <Stack gap={4}>
      <Group gap="xs">
        <Badge
          color="terracotta"
          variant={row.decision === "agreed" ? "filled" : "outline"}
        >
          {row.decision}
        </Badge>
        {row.consentVersion && <Text size="sm">{row.consentVersion}</Text>}
      </Group>
      <Text size="sm" c="dimmed">
        Decided at {new Date(row.decidedAt).toLocaleString()}
      </Text>
    </Stack>
  );
}
