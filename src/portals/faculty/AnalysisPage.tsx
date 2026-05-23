import { useEffect, useState } from 'react';
import {
  Text, Stack, SimpleGrid, Paper, Box, Group,
  ThemeIcon, Skeleton, RingProgress, Center,
} from '@mantine/core';
import {
  IconFilter, IconActivity, IconCircleCheck,
} from '@tabler/icons-react';
import { analyticsApi } from '../../api/analyticsApi';
import { PageHeader, SectionCard } from '../../components/design';

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    analyticsApi.cohort()
      .then((cohort) => {
        setCohortData(cohort);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSkeleton />;

  const total = cohortData?.totalSessions ?? 0;
  const completed = cohortData?.completedSessions ?? 0;
  const completionRate = cohortData?.completionRate ?? 0;

  return (
    <Stack gap="xl">
      <PageHeader
        title="Analysis"
        subtitle="Cohort performance analysis and insights"
      />

      <SimpleGrid cols={1} spacing="lg">
        <SectionCard
          title={
            <Group gap="xs">
              <ThemeIcon size={26} radius="md" variant="light" color="terracotta">
                <IconFilter size={14} />
              </ThemeIcon>
              <Text fw={500} size="md" c="var(--claude-near-black)">Completion Funnel</Text>
            </Group>
          }
        >
          <Stack align="center" gap="md">
            <RingProgress
              size={140}
              thickness={14}
              roundCaps
              sections={[{ value: completionRate, color: 'var(--claude-terracotta)' }]}
              label={
                <Stack align="center" gap={0}>
                  <Text fw={500} size="xl" c="var(--claude-near-black)" style={{ fontFamily: 'Georgia, serif' }}>
                    {completionRate}%
                  </Text>
                  <Text size="xs" c="var(--claude-stone)">Rate</Text>
                </Stack>
              }
            />
            <SimpleGrid cols={2} spacing="md" style={{ width: '100%' }}>
              <Paper radius="md" p="sm" style={{ background: 'var(--claude-parchment)', textAlign: 'center' }}>
                <Group gap={4} justify="center" mb={2}>
                  <IconActivity size={13} style={{ color: 'var(--claude-stone)' }} />
                  <Text size="xs" c="var(--claude-olive)" fw={500}>Total</Text>
                </Group>
                <Text fw={500} size="lg" c="var(--claude-near-black)" style={{ fontFamily: 'Georgia, serif' }}>{total}</Text>
              </Paper>
              <Paper radius="md" p="sm" style={{ background: 'var(--claude-parchment)', textAlign: 'center' }}>
                <Group gap={4} justify="center" mb={2}>
                  <IconCircleCheck size={13} style={{ color: 'var(--claude-terracotta)' }} />
                  <Text size="xs" c="var(--claude-olive)" fw={500}>Completed</Text>
                </Group>
                <Text fw={500} size="lg" c="var(--claude-terracotta)" style={{ fontFamily: 'Georgia, serif' }}>{completed}</Text>
              </Paper>
            </SimpleGrid>
          </Stack>
        </SectionCard>
      </SimpleGrid>
    </Stack>
  );
}
