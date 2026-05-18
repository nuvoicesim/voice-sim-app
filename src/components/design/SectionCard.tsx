import { Box, Paper, Stack, Title } from '@mantine/core';
import type { CSSProperties, ReactNode } from 'react';

interface SectionCardProps {
  title?: ReactNode;
  /** Right-aligned actions in the title row. */
  actions?: ReactNode;
  /** Body content. */
  children: ReactNode;
  /** Optional padding override (Mantine spacing key). */
  p?: string | number;
  /** Inline style override for edge cases. */
  style?: CSSProperties;
  /** When true, removes border so the card blends with the page. */
  borderless?: boolean;
  /** When true, drops the whisper shadow. */
  flat?: boolean;
}

/**
 * Ivory surface with cream border and whisper shadow — the workhorse content
 * container. Optional serif sub-title slot. Replaces ad-hoc <Paper withBorder>.
 */
export default function SectionCard({
  title,
  actions,
  children,
  p = 'lg',
  style,
  borderless,
  flat,
}: SectionCardProps) {
  return (
    <Paper
      p={p}
      radius="lg"
      style={{
        background: 'var(--claude-ivory)',
        border: borderless ? 'none' : '1px solid var(--claude-border-cream)',
        boxShadow: flat ? 'none' : 'var(--claude-shadow-whisper)',
        ...style,
      }}
    >
      {(title || actions) && (
        <Box mb="md" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          {title && (
            <Title order={3} fz={20.8} lh={1.2}>
              {title}
            </Title>
          )}
          {actions && <Box style={{ flexShrink: 0 }}>{actions}</Box>}
        </Box>
      )}
      <Stack gap="md">{children}</Stack>
    </Paper>
  );
}
