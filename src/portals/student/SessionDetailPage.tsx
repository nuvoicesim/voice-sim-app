import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import {
  Title, Text, Paper, Stack, Badge, Center, Group, Box,
  ThemeIcon, SimpleGrid, Skeleton, Button, RingProgress,
} from '@mantine/core';
import {
  IconFileAnalytics, IconArrowLeft, IconHash, IconBook2,
  IconClipboardCheck, IconUser, IconMoodSmile, IconClock,
  IconTrophy, IconStarFilled, IconMessageCircle, IconBolt,
  IconMessages,
} from '@tabler/icons-react';
import {
  fetchSession,
  selectCurrentSession,
  selectCurrentTurns,
  selectCurrentEvaluation,
  selectSessionsLoading,
} from '../../slices/sessionSlice';
import type { AppDispatch } from '../../store';
import type { SessionTurn } from '../../slices/sessionSlice';

const MODE_CONFIG: Record<string, { color: string; icon: typeof IconBook2; label: string }> = {
  practice: { color: 'blue', icon: IconBook2, label: 'Practice' },
  assessment: { color: 'orange', icon: IconClipboardCheck, label: 'Assessment' },
};

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  active: { color: 'yellow', label: 'In Progress' },
  completed: { color: 'green', label: 'Completed' },
  abandoned: { color: 'gray', label: 'Abandoned' },
};

const PERF_COLORS: Record<string, string> = {
  excellent: 'teal',
  good: 'green',
  satisfactory: 'blue',
  'needs improvement': 'orange',
  poor: 'red',
};

function formatDateTime(dateStr: string) {
  return new Date(dateStr).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return '—';
  const sec = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${sec % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function scoreToColor(score: number): string {
  if (score >= 90) return 'teal';
  if (score >= 75) return 'green';
  if (score >= 60) return 'blue';
  if (score >= 40) return 'orange';
  return 'red';
}

function ConversationBubble({ turn }: { turn: SessionTurn }) {
  return (
    <Stack gap="sm">
      {/* User (Therapist) */}
      {turn.userText && (
        <Group justify="flex-end" align="flex-start">
          <Paper
            radius="lg"
            p="sm"
            style={{
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              maxWidth: '75%',
              borderBottomRightRadius: 4,
            }}
          >
            <Text size="sm" c="white" style={{ lineHeight: 1.6 }}>{turn.userText}</Text>
          </Paper>
          <ThemeIcon size={34} radius="xl" variant="light" color="indigo" style={{ flexShrink: 0 }}>
            <IconUser size={16} />
          </ThemeIcon>
        </Group>
      )}

      {/* Model (Patient) */}
      {turn.modelText && (
        <Group justify="flex-start" align="flex-start">
          <ThemeIcon size={34} radius="xl" variant="light" color="orange" style={{ flexShrink: 0 }}>
            <IconMoodSmile size={16} />
          </ThemeIcon>
          <Paper
            radius="lg"
            p="sm"
            style={{
              background: '#f4f5f7',
              maxWidth: '75%',
              borderBottomLeftRadius: 4,
            }}
          >
            <Text size="sm" style={{ lineHeight: 1.6 }}>{turn.modelText}</Text>
            {turn.latencyMs > 0 && (
              <Group gap={4} mt={4}>
                <IconBolt size={10} style={{ color: 'var(--mantine-color-gray-5)' }} />
                <Text size="xs" c="dimmed">{(turn.latencyMs / 1000).toFixed(1)}s</Text>
              </Group>
            )}
          </Paper>
        </Group>
      )}
    </Stack>
  );
}

function LoadingSkeleton() {
  return (
    <Stack gap="xl">
      <Group gap="md">
        <Skeleton height={36} width={36} radius="md" />
        <Box>
          <Skeleton height={22} width={240} mb={8} />
          <Skeleton height={12} width={300} />
        </Box>
      </Group>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <Paper radius="lg" p="lg" withBorder>
          <Skeleton height={18} width="40%" mb="lg" />
          <Group justify="center" mb="md">
            <Skeleton circle height={120} />
          </Group>
          <Skeleton height={14} width="60%" mb="sm" />
          <Skeleton height={14} width="80%" />
        </Paper>
        <Paper radius="lg" p="lg" withBorder>
          <Skeleton height={18} width="40%" mb="lg" />
          <Stack gap="sm">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} height={48} radius="md" />
            ))}
          </Stack>
        </Paper>
      </SimpleGrid>
      <Paper radius="lg" p="lg" withBorder>
        <Skeleton height={18} width="30%" mb="lg" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} height={60} radius="lg" mb="sm" />
        ))}
      </Paper>
    </Stack>
  );
}

