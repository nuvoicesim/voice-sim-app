import { useEffect, useState } from 'react';
import {
  Title, Text, SimpleGrid, Paper, Stack, Box, Group,
  ThemeIcon, Skeleton,
} from '@mantine/core';
import {
  IconShieldCheck, IconUsers, IconClipboardList, IconActivity,
} from '@tabler/icons-react';
import { analyticsApi } from '../../api/analyticsApi';

function StatCard({
  label, value, subText, icon: Icon, color, bgGradient, borderColor,
}: {
  label: string;
  value: string | number;
  subText?: string;
  icon: typeof IconUsers;
  color: string;
  bgGradient: string;
  borderColor: string;
}) {
  return (
    <Paper radius="lg" p="md" style={{ background: bgGradient, border: `1px solid ${borderColor}` }}>
      <Group justify="space-between" align="center">
        <Box>
          <Text size="xs" c="dimmed" fw={600} style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
            {label}
          </Text>
          <Title order={2} c={`${color}.7`} mt={2}>{value}</Title>
          {subText && <Text size="xs" c="dimmed" mt={2}>{subText}</Text>}
        </Box>
        <ThemeIcon size={42} radius="xl" variant="light" color={color}>
          <Icon size={22} />
        </ThemeIcon>
      </Group>
    </Paper>
  );
}

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
      <Box>
        <Group gap="sm" mb={4}>
          <ThemeIcon size={38} radius="xl" variant="gradient" gradient={{ from: 'red', to: 'pink' }}>
            <IconShieldCheck size={20} color="white" />
          </ThemeIcon>
          <Title order={2} fw={700}>Admin Dashboard</Title>
        </Group>
        <Text c="dimmed" size="sm" ml={52}>
          Platform-wide overview and health metrics
        </Text>
      </Box>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
        <StatCard
          label="Unique Students"
          value={data?.uniqueStudents ?? 0}
          icon={IconUsers}
          color="blue"
          bgGradient="linear-gradient(135deg, #eef5ff 0%, #e0edff 100%)"
          borderColor="#c9deff"
        />
        <StatCard
          label="Total Assignments"
          value={data?.totalAssignments ?? 0}
          subText={`${data?.publishedAssignments ?? 0} published`}
          icon={IconClipboardList}
          color="violet"
          bgGradient="linear-gradient(135deg, #f5f0ff 0%, #ede5ff 100%)"
          borderColor="#ddd0ff"
        />
        <StatCard
          label="Total Sessions"
          value={data?.totalSessions ?? 0}
          subText={`${data?.completedSessions ?? 0} completed`}
          icon={IconActivity}
          color="teal"
          bgGradient="linear-gradient(135deg, #f0fff4 0%, #e6ffed 100%)"
          borderColor="#c6f6d5"
        />
      </SimpleGrid>
    </Stack>
  );
}
