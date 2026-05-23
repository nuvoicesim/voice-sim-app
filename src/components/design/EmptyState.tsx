import { Button, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  ctaLabel?: string;
  onCta?: () => void;
}

/**
 * Centered empty state — Olive Gray copy with optional terracotta CTA.
 */
export default function EmptyState({ icon, title, description, ctaLabel, onCta }: EmptyStateProps) {
  return (
    <Stack align="center" gap="md" py="xl" px="md" style={{ textAlign: 'center' }}>
      {icon && (
        <ThemeIcon size={56} radius="lg" variant="light" color="terracotta">
          {icon}
        </ThemeIcon>
      )}
      <Title order={3} fz={20.8} lh={1.2}>
        {title}
      </Title>
      {description && (
        <Text c="var(--claude-olive)" size="md" maw={420} lh={1.6}>
          {description}
        </Text>
      )}
      {ctaLabel && onCta && (
        <Button color="terracotta" radius="lg" mt="sm" onClick={onCta}>
          {ctaLabel}
        </Button>
      )}
    </Stack>
  );
}
