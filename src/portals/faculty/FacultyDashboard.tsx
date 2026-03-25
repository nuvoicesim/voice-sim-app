import { useEffect, useState } from 'react';
import {
  Title, Text, SimpleGrid, Paper, Stack, Box, Group,
  ThemeIcon, Skeleton,
} from '@mantine/core';
import {
  IconSchool, IconActivity, IconCircleCheck, IconUsers, IconPercentage,
} from '@tabler/icons-react';
import { analyticsApi } from '../../api/analyticsApi';

function StatCard({
  label, value, subText, icon: Icon, color, bgGradient, borderColor,
}: {
  label: string;
  value: string | number;
  subText?: string;
  icon: typeof IconActivity;
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
      <Box>
        <Group gap="sm" mb={4}>
          <ThemeIcon size={38} radius="xl" variant="gradient" gradient={{ from: 'violet', to: 'grape' }}>
            <IconSchool size={20} color="white" />
          </ThemeIcon>
          <Title order={2} fw={700}>Faculty Dashboard</Title>
        </Group>
        <Text c="dimmed" size="sm" ml={52}>
          Overview of cohort performance and activity
        </Text>
      </Box>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
        <StatCard
          label="Total Sessions"
          value={data?.totalSessions ?? 0}
          icon={IconActivity}
          color="indigo"
          bgGradient="linear-gradient(135deg, #f0f4ff 0%, #e8ecff 100%)"
          borderColor="#dbe1ff"
        />
        <StatCard
          label="Completed"
          value={data?.completedSessions ?? 0}
          icon={IconCircleCheck}
          color="teal"
          bgGradient="linear-gradient(135deg, #f0fff4 0%, #e6ffed 100%)"
          borderColor="#c6f6d5"
        />
        <StatCard
          label="Unique Students"
          value={data?.uniqueStudents ?? 0}
          icon={IconUsers}
          color="blue"
          bgGradient="linear-gradient(135deg, #eef5ff 0%, #e0edff 100%)"
          borderColor="#c9deff"
        />
        <StatCard
          label="Completion Rate"
          value={`${data?.completionRate ?? 0}%`}
          icon={IconPercentage}
          color="orange"
          bgGradient="linear-gradient(135deg, #fff7f0 0%, #fff0e6 100%)"
          borderColor="#ffdfc4"
        />
      </SimpleGrid>
    </Stack>
  );
}
