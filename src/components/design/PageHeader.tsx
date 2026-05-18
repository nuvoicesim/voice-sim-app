import { Box, Group, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Optional extra content rendered below the title row (e.g. filter bar). */
  children?: ReactNode;
}

/**
 * Editorial page header — serif title (h1, weight 500) + optional Olive Gray
 * subtitle and right-aligned actions slot. Use at the top of every page.
 */
export default function PageHeader({ title, subtitle, actions, children }: PageHeaderProps) {
  return (
    <Box mb="xl">
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
        <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
          <Title order={1} fz={36} lh={1.2}>
            {title}
          </Title>
          {subtitle && (
            <Text size="md" c="var(--claude-olive)" lh={1.6}>
              {subtitle}
            </Text>
          )}
        </Stack>
        {actions && <Box style={{ flexShrink: 0 }}>{actions}</Box>}
      </Group>
      {children && <Box mt="lg">{children}</Box>}
    </Box>
  );
}
