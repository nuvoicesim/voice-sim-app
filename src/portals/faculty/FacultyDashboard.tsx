import { useEffect, useState } from 'react';
import {
  SimpleGrid, Paper, Stack, Box, Group, Skeleton,
} from '@mantine/core';
import {
  IconActivity, IconCircleCheck, IconUsers, IconPercentage,
} from '@tabler/icons-react';
import { analyticsApi } from '../../api/analyticsApi';
import { PageHeader, StatCard } from '../../components/design';

function LoadingSkeleton() {
  return (
    <Stack gap="xl">
      <Box>
        <Skeleton height={28} width="40%" mb={8} />
        <Skeleton height={14} width="55%" />
      </Box>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
        {Array.from({ length: 4 }).map((_, i) => (
          <Paper key={i} radius="lg" p="md" withBorder>
            <Group justify="space-between">
              <Box><Skeleton height={10} width={70} mb={10} /><Skeleton height={28} width={50} /></Box>
              <Skeleton circle height={42} />
            </Group>
          </Paper>
        ))}
      </SimpleGrid>
    </Stack>
  );
}

export default function FacultyDashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    analyticsApi.cohort().then(setData).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSkeleton />;

  return (
    <Stack gap="xl">
      <PageHeader
        title="Faculty Dashboard"
        subtitle="Overview of cohort performance and activity"
      />

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
        <StatCard label="Total Sessions" value={data?.totalSessions ?? 0} icon={<IconActivity size={22} />} />
        <StatCard label="Completed" value={data?.completedSessions ?? 0} icon={<IconCircleCheck size={22} />} />
        <StatCard label="Unique Students" value={data?.uniqueStudents ?? 0} icon={<IconUsers size={22} />} accent="parchment" />
        <StatCard label="Completion Rate" value={`${data?.completionRate ?? 0}%`} icon={<IconPercentage size={22} />} />
      </SimpleGrid>
    </Stack>
  );
}
