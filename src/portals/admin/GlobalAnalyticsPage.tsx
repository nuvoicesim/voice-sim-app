import { useEffect, useState } from 'react';
import {
  Title, Text, SimpleGrid, Paper, Stack, Box, Group,
  ThemeIcon, Skeleton,
} from '@mantine/core';
import {
  IconChartPie, IconClipboardList, IconActivity, IconCircleCheck,
  IconUsers, IconMessage, IconMessageCheck,
} from '@tabler/icons-react';
import { analyticsApi } from '../../api/analyticsApi';

function StatCard({
  label, value, icon: Icon, color, bgGradient, borderColor,
}: {
  label: string;
  value: string | number;
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
  const [surveys, setSurveys] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      analyticsApi.platform(),
      analyticsApi.surveys(),
    ]).then(([p, s]) => {
      setPlatform(p);
      setSurveys(s);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSkeleton />;

  return (
    <Stack gap="xl">
      {/* ── Header ── */}
      <Box>
        <Group gap="sm" mb={4}>
          <ThemeIcon size={38} radius="xl" variant="gradient" gradient={{ from: 'pink', to: 'grape' }}>
            <IconChartPie size={20} color="white" />
          </ThemeIcon>
          <Title order={2} fw={700}>Global Analytics</Title>
        </Group>
        <Text c="dimmed" size="sm" ml={52}>
          Cross-cohort platform performance and reliability metrics
        </Text>
      </Box>

      {/* ── Platform metrics ── */}
      <Paper radius="lg" p="lg" withBorder style={{ border: '1px solid #edf0f5' }}>
        <Group gap="xs" mb="lg">
          <ThemeIcon size={26} radius="xl" variant="light" color="indigo">
            <IconActivity size={14} />
          </ThemeIcon>
          <Text fw={600} size="sm">Platform Metrics</Text>
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
          <StatCard
            label="Assignments"
            value={platform?.totalAssignments ?? 0}
            icon={IconClipboardList}
            color="indigo"
            bgGradient="linear-gradient(135deg, #f0f4ff 0%, #e8ecff 100%)"
            borderColor="#dbe1ff"
          />
          <StatCard
            label="Sessions"
            value={platform?.totalSessions ?? 0}
            icon={IconActivity}
            color="blue"
            bgGradient="linear-gradient(135deg, #eef5ff 0%, #e0edff 100%)"
            borderColor="#c9deff"
          />
          <StatCard
            label="Completed"
            value={platform?.completedSessions ?? 0}
            icon={IconCircleCheck}
            color="teal"
            bgGradient="linear-gradient(135deg, #f0fff4 0%, #e6ffed 100%)"
            borderColor="#c6f6d5"
          />
          <StatCard
            label="Students"
            value={platform?.uniqueStudents ?? 0}
            icon={IconUsers}
            color="violet"
            bgGradient="linear-gradient(135deg, #f5f0ff 0%, #ede5ff 100%)"
            borderColor="#ddd0ff"
          />
        </SimpleGrid>
      </Paper>

      {/* ── Survey metrics ── */}
      <Paper radius="lg" p="lg" withBorder style={{ border: '1px solid #edf0f5' }}>
        <Group gap="xs" mb="lg">
          <ThemeIcon size={26} radius="xl" variant="light" color="orange">
            <IconMessage size={14} />
          </ThemeIcon>
          <Text fw={600} size="sm">Survey Metrics</Text>
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <StatCard
            label="Responses"
            value={surveys?.totalResponses ?? 0}
            icon={IconMessage}
            color="orange"
            bgGradient="linear-gradient(135deg, #fff7f0 0%, #fff0e6 100%)"
            borderColor="#ffdfc4"
          />
          <StatCard
            label="Completed Surveys"
            value={surveys?.completedResponses ?? 0}
            icon={IconMessageCheck}
            color="green"
            bgGradient="linear-gradient(135deg, #f0fff4 0%, #e6ffed 100%)"
            borderColor="#c6f6d5"
          />
        </SimpleGrid>
      </Paper>
    </Stack>
  );
}
