import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Text, Badge, Stack, Center, Group,
  Paper, TextInput, SegmentedControl, SimpleGrid, Box,
  ThemeIcon, Skeleton,
} from '@mantine/core';
import {
  IconSearch, IconBook2, IconClipboardCheck,
  IconClock, IconCalendar, IconChevronRight, IconArchive,
  IconHash, IconHourglass, IconHistory,
} from '@tabler/icons-react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchAssignments, selectAssignments } from '../../slices/assignmentSlice';
import { sessionApi } from '../../api/sessionApi';
import type { AppDispatch } from '../../store';
import type { Session } from '../../slices/sessionSlice';
import { PageHeader, StatCard, EmptyState as EmptyStateCmp } from '../../components/design';

const MODE_CONFIG: Record<string, { color: string; icon: typeof IconBook2; label: string }> = {
  practice: { color: 'parchment', icon: IconBook2, label: 'Practice' },
  assessment: { color: 'terracotta', icon: IconClipboardCheck, label: 'Assessment' },
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

function getAssignmentLabel(assignmentMap: Map<string, string>, assignmentId: string): string {
  return assignmentMap.get(assignmentId) || 'Archived assignment';
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
      radius="lg"
      p={0}
      style={{
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'box-shadow 0.2s ease',
        background: 'var(--claude-ivory)',
        border: '1px solid var(--claude-border-cream)',
        boxShadow: 'var(--claude-shadow-whisper)',
      }}
      onClick={onClick}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 0 0 1px var(--claude-terracotta), var(--claude-shadow-whisper)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'var(--claude-shadow-whisper)'; }}
    >
      <Group p="lg" justify="space-between" wrap="nowrap" gap="lg">
        <Group gap="md" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
          <ThemeIcon size={44} radius="md" variant="light" color={modeConf.color}>
            <ModeIcon size={22} />
          </ThemeIcon>

          <Box style={{ flex: 1, minWidth: 0 }}>
            <Group gap="xs" mb={2} wrap="nowrap">
              <Text fw={500} size="sm" lineClamp={1} c="var(--claude-near-black)" style={{ flex: 1, minWidth: 0, fontFamily: 'Georgia, serif' }}>
                {assignmentTitle}
              </Text>
              <Badge variant="light" color={modeConf.color} size="xs" radius="xl" style={{ flexShrink: 0 }}>
                {modeConf.label}
              </Badge>
            </Group>

            <Group gap="lg" wrap="wrap">
              <Group gap={5}>
                <IconHash size={13} style={{ color: 'var(--claude-stone)' }} />
                <Text size="xs" c="var(--claude-olive)">Attempt {session.attemptNo}</Text>
              </Group>
              <Group gap={5}>
                <IconCalendar size={13} style={{ color: 'var(--claude-stone)' }} />
                <Text size="xs" c="var(--claude-olive)">{relDate}</Text>
              </Group>
              <Group gap={5}>
                <IconClock size={13} style={{ color: 'var(--claude-stone)' }} />
                <Text size="xs" c="var(--claude-olive)">{duration}</Text>
              </Group>
            </Group>
          </Box>
        </Group>

        <Group gap="sm" wrap="nowrap" style={{ flexShrink: 0 }}>
          <Box style={{ textAlign: 'right' }} visibleFrom="sm">
            <Text size="xs" c="var(--claude-stone)">Completed</Text>
            <Text size="xs" fw={500} c="var(--claude-charcoal)">
              {session.endedAt
                ? new Date(session.endedAt).toLocaleString(undefined, {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })
                : '—'}
            </Text>
          </Box>
          <ThemeIcon size={32} radius="md" variant="light" color="parchment">
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
        <Paper key={i} radius="lg" withBorder style={{ overflow: 'hidden' }}>
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
        const title = getAssignmentLabel(assignmentMap, s.assignmentId);
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
      <PageHeader
        title="History & Performance"
        subtitle="Review your past simulation attempts and track progress"
      />

      {/* ── Stats overview ── */}
      {!loading && allCompleted.length > 0 && (
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
          <StatCard label="Total" value={allCompleted.length} icon={<IconHistory size={22} />} />
          <StatCard label="Practice" value={practiceCount} icon={<IconBook2 size={22} />} accent="parchment" />
          <StatCard label="Assessment" value={assessmentCount} icon={<IconClipboardCheck size={22} />} />
          <StatCard label="Avg. Duration" value={avgDuration} icon={<IconHourglass size={22} />} accent="parchment" />
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
            color="terracotta"
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
        <EmptyStateCmp
          icon={<IconArchive size={28} />}
          title="No completed sessions"
          description="Once you complete a simulation session, your results and conversation history will appear here."
        />
      ) : completedSessions.length === 0 ? (
        <Center style={{ minHeight: 200 }}>
          <Stack align="center" gap="sm">
            <ThemeIcon size={52} radius="lg" variant="light" color="parchment">
              <IconSearch size={26} />
            </ThemeIcon>
            <Text c="var(--claude-stone)" size="sm">No sessions match your filters</Text>
          </Stack>
        </Center>
      ) : (
        <Stack gap="md">
          {completedSessions.map((s) => (
            <SessionItem
              key={s.sessionId}
              session={s}
              assignmentTitle={getAssignmentLabel(assignmentMap, s.assignmentId)}
              onClick={() => navigate(`/student/session/${s.sessionId}/detail`)}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}
