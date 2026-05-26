import { Group, Paper, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconBolt, IconClock, IconMoodSmile, IconUser } from '@tabler/icons-react';
import type { SessionTurn } from '../../../slices/sessionSlice';
import { formatSpeechDuration, formatSpeechStartTime } from './formatters';

export function ConversationBubble({ turn }: { turn: SessionTurn }) {
  const studentSpeechStartAt = turn.userSpeechStartAt;
  const patientSpeechStartAt = turn.patientSpeechStartAt;
  const studentSpeechDuration = formatSpeechDuration(turn.userSpeechDurationMs);
  const patientSpeechDuration = formatSpeechDuration(turn.patientSpeechDurationMs);

  return (
    <Stack gap="sm">
      {turn.userText && (
        <Group justify="flex-end" align="flex-start">
          <Stack gap={4} align="flex-end" style={{ maxWidth: '75%' }}>
            {studentSpeechStartAt && (
              <Group gap={4} justify="flex-end" wrap="nowrap">
                <IconClock size={10} style={{ color: 'var(--claude-stone)' }} />
                <Text size="xs" c="var(--claude-olive)">
                  {formatSpeechStartTime(studentSpeechStartAt)}
                </Text>
              </Group>
            )}
            <Paper
              radius="lg"
              p="sm"
              style={{
                background: 'var(--claude-terracotta)',
                borderBottomRightRadius: 4,
              }}
            >
              <Text size="sm" c="var(--claude-near-black)" style={{ lineHeight: 1.6 }}>{turn.userText}</Text>
              {studentSpeechDuration && (
                <Group gap={4} mt={4} justify="flex-end" wrap="nowrap">
                  <IconBolt size={10} style={{ color: 'rgba(250,249,245,0.85)' }} />
                  <Text size="xs" style={{ color: 'rgba(250,249,245,0.85)' }}>
                    {studentSpeechDuration}
                  </Text>
                </Group>
              )}
            </Paper>
          </Stack>
          <ThemeIcon size={34} radius="md" variant="light" color="terracotta" style={{ flexShrink: 0 }}>
            <IconUser size={16} />
          </ThemeIcon>
        </Group>
      )}

      {turn.modelText && (
        <Group justify="flex-start" align="flex-start">
          <ThemeIcon size={34} radius="md" variant="light" color="parchment" style={{ flexShrink: 0 }}>
            <IconMoodSmile size={16} />
          </ThemeIcon>
          <Stack gap={4} align="flex-start" style={{ maxWidth: '75%' }}>
            {patientSpeechStartAt && (
              <Group gap={4} wrap="nowrap">
                <IconClock size={10} style={{ color: 'var(--claude-stone)' }} />
                <Text size="xs" c="var(--claude-olive)">
                  {formatSpeechStartTime(patientSpeechStartAt)}
                </Text>
              </Group>
            )}
            <Paper
              radius="lg"
              p="sm"
              style={{
                background: 'var(--claude-border-cream)',
                borderBottomLeftRadius: 4,
              }}
            >
              <Text size="sm" c="var(--claude-near-black)" style={{ lineHeight: 1.6 }}>{turn.modelText}</Text>
              {patientSpeechDuration && (
                <Group gap={4} mt={4} wrap="nowrap">
                  <IconBolt size={10} style={{ color: 'var(--claude-stone)' }} />
                  <Text size="xs" c="var(--claude-olive)">
                    {patientSpeechDuration}
                  </Text>
                </Group>
              )}
            </Paper>
          </Stack>
        </Group>
      )}
    </Stack>
  );
}
