import { Group, Paper, Stack, Text, ThemeIcon } from '@mantine/core';
import type { ReactNode } from 'react';

interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  /** Mantine color name used for the icon tile (defaults to terracotta). */
  accent?: string;
  hint?: ReactNode;
}

/**
 * Ivory stat card with terracotta-tinted icon, ring border, and whisper shadow.
 * Replaces the per-page inline StatCard duplicated across dashboards.
 */
export default function StatCard({ label, value, icon, accent = 'terracotta', hint }: StatCardProps) {
  return (
    <Paper
      p="lg"
      radius="lg"
      style={{
        background: 'var(--claude-ivory)',
        border: '1px solid var(--claude-border-cream)',
        boxShadow: 'var(--claude-shadow-whisper)',
      }}
    >
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
          <Text size="xs" fw={500} c="var(--claude-stone)" tt="uppercase" style={{ letterSpacing: 0.5 }}>
            {label}
          </Text>
          <Text
            fw={500}
            c="var(--claude-near-black)"
            style={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: '2rem',
              lineHeight: 1.1,
            }}
          >
            {value}
          </Text>
          {hint && (
            <Text size="sm" c="var(--claude-olive)" mt={4}>
              {hint}
            </Text>
          )}
        </Stack>
        {icon && (
          <ThemeIcon size={44} radius="md" variant="light" color={accent}>
            {icon}
          </ThemeIcon>
        )}
      </Group>
    </Paper>
  );
}