export default function SessionDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const session = useSelector(selectCurrentSession);
  const turns = useSelector(selectCurrentTurns);
  const evaluation = useSelector(selectCurrentEvaluation);
  const loading = useSelector(selectSessionsLoading);

  useEffect(() => {
    if (sessionId) dispatch(fetchSession(sessionId));
  }, [sessionId, dispatch]);

  if (loading || !session) return <LoadingSkeleton />;

  const modeConf = MODE_CONFIG[session.mode] ?? MODE_CONFIG.practice;
  const statusConf = STATUS_CONFIG[session.status] ?? STATUS_CONFIG.active;
  const ModeIcon = modeConf.icon;
  const duration = formatDuration(session.startedAt, session.endedAt);
  const perfColor = evaluation
    ? PERF_COLORS[evaluation.performanceLevel.toLowerCase()] || 'gray'
    : 'gray';
  const sColor = evaluation ? scoreToColor(evaluation.totalScore) : 'gray';

  return (
    <Stack gap="xl">
      {/* ── Page header ── */}
      <Box>
        <Group gap="md" mb={4}>
          <Button
            variant="subtle" color="gray" size="xs" radius="xl" px="sm"
            leftSection={<IconArrowLeft size={14} />}
            onClick={() => navigate('/student/history')}
          >
            Back
          </Button>
        </Group>
        <Group gap="sm" mb={4}>
          <ThemeIcon size={38} radius="xl" variant="gradient" gradient={{ from: 'indigo', to: 'violet' }}>
            <IconFileAnalytics size={20} color="white" />
          </ThemeIcon>
          <Title order={2} fw={700}>Session Detail</Title>
        </Group>
        <Group gap="sm" ml={52}>
          <Group gap={4}>
            <IconHash size={12} style={{ color: 'var(--mantine-color-gray-5)' }} />
            <Text size="xs" c="dimmed">Attempt {session.attemptNo}</Text>
          </Group>
          <Badge variant="light" color={modeConf.color} size="xs" radius="xl">
            {modeConf.label}
          </Badge>
          <Badge variant="light" color={statusConf.color} size="xs" radius="xl">
            {statusConf.label}
          </Badge>
        </Group>
      </Box>

      {/* ── Evaluation + Session info ── */}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        {/* Score card */}
        <Paper
          radius="lg" p="lg" withBorder
          style={{ border: '1px solid #edf0f5' }}
        >
          <Group gap="xs" mb="lg">
            <ThemeIcon size={26} radius="xl" variant="light" color="yellow">
              <IconTrophy size={14} />
            </ThemeIcon>
            <Text fw={600} size="sm">Evaluation</Text>
          </Group>

          {evaluation ? (
            <Stack align="center" gap="md">
              <RingProgress
                size={140}
                thickness={12}
                roundCaps
                sections={[{ value: evaluation.totalScore, color: `var(--mantine-color-${sColor}-6)` }]}
                label={
                  <Stack align="center" gap={0}>
                    <Text fw={800} size="xl" c={`${sColor}.7`}>
                      {evaluation.totalScore}
                    </Text>
                    <Text size="xs" c="dimmed">/ 100</Text>
                  </Stack>
                }
              />
              <Badge variant="light" color={perfColor} size="lg" radius="xl">
                <Group gap={4}>
                  <IconStarFilled size={12} />
                  {evaluation.performanceLevel}
                </Group>
              </Badge>
              {evaluation.overallExplanation && (
                <Text size="sm" c="dimmed" ta="center" style={{ lineHeight: 1.6 }}>
                  {evaluation.overallExplanation}
                </Text>
              )}
            </Stack>
          ) : (
            <Center py="xl">
              <Stack align="center" gap="xs">
                <ThemeIcon size={44} radius="xl" variant="light" color="gray" style={{ opacity: 0.5 }}>
                  <IconTrophy size={22} />
                </ThemeIcon>
                <Text size="sm" c="dimmed">No evaluation available</Text>
              </Stack>
            </Center>
          )}
        </Paper>

        {/* Session info card */}
        <Paper
          radius="lg" p="lg" withBorder
          style={{ border: '1px solid #edf0f5' }}
        >
          <Group gap="xs" mb="lg">
            <ThemeIcon size={26} radius="xl" variant="light" color="indigo">
              <ModeIcon size={14} />
            </ThemeIcon>
            <Text fw={600} size="sm">Session Info</Text>
          </Group>

          <Stack gap="sm">
            <Paper radius="md" p="sm" style={{ background: '#f9fafb' }}>
              <Group justify="space-between">
                <Text size="xs" c="dimmed" fw={500}>Started</Text>
                <Text size="xs" fw={500}>{formatDateTime(session.startedAt)}</Text>
              </Group>
            </Paper>
            <Paper radius="md" p="sm" style={{ background: '#f9fafb' }}>
              <Group justify="space-between">
                <Text size="xs" c="dimmed" fw={500}>Ended</Text>
                <Text size="xs" fw={500}>
                  {session.endedAt ? formatDateTime(session.endedAt) : '—'}
                </Text>
              </Group>
            </Paper>
            <Paper radius="md" p="sm" style={{ background: '#f9fafb' }}>
              <Group justify="space-between">
                <Text size="xs" c="dimmed" fw={500}>Duration</Text>
                <Group gap={4}>
                  <IconClock size={12} style={{ color: 'var(--mantine-color-gray-5)' }} />
                  <Text size="xs" fw={500}>{duration}</Text>
                </Group>
              </Group>
            </Paper>
            <Paper radius="md" p="sm" style={{ background: '#f9fafb' }}>
              <Group justify="space-between">
                <Text size="xs" c="dimmed" fw={500}>Conversation Turns</Text>
                <Group gap={4}>
                  <IconMessageCircle size={12} style={{ color: 'var(--mantine-color-gray-5)' }} />
                  <Text size="xs" fw={500}>{turns.length}</Text>
                </Group>
              </Group>
            </Paper>
            {evaluation && (
              <Paper radius="md" p="sm" style={{ background: '#f9fafb' }}>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed" fw={500}>Avg Response Time</Text>
                  <Group gap={4}>
                    <IconBolt size={12} style={{ color: 'var(--mantine-color-gray-5)' }} />
                    <Text size="xs" fw={500}>{evaluation.responseTimeAvgSec.toFixed(1)}s</Text>
                  </Group>
                </Group>
              </Paper>
            )}
          </Stack>
        </Paper>
      </SimpleGrid>

      {/* ── Conversation history ── */}
      <Paper
        radius="lg" p="lg" withBorder
        style={{ border: '1px solid #edf0f5' }}
      >
        <Group gap="xs" mb="lg">
          <ThemeIcon size={26} radius="xl" variant="light" color="grape">
            <IconMessages size={14} />
          </ThemeIcon>
          <Text fw={600} size="sm">Conversation History</Text>
          {turns.length > 0 && (
            <Badge variant="light" color="gray" size="sm" radius="xl">
              {turns.length} turns
            </Badge>
          )}
        </Group>

        {turns.length === 0 ? (
          <Center py="xl">
            <Stack align="center" gap="xs">
              <ThemeIcon size={44} radius="xl" variant="light" color="gray" style={{ opacity: 0.5 }}>
                <IconMessages size={22} />
              </ThemeIcon>
              <Text size="sm" c="dimmed">No conversation turns recorded</Text>
            </Stack>
          </Center>
        ) : (
          <Stack gap="md">
            {turns.map((turn) => (
              <ConversationBubble key={turn.turnIndex} turn={turn} />
            ))}
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}
