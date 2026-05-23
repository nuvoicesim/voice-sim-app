import { useEffect, useState } from 'react';
import {
  Text, SimpleGrid, Paper, Stack, Box, Group, ThemeIcon, Skeleton,
} from '@mantine/core';
import {
  IconClipboardList, IconActivity, IconCircleCheck, IconUsers,
} from '@tabler/icons-react';
import { analyticsApi } from '../../api/analyticsApi';
import { PageHeader, StatCard, SectionCard } from '../../components/design';

function LoadingSkeleton() {
  return (
    <Stack gap="xl">
      <Box>
        <Skeleton height={28} width="35%" mb={8} />
        <Skeleton height={14} width="55%" />
      </Box>
      {Array.from({ length: 2 }).map((_, i) => (
        <Paper key={i} radius="lg" p="lg" withBorder>
          <Skeleton height={16} width="30%" mb="lg" />
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
            {Array.from({ length: 3 }).map((_, j) => (
              <Paper key={j} radius="lg" p="md" withBorder>
                <Group justify="space-between">
                  <Box><Skeleton height={10} width={70} mb={10} /><Skeleton height={28} width={50} /></Box>
                  <Skeleton circle height={42} />
                </Group>
              </Paper>
            ))}
          </SimpleGrid>
        </Paper>
      ))}
    </Stack>
  );
}

export default function GlobalAnalyticsPage() {
  const [platform, setPlatform] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    analyticsApi.platform()
      .then((p) => { setPlatform(p); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSkeleton />;

  return (
    <Stack gap="xl">
      <PageHeader
        title="Global Analytics"
        subtitle="Cross-cohort platform performance and reliability metrics"
      />

      <SectionCard
        title={
          <Group gap="xs">
            <ThemeIcon size={26} radius="md" variant="light" color="terracotta">
              <IconActivity size={14} />
            </ThemeIcon>
            <Text fw={500} size="md" c="var(--claude-near-black)">Platform Metrics</Text>
          </Group>
        }
      >
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
          <StatCard label="Assignments" value={platform?.totalAssignments ?? 0} icon={<IconClipboardList size={22} />} />
          <StatCard label="Sessions" value={platform?.totalSessions ?? 0} icon={<IconActivity size={22} />} accent="parchment" />
          <StatCard label="Completed" value={platform?.completedSessions ?? 0} icon={<IconCircleCheck size={22} />} />
          <StatCard label="Students" value={platform?.uniqueStudents ?? 0} icon={<IconUsers size={22} />} accent="parchment" />
        </SimpleGrid>
      </SectionCard>
    </Stack>
  );
}
