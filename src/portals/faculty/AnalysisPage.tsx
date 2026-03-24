import { useEffect, useState } from 'react';
import {
  Title, Text, Stack, SimpleGrid, Paper, Box, Group,
  ThemeIcon, Skeleton, RingProgress, Center,
} from '@mantine/core';
import {
  IconChartBar, IconFilter, IconMessage, IconMessageCheck,
  IconActivity, IconCircleCheck,
} from '@tabler/icons-react';
import { analyticsApi } from '../../api/analyticsApi';

function LoadingSkeleton() {
  return (
    <Stack gap="xl">
      <Box>
        <Skeleton height={28} width="30%" mb={8} />
        <Skeleton height={14} width="50%" />
      </Box>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
        {Array.from({ length: 2 }).map((_, i) => (
          <Paper key={i} radius="lg" p="lg" withBorder>
            <Skeleton height={16} width="40%" mb="lg" />
            <Center><Skeleton circle height={120} /></Center>
            <Skeleton height={12} width="60%" mt="lg" />
          </Paper>
        ))}
      </SimpleGrid>
    </Stack>
  );
}

export default function AnalysisPage() {
  const [cohortData, setCohortData] = useState<any>(null);
  const [surveyData, setSurveyData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      analyticsApi.cohort(),
      analyticsApi.surveys(),
    ]).then(([cohort, surveys]) => {
      setCohortData(cohort);
      setSurveyData(surveys);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSkeleton />;

  const total = cohortData?.totalSessions ?? 0;
  const completed = cohortData?.completedSessions ?? 0;
  const completionRate = cohortData?.completionRate ?? 0;

  const surveyTotal = surveyData?.totalResponses ?? 0;
  const surveyCompleted = surveyData?.completedResponses ?? 0;
  const surveyRate = surveyTotal > 0 ? Math.round((surveyCompleted / surveyTotal) * 100) : 0;

  return (
    <Stack gap="xl">
      {/* ── Header ── */}
      <Box>
        <Group gap="sm" mb={4}>
          <ThemeIcon size={38} radius="xl" variant="gradient" gradient={{ from: 'grape', to: 'violet' }}>
            <IconChartBar size={20} color="white" />
          </ThemeIcon>
          <Title order={2} fw={700}>Analysis</Title>
        </Group>
        <Text c="dimmed" size="sm" ml={52}>
          Cohort performance analysis and insights
        </Text>
      </Box>

      {/* ── Cards ── */}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        {/* Completion Funnel */}
        <Paper radius="lg" p="lg" withBorder style={{ border: '1px solid #edf0f5' }}>
          <Group gap="xs" mb="lg">
            <ThemeIcon size={26} radius="xl" variant="light" color="indigo">
              <IconFilter size={14} />
            </ThemeIcon>
            <Text fw={600} size="sm">Completion Funnel</Text>
          </Group>

          <Stack align="center" gap="md">
            <RingProgress
              size={140}
              thickness={14}
              roundCaps
              sections={[{ value: completionRate, color: 'var(--mantine-color-indigo-6)' }]}
              label={
                <Stack align="center" gap={0}>
                  <Text fw={800} size="xl" c="indigo.7">{completionRate}%</Text>
                  <Text size="xs" c="dimmed">Rate</Text>
                </Stack>
              }
            />
            <SimpleGrid cols={2} spacing="md" style={{ width: '100%' }}>
              <Paper radius="md" p="sm" style={{ background: '#f8f9fb', textAlign: 'center' }}>
                <Group gap={4} justify="center" mb={2}>
                  <IconActivity size={13} style={{ color: 'var(--mantine-color-blue-5)' }} />
                  <Text size="xs" c="dimmed" fw={500}>Total</Text>
                </Group>
                <Text fw={700} size="lg" c="blue.7">{total}</Text>
              </Paper>
              <Paper radius="md" p="sm" style={{ background: '#f8f9fb', textAlign: 'center' }}>
                <Group gap={4} justify="center" mb={2}>
                  <IconCircleCheck size={13} style={{ color: 'var(--mantine-color-teal-5)' }} />
                  <Text size="xs" c="dimmed" fw={500}>Completed</Text>
                </Group>
                <Text fw={700} size="lg" c="teal.7">{completed}</Text>
              </Paper>
            </SimpleGrid>
          </Stack>
        </Paper>

        {/* Survey Participation */}
        <Paper radius="lg" p="lg" withBorder style={{ border: '1px solid #edf0f5' }}>
          <Group gap="xs" mb="lg">
            <ThemeIcon size={26} radius="xl" variant="light" color="orange">
              <IconMessage size={14} />
            </ThemeIcon>
            <Text fw={600} size="sm">Survey Participation</Text>
          </Group>

          <Stack align="center" gap="md">
            <RingProgress
              size={140}
              thickness={14}
              roundCaps
              sections={[{ value: surveyRate, color: 'var(--mantine-color-orange-6)' }]}
              label={
                <Stack align="center" gap={0}>
                  <Text fw={800} size="xl" c="orange.7">{surveyRate}%</Text>
                  <Text size="xs" c="dimmed">Rate</Text>
                </Stack>
              }
            />
            <SimpleGrid cols={2} spacing="md" style={{ width: '100%' }}>
              <Paper radius="md" p="sm" style={{ background: '#f8f9fb', textAlign: 'center' }}>
                <Group gap={4} justify="center" mb={2}>
                  <IconMessage size={13} style={{ color: 'var(--mantine-color-orange-5)' }} />
                  <Text size="xs" c="dimmed" fw={500}>Responses</Text>
                </Group>
                <Text fw={700} size="lg" c="orange.7">{surveyTotal}</Text>
              </Paper>
              <Paper radius="md" p="sm" style={{ background: '#f8f9fb', textAlign: 'center' }}>
                <Group gap={4} justify="center" mb={2}>
                  <IconMessageCheck size={13} style={{ color: 'var(--mantine-color-green-5)' }} />
                  <Text size="xs" c="dimmed" fw={500}>Completed</Text>
                </Group>
                <Text fw={700} size="lg" c="green.7">{surveyCompleted}</Text>
              </Paper>
            </SimpleGrid>
          </Stack>
        </Paper>
      </SimpleGrid>
    </Stack>
  );
}
