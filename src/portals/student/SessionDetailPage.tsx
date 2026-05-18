import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import {
  Text, Paper, Stack, Badge, Center, Group, Box,
  ThemeIcon, SimpleGrid, Skeleton, Button,
} from '@mantine/core';
import {
  IconArrowLeft, IconHash, IconBook2,
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
import { PageHeader, SectionCard } from '../../components/design';

const MODE_CONFIG: Record<string, { color: string; icon: typeof IconBook2; label: string }> = {
  practice: { color: 'parchment', icon: IconBook2, label: 'Practice' },
  assessment: { color: 'terracotta', icon: IconClipboardCheck, label: 'Assessment' },
};

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  active: { color: 'terracotta', label: 'In Progress' },
  completed: { color: 'terracotta', label: 'Completed' },
  abandoned: { color: 'parchment', label: 'Abandoned' },
};

// All performance levels collapse to terracotta (high) or parchment (low)
const PERF_COLORS: Record<string, string> = {
  excellent: 'terracotta',
  good: 'terracotta',
  satisfactory: 'parchment',
  'needs improvement': 'parchment',
  poor: 'parchment',
};

function formatDateTime(dateStr: string) {
  return new Date(dateStr).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatSpeechStartTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatSpeechDuration(durationMs?: number) {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
    return null;
  }
  const totalSeconds = durationMs / 1000;
  if (totalSeconds < 1) return `${totalSeconds.toFixed(2)}s`;
  if (totalSeconds < 10) return `${totalSeconds.toFixed(1)}s`;
  if (totalSeconds < 60) return `${Math.round(totalSeconds)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${seconds}s`;
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return '—';
  const sec = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${sec % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function ConversationBubble({ turn }: { turn: SessionTurn }) {
  const studentSpeechStartAt = turn.userSpeechStartAt;
  const patientSpeechStartAt = turn.patientSpeechStartAt;
  const studentSpeechDuration = formatSpeechDuration(turn.userSpeechDurationMs);
  const patientSpeechDuration = formatSpeechDuration(turn.patientSpeechDurationMs);

  return (
    <Stack gap="sm">
      {turn.userText && (
        <Group justify="flex-end" align="flex-start">
          <Stack gap={4} align="flex-end" style={{ maxWidth: '75%' }}>
            {studentSpeechStartAt && (
              <Group gap={4} justify="flex-end" wrap="nowrap">
                <IconClock size={10} style={{ color: 'var(--claude-stone)' }} />
                <Text size="xs" c="var(--claude-olive)">
                  {formatSpeechStartTime(studentSpeechStartAt)}
                </Text>
              </Group>
            )}
            <Paper
              radius="lg"
              p="sm"
              style={{
                background: 'var(--claude-terracotta)',
                borderBottomRightRadius: 4,
              }}
            >
              <Text size="sm" c="var(--claude-ivory)" style={{ lineHeight: 1.6 }}>{turn.userText}</Text>
              {studentSpeechDuration && (
                <Group gap={4} mt={4} justify="flex-end" wrap="nowrap">
                  <IconBolt size={10} style={{ color: 'rgba(250,249,245,0.85)' }} />
                  <Text size="xs" style={{ color: 'rgba(250,249,245,0.85)' }}>
                    {studentSpeechDuration}
                  </Text>
                </Group>
              )}
            </Paper>
          </Stack>
          <ThemeIcon size={34} radius="md" variant="light" color="terracotta" style={{ flexShrink: 0 }}>
            <IconUser size={16} />
          </ThemeIcon>
        </Group>
      )}

      {turn.modelText && (
        <Group justify="flex-start" align="flex-start">
          <ThemeIcon size={34} radius="md" variant="light" color="parchment" style={{ flexShrink: 0 }}>
            <IconMoodSmile size={16} />
          </ThemeIcon>
          <Stack gap={4} align="flex-start" style={{ maxWidth: '75%' }}>
            {patientSpeechStartAt && (
              <Group gap={4} wrap="nowrap">
                <IconClock size={10} style={{ color: 'var(--claude-stone)' }} />
                <Text size="xs" c="var(--claude-olive)">
                  {formatSpeechStartTime(patientSpeechStartAt)}
                </Text>
              </Group>
            )}
            <Paper
              radius="lg"
              p="sm"
              style={{
                background: 'var(--claude-border-cream)',
                borderBottomLeftRadius: 4,
              }}
            >
              <Text size="sm" c="var(--claude-near-black)" style={{ lineHeight: 1.6 }}>{turn.modelText}</Text>
              {patientSpeechDuration && (
                <Group gap={4} mt={4} wrap="nowrap">
                  <IconBolt size={10} style={{ color: 'var(--claude-stone)' }} />
                  <Text size="xs" c="var(--claude-olive)">
                    {patientSpeechDuration}
                  </Text>
                </Group>
              )}
            </Paper>
          </Stack>
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
    ? PERF_COLORS[evaluation.performanceLevel.toLowerCase()] || 'parchment'
    : 'parchment';

  return (
    <Stack gap="xl">
      <Box>
        <Button
          variant="subtle" color="parchment" size="xs" radius="xl" px="sm" mb="md"
          leftSection={<IconArrowLeft size={14} />}
          onClick={() => navigate('/student/history')}
        >
          Back
        </Button>
        <PageHeader title="Session Detail">
          <Group gap="sm">
            <Group gap={4}>
              <IconHash size={12} style={{ color: 'var(--claude-stone)' }} />
              <Text size="xs" c="var(--claude-olive)">Attempt {session.attemptNo}</Text>
            </Group>
            <Badge variant="light" color={modeConf.color} size="xs" radius="xl">
              {modeConf.label}
            </Badge>
            <Badge variant="light" color={statusConf.color} size="xs" radius="xl">
              {statusConf.label}
            </Badge>
          </Group>
        </PageHeader>
      </Box>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <SectionCard
          title={
            <Group gap="xs">
              <ThemeIcon size={26} radius="md" variant="light" color="terracotta">
                <IconTrophy size={14} />
              </ThemeIcon>
              <Text fw={500} size="md" c="var(--claude-near-black)">Evaluation</Text>
            </Group>
          }
        >
          {evaluation ? (
            <Stack align="center" gap="md">
              <ThemeIcon size={54} radius="lg" variant="light" color={perfColor}>
                <IconTrophy size={26} />
              </ThemeIcon>
              <Badge variant="light" color={perfColor} size="lg" radius="xl">
                <Group gap={4}>
                  <IconStarFilled size={12} />
                  {evaluation.performanceLevel}
                </Group>
              </Badge>
              {evaluation.overallExplanation && (
                <Paper
                  radius="md"
                  p="md"
                  style={{
                    width: '100%',
                    background: 'var(--claude-parchment)',
                    border: '1px solid var(--claude-border-cream)',
                  }}
                >
                  <Text size="sm" c="var(--claude-olive)" ta="left" style={{ lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                    {evaluation.overallExplanation}
                  </Text>
                </Paper>
              )}
            </Stack>
          ) : (
            <Center py="xl">
              <Stack align="center" gap="xs">
                <ThemeIcon size={44} radius="lg" variant="light" color="parchment">
                  <IconTrophy size={22} />
                </ThemeIcon>
                <Text size="sm" c="var(--claude-stone)">No evaluation available</Text>
              </Stack>
            </Center>
          )}
        </SectionCard>

        <SectionCard
          title={
            <Group gap="xs">
              <ThemeIcon size={26} radius="md" variant="light" color="terracotta">
                <ModeIcon size={14} />
              </ThemeIcon>
              <Text fw={500} size="md" c="var(--claude-near-black)">Session Info</Text>
            </Group>
          }
        >
          <Stack gap="sm">
            <Paper radius="md" p="sm" style={{ background: 'var(--claude-parchment)' }}>
              <Group justify="space-between">
                <Text size="xs" c="var(--claude-olive)" fw={500}>Started</Text>
                <Text size="xs" fw={500} c="var(--claude-near-black)">{formatDateTime(session.startedAt)}</Text>
              </Group>
            </Paper>
            <Paper radius="md" p="sm" style={{ background: 'var(--claude-parchment)' }}>
              <Group justify="space-between">
                <Text size="xs" c="var(--claude-olive)" fw={500}>Ended</Text>
                <Text size="xs" fw={500} c="var(--claude-near-black)">
                  {session.endedAt ? formatDateTime(session.endedAt) : '—'}
                </Text>
              </Group>
            </Paper>
            <Paper radius="md" p="sm" style={{ background: 'var(--claude-parchment)' }}>
              <Group justify="space-between">
                <Text size="xs" c="var(--claude-olive)" fw={500}>Duration</Text>
                <Group gap={4}>
                  <IconClock size={12} style={{ color: 'var(--claude-stone)' }} />
                  <Text size="xs" fw={500} c="var(--claude-near-black)">{duration}</Text>
                </Group>
              </Group>
            </Paper>
            <Paper radius="md" p="sm" style={{ background: 'var(--claude-parchment)' }}>
              <Group justify="space-between">
                <Text size="xs" c="var(--claude-olive)" fw={500}>Conversation Turns</Text>
                <Group gap={4}>
                  <IconMessageCircle size={12} style={{ color: 'var(--claude-stone)' }} />
                  <Text size="xs" fw={500} c="var(--claude-near-black)">{turns.length}</Text>
                </Group>
              </Group>
            </Paper>
          </Stack>
        </SectionCard>
      </SimpleGrid>

      <SectionCard
        title={
          <Group gap="xs">
            <ThemeIcon size={26} radius="md" variant="light" color="terracotta">
              <IconMessages size={14} />
            </ThemeIcon>
            <Text fw={500} size="md" c="var(--claude-near-black)">Conversation History</Text>
            {turns.length > 0 && (
              <Badge variant="light" color="parchment" size="sm" radius="xl">
                {turns.length} turns
              </Badge>
            )}
          </Group>
        }
      >
        {turns.length === 0 ? (
          <Center py="xl">
            <Stack align="center" gap="xs">
              <ThemeIcon size={44} radius="lg" variant="light" color="parchment">
                <IconMessages size={22} />
              </ThemeIcon>
              <Text size="sm" c="var(--claude-stone)">No conversation turns recorded</Text>
            </Stack>
          </Center>
        ) : (
          <Stack gap="md">
            {turns.map((turn) => (
              <ConversationBubble key={turn.turnIndex} turn={turn} />
            ))}
          </Stack>
        )}
      </SectionCard>
    </Stack>
  );
}
