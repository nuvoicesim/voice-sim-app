import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Title, Text, Badge, Stack, Center, Group,
  Paper, TextInput, SegmentedControl, SimpleGrid, Box,
  ThemeIcon, Skeleton,
} from '@mantine/core';
import {
  IconSearch, IconHistory, IconBook2, IconClipboardCheck,
  IconClock, IconCalendar, IconChevronRight, IconArchive,
  IconHash, IconHourglass,
} from '@tabler/icons-react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchAssignments, selectAssignments } from '../../slices/assignmentSlice';
import { sessionApi } from '../../api/sessionApi';
import type { AppDispatch } from '../../store';
import type { Session } from '../../slices/sessionSlice';

const MODE_CONFIG: Record<string, { color: string; gradient: string; icon: typeof IconBook2; label: string }> = {
  practice: {
    color: 'blue',
    gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    icon: IconBook2,
    label: 'Practice',
  },
  assessment: {
    color: 'orange',
    gradient: 'linear-gradient(135deg, #f5af19 0%, #f12711 100%)',
    icon: IconClipboardCheck,
    label: 'Assessment',
  },
};

function formatDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return '—';
  const diffSec = Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

function formatRelativeDate(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diffMs / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function SessionItem({
  session,
  assignmentTitle,
  onClick,
}: {
  session: Session;
  assignmentTitle: string;
  onClick: () => void;
}) {
  const modeConf = MODE_CONFIG[session.mode] ?? MODE_CONFIG.practice;
  const ModeIcon = modeConf.icon;
  const duration = formatDuration(session.startedAt, session.endedAt);
  const relDate = formatRelativeDate(session.startedAt);

  return (
    <Paper
      shadow="sm"
      radius="lg"
      p={0}
      withBorder
      style={{
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'box-shadow 0.2s ease, transform 0.2s ease',
        border: '1px solid #edf0f5',
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 8px 30px rgba(0,0,0,0.08)';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = '';
        e.currentTarget.style.transform = '';
      }}
    >
      <Box style={{ height: 3, background: modeConf.gradient }} />

      <Group p="lg" justify="space-between" wrap="nowrap" gap="lg">
        {/* Left: icon + info */}
        <Group gap="md" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
          <ThemeIcon size={44} radius="xl" variant="light" color={modeConf.color}>
            <ModeIcon size={22} />
          </ThemeIcon>

          <Box style={{ flex: 1, minWidth: 0 }}>
            <Group gap="xs" mb={2} wrap="nowrap">
              <Text fw={600} size="sm" lineClamp={1} style={{ flex: 1, minWidth: 0 }}>
                {assignmentTitle}
              </Text>
              <Badge variant="light" color={modeConf.color} size="xs" radius="xl" style={{ flexShrink: 0 }}>
                {modeConf.label}
              </Badge>
            </Group>

            <Group gap="lg" wrap="wrap">
              <Group gap={5}>
                <IconHash size={13} style={{ color: 'var(--mantine-color-gray-5)' }} />
                <Text size="xs" c="dimmed">Attempt {session.attemptNo}</Text>
              </Group>
              <Group gap={5}>
                <IconCalendar size={13} style={{ color: 'var(--mantine-color-gray-5)' }} />
                <Text size="xs" c="dimmed">{relDate}</Text>
              </Group>
              <Group gap={5}>
                <IconClock size={13} style={{ color: 'var(--mantine-color-gray-5)' }} />
                <Text size="xs" c="dimmed">{duration}</Text>
              </Group>
            </Group>
          </Box>
        </Group>

        {/* Right: completed time + arrow */}
        <Group gap="sm" wrap="nowrap" style={{ flexShrink: 0 }}>
          <Box style={{ textAlign: 'right' }} visibleFrom="sm">
            <Text size="xs" c="dimmed">Completed</Text>
            <Text size="xs" fw={500} c="dark.4">
              {session.endedAt
                ? new Date(session.endedAt).toLocaleString(undefined, {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })
                : '—'}
            </Text>
          </Box>
          <ThemeIcon size={32} radius="xl" variant="light" color="gray">
            <IconChevronRight size={16} />
          </ThemeIcon>
        </Group>
      </Group>
    </Paper>
  );
}

function LoadingSkeleton() {
  return (
    <Stack gap="md">
      {Array.from({ length: 5 }).map((_, i) => (
        <Paper key={i} shadow="sm" radius="lg" withBorder style={{ overflow: 'hidden' }}>
          <Skeleton height={3} radius={0} />
          <Group p="lg" justify="space-between">
            <Group gap="md" style={{ flex: 1 }}>
              <Skeleton circle height={44} />
              <Box style={{ flex: 1 }}>
                <Skeleton height={14} width="50%" mb={8} />
                <Skeleton height={10} width="70%" />
              </Box>
            </Group>
            <Skeleton circle height={32} />
          </Group>
        </Paper>
      ))}
    </Stack>
  );
}

function EmptyState() {
  return (
    <Center style={{ minHeight: 360 }}>
      <Stack align="center" gap="lg">
        <Box
          style={{
            width: 100,
            height: 100,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #f0f4ff 0%, #e8ecff 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <IconArchive size={44} style={{ color: '#9ba3c2' }} />
        </Box>
        <Box style={{ textAlign: 'center' }}>
          <Title order={4} c="dark.4" mb={4}>No completed sessions</Title>
          <Text c="dimmed" size="sm" maw={320} style={{ lineHeight: 1.6 }}>
            Once you complete a simulation session, your results and conversation history will appear here.
          </Text>
        </Box>
      </Stack>
    </Center>
  );
}

export default function HistoryPage() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const assignments = useSelector(selectAssignments);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modeFilter, setModeFilter] = useState('all');

  useEffect(() => {
    dispatch(fetchAssignments({ status: 'published' }));
    sessionApi.listMy().then((data) => {
      setSessions(data.sessions || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [dispatch]);

  const assignmentMap = useMemo(
    () => new Map(assignments.map((a) => [a.assignmentId, a.title])),
    [assignments],
  );

  const completedSessions = useMemo(() => {
    let list = sessions
      .filter((s) => s.status === 'completed')
      .sort((a, b) => (b.startedAt > a.startedAt ? 1 : -1));

    if (modeFilter !== 'all') {
      list = list.filter((s) => s.mode === modeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((s) => {
        const title = assignmentMap.get(s.assignmentId) || '';
        return title.toLowerCase().includes(q);
      });
    }
    return list;
  }, [sessions, modeFilter, search, assignmentMap]);

  const allCompleted = sessions.filter((s) => s.status === 'completed');
  const practiceCount = allCompleted.filter((s) => s.mode === 'practice').length;
  const assessmentCount = allCompleted.filter((s) => s.mode === 'assessment').length;

  const avgDuration = useMemo(() => {
    const durations = allCompleted
      .filter((s) => s.endedAt)
      .map((s) => new Date(s.endedAt!).getTime() - new Date(s.startedAt).getTime());
    if (durations.length === 0) return '—';
    const avgMs = durations.reduce((a, b) => a + b, 0) / durations.length;
    const mins = Math.round(avgMs / 60_000);
    return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }, [allCompleted]);

  return (
    <Stack gap="xl">
      {/* ── Page header ── */}
      <Box>
        <Group gap="sm" mb={4}>
          <ThemeIcon size={38} radius="xl" variant="gradient" gradient={{ from: 'violet', to: 'grape' }}>
            <IconHistory size={20} color="white" />
          </ThemeIcon>
          <Title order={2} fw={700}>History & Performance</Title>
        </Group>
        <Text c="dimmed" size="sm" ml={52}>
          Review your past simulation attempts and track progress
        </Text>
      </Box>

      {/* ── Stats overview ── */}
      {!loading && allCompleted.length > 0 && (
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
          <Paper
            radius="lg" p="md"
            style={{ background: 'linear-gradient(135deg, #f5f0ff 0%, #ede5ff 100%)', border: '1px solid #ddd0ff' }}
          >
            <Group justify="space-between" align="center">
              <Box>
                <Text size="xs" c="dimmed" fw={600} style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
                  Total
                </Text>
                <Title order={2} c="violet.7" mt={2}>{allCompleted.length}</Title>
              </Box>
              <ThemeIcon size={42} radius="xl" variant="light" color="violet">
                <IconHistory size={22} />
              </ThemeIcon>
            </Group>
          </Paper>

          <Paper
            radius="lg" p="md"
            style={{ background: 'linear-gradient(135deg, #eef5ff 0%, #e0edff 100%)', border: '1px solid #c9deff' }}
          >
            <Group justify="space-between" align="center">
              <Box>
                <Text size="xs" c="dimmed" fw={600} style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
                  Practice
                </Text>
                <Title order={2} c="blue.7" mt={2}>{practiceCount}</Title>
              </Box>
              <ThemeIcon size={42} radius="xl" variant="light" color="blue">
                <IconBook2 size={22} />
              </ThemeIcon>
            </Group>
          </Paper>

          <Paper
            radius="lg" p="md"
            style={{ background: 'linear-gradient(135deg, #fff7f0 0%, #fff0e6 100%)', border: '1px solid #ffdfc4' }}
          >
            <Group justify="space-between" align="center">
              <Box>
                <Text size="xs" c="dimmed" fw={600} style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
                  Assessment
                </Text>
                <Title order={2} c="orange.7" mt={2}>{assessmentCount}</Title>
              </Box>
              <ThemeIcon size={42} radius="xl" variant="light" color="orange">
                <IconClipboardCheck size={22} />
              </ThemeIcon>
            </Group>
          </Paper>

          <Paper
            radius="lg" p="md"
            style={{ background: 'linear-gradient(135deg, #f0fff4 0%, #e6ffed 100%)', border: '1px solid #c6f6d5' }}
          >
            <Group justify="space-between" align="center">
              <Box>
                <Text size="xs" c="dimmed" fw={600} style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
                  Avg. Duration
                </Text>
                <Title order={2} c="teal.7" mt={2}>{avgDuration}</Title>
              </Box>
              <ThemeIcon size={42} radius="xl" variant="light" color="teal">
                <IconHourglass size={22} />
              </ThemeIcon>
            </Group>
          </Paper>
        </SimpleGrid>
      )}

      {/* ── Search & filter ── */}
      {!loading && allCompleted.length > 0 && (
        <Group gap="md" wrap="wrap">
          <TextInput
            placeholder="Search by assignment name..."
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            radius="xl"
            style={{ flex: 1, maxWidth: 360 }}
          />
          <SegmentedControl
            value={modeFilter}
            onChange={setModeFilter}
            radius="xl"
            data={[
              { label: `All (${allCompleted.length})`, value: 'all' },
              { label: `Practice (${practiceCount})`, value: 'practice' },
              { label: `Assessment (${assessmentCount})`, value: 'assessment' },
            ]}
          />
        </Group>
      )}

      {/* ── Content ── */}
      {loading ? (
        <LoadingSkeleton />
      ) : allCompleted.length === 0 ? (
        <EmptyState />
      ) : completedSessions.length === 0 ? (
        <Center style={{ minHeight: 200 }}>
          <Stack align="center" gap="sm">
            <ThemeIcon size={52} radius="xl" variant="light" color="gray">
              <IconSearch size={26} />
            </ThemeIcon>
            <Text c="dimmed" size="sm">No sessions match your filters</Text>
          </Stack>
        </Center>
      ) : (
        <Stack gap="md">
          {completedSessions.map((s) => (
            <SessionItem
              key={s.sessionId}
              session={s}
              assignmentTitle={assignmentMap.get(s.assignmentId) || s.assignmentId}
              onClick={() => navigate(`/student/session/${s.sessionId}/detail`)}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}
