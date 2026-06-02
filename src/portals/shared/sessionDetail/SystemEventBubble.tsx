import { Badge, Group, Paper, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconBolt, IconClock } from "@tabler/icons-react";
import type { CueSupportAccessEvent } from "./cueEvents";
import { formatCueEventLabel } from "./cueEvents";
import { formatSpeechStartTime } from "./formatters";

/**
 * Faculty-facing system-event row for a Cue Support Access event.
 *
 * Visually distinct from ConversationBubble (centered, neutral parchment
 * background, "System Event" tag) so reviewers don't confuse it with a
 * student or patient utterance. Never labels the click as actual cue use.
 */
export function SystemEventBubble({ event }: { event: CueSupportAccessEvent }) {
  return (
    <Group justify="center" align="flex-start">
      <Stack gap={4} align="center" style={{ maxWidth: "85%" }}>
        {event.timestamp && (
          <Group gap={4} wrap="nowrap">
            <IconClock size={10} style={{ color: "var(--claude-stone)" }} />
            <Text size="xs" c="var(--claude-olive)">
              {formatSpeechStartTime(event.timestamp)}
            </Text>
          </Group>
        )}
        <Paper
          radius="lg"
          p="sm"
          withBorder
          style={{
            background: "var(--claude-parchment)",
            borderColor: "var(--claude-border-cream)",
          }}
        >
          <Group gap={6} wrap="nowrap" mb={4} justify="center">
            <ThemeIcon
              size={20}
              radius="md"
              variant="light"
              color="parchment"
            >
              <IconBolt size={12} />
            </ThemeIcon>
            <Badge color="parchment" variant="light" size="xs" radius="xl">
              System Event
            </Badge>
            <Badge color="parchment" variant="outline" size="xs" radius="xl">
              Cue Support Access
            </Badge>
          </Group>
          <Text
            size="sm"
            ta="center"
            c="var(--claude-near-black)"
            style={{ lineHeight: 1.6 }}
          >
            {formatCueEventLabel(event)}
          </Text>
          {(event.sectionId || event.taskId || event.itemId) && (
            <Text
              size="xs"
              ta="center"
              c="var(--claude-stone)"
              mt={4}
            >
              {[event.sectionId, event.taskId, event.itemId]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          )}
        </Paper>
      </Stack>
    </Group>
  );
}
