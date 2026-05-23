import { useEffect, useState } from 'react';
import {
  SimpleGrid, Paper, Stack, Box, Group, Skeleton,
} from '@mantine/core';
import {
  IconUsers, IconClipboardList, IconActivity,
} from '@tabler/icons-react';
import { analyticsApi } from '../../api/analyticsApi';
import { PageHeader, StatCard } from '../../components/design';

function LoadingSkeleton() {
  return (
    <Stack gap="xl">
      <Box>
        <Skeleton height={28} width="35%" mb={8} />
        <Skeleton height={14} width="50%" />
      </Box>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
        {Array.from({ length: 3 }).map((_, i) => (
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

export default function AdminDashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    analyticsApi.platform().then(setData).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSkeleton />;

  return (
    <Stack gap="xl">
      <PageHeader
        title="Admin Dashboard"
        subtitle="Platform-wide overview and health metrics"
      />

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
        <StatCard
          label="Unique Students"
          value={data?.uniqueStudents ?? 0}
          icon={<IconUsers size={22} />}
          accent="parchment"
        />
        <StatCard
          label="Total Assignments"
          value={data?.totalAssignments ?? 0}
          hint={`${data?.publishedAssignments ?? 0} published`}
          icon={<IconClipboardList size={22} />}
        />
        <StatCard
          label="Total Sessions"
          value={data?.totalSessions ?? 0}
          hint={`${data?.completedSessions ?? 0} completed`}
          icon={<IconActivity size={22} />}
        />
      </SimpleGrid>
    </Stack>
  );
}
