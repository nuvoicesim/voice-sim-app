import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import {
  Text, SimpleGrid, Paper, Group, Stack, Center, Box,
  ThemeIcon, Badge, Button, Skeleton,
} from '@mantine/core';
import {
  IconRocket, IconHistory, IconCalendar,
  IconBook2, IconClipboardCheck, IconTrendingUp, IconChevronRight,
  IconPlayerPlay, IconSparkles, IconTargetArrow,
} from '@tabler/icons-react';
import { fetchAssignments, selectAssignments, selectAssignmentsLoading } from '../../slices/assignmentSlice';
import { sessionApi } from '../../api/sessionApi';
import type { AppDispatch } from '../../store';
import type { Session } from '../../slices/sessionSlice';
import { PageHeader, StatCard, SectionCard } from '../../components/design';

const MODE_CONFIG: Record<string, { color: string; icon: typeof IconBook2; label: string }> = {
  practice: { color: 'parchment', icon: IconBook2, label: 'Practice' },
  assessment: { color: 'terracotta', icon: IconClipboardCheck, label: 'Assessment' },
};

function formatRelativeDate(dateStr: string): string {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatDueRelative(dateStr: string): { text: string; urgent: boolean } {
  const days = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { text: `Overdue`, urgent: true };
  if (days === 0) return { text: 'Due today', urgent: true };
  if (days === 1) return { text: 'Tomorrow', urgent: true };
  if (days <= 3) return { text: `${days} days`, urgent: true };
  if (days <= 7) return { text: `${days} days`, urgent: false };
  return {
    text: new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    urgent: false,
  };
}

function getAssignmentLabel(
  assignmentMap: Map<string, { title: string }>,
  assignmentId: string
): string {
  return assignmentMap.get(assignmentId)?.title || 'Archived assignment';
}

function LoadingSkeleton() {
  return (
    <Stack gap="xl">
      <Box>
        <Skeleton height={28} width="45%" mb={8} />
        <Skeleton height={14} width="60%" />
      </Box>
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
        {Array.from({ length: 4 }).map((_, i) => (
          <Paper key={i} radius="lg" p="md" withBorder>
            <Group justify="space-between">
              <Box>
                <Skeleton height={10} width={60} mb={10} />
                <Skeleton height={28} width={40} />
              </Box>
              <Skeleton circle height={42} />
            </Group>
          </Paper>
        ))}
      </SimpleGrid>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <Paper radius="lg" p="lg" withBorder>
          <Skeleton height={16} width="40%" mb="lg" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} height={52} radius="md" mb="sm" />
          ))}
        </Paper>
        <Paper radius="lg" p="lg" withBorder>
          <Skeleton height={16} width="40%" mb="lg" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} height={52} radius="md" mb="sm" />
          ))}
        </Paper>
      </SimpleGrid>
    </Stack>
  );
}

export default function StudentDashboard() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const assignments = useSelector(selectAssignments);
  const assignmentsLoading = useSelector(selectAssignmentsLoading);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);

  useEffect(() => {
    dispatch(fetchAssignments({ status: 'published' }));
    sessionApi.listMy().then((data) => {
      setSessions(data.sessions || []);
    }).catch(() => {}).finally(() => setSessionsLoading(false));
  }, [dispatch]);

  const loading = assignmentsLoading || sessionsLoading;

  const completedSessions = useMemo(
    () => sessions
      .filter((s) => s.status === 'completed')
      .sort((a, b) => (b.startedAt > a.startedAt ? 1 : -1)),
    [sessions],
  );

  const assignmentMap = useMemo(
    () => new Map(assignments.map((a) => [a.assignmentId, a])),
    [assignments],
  );

  const upcomingDue = useMemo(
    () => assignments
      .filter((a) => a.dueDate)
      .sort((a, b) => (a.dueDate! > b.dueDate! ? 1 : -1))
      .slice(0, 4),
    [assignments],
  );

  const recentSessions = completedSessions.slice(0, 4);
  const practiceCount = completedSessions.filter((s) => s.mode === 'practice').length;
  const assessmentCount = completedSessions.filter((s) => s.mode === 'assessment').length;

  if (loading) return <LoadingSkeleton />;

  return (
    <Stack gap="xl">
      <PageHeader
        title="Welcome back"
        subtitle="Here's an overview of your learning progress"
      />

      {/* ── Stats ── */}
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
        <StatCard label="Assignments" value={assignments.length} icon={<IconRocket size={22} />} />
        <StatCard label="Completed" value={completedSessions.length} icon={<IconTargetArrow size={22} />} />
        <StatCard label="Practice" value={practiceCount} icon={<IconBook2 size={22} />} accent="parchment" />
        <StatCard label="Assessment" value={assessmentCount} icon={<IconClipboardCheck size={22} />} />
      </SimpleGrid>

      {/* ── Main content ── */}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        {/* Upcoming deadlines */}
        <SectionCard
          title={
            <Group gap="xs">
              <ThemeIcon size={28} radius="md" variant="light" color="terracotta">
                <IconCalendar size={15} />
              </ThemeIcon>
              <Text fw={500} size="md" c="var(--claude-near-black)">Upcoming Deadlines</Text>
            </Group>
          }
          actions={
            <Button
              variant="subtle" size="xs" color="terracotta"
              rightSection={<IconChevronRight size={14} />}
              onClick={() => navigate('/student/assignments')}
            >
              View all
            </Button>
          }
        >
          {upcomingDue.length === 0 ? (
            <Center py="xl">
              <Stack align="center" gap="xs">
                <ThemeIcon size={44} radius="lg" variant="light" color="parchment">
                  <IconSparkles size={22} />
                </ThemeIcon>
                <Text size="sm" c="var(--claude-stone)">No upcoming deadlines</Text>
              </Stack>
            </Center>
          ) : (
            <Stack gap="xs">
              {upcomingDue.map((a) => {
                const due = formatDueRelative(a.dueDate!);
                const modeConf = MODE_CONFIG[a.mode] ?? MODE_CONFIG.practice;
                return (
                  <Paper
                    key={a.assignmentId}
                    radius="md" p="sm"
                    style={{
                      background: 'var(--claude-parchment)',
                      cursor: 'pointer',
                      transition: 'background 0.15s ease',
                      border: '1px solid var(--claude-border-cream)',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--claude-border-cream)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--claude-parchment)'; }}
                    onClick={() => navigate('/student/assignments')}
                  >
                    <Group justify="space-between" wrap="nowrap">
                      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                        <ThemeIcon size={32} radius="md" variant="light" color={modeConf.color}>
                          {a.mode === 'assessment'
                            ? <IconClipboardCheck size={16} />
                            : <IconBook2 size={16} />}
                        </ThemeIcon>
                        <Box style={{ minWidth: 0 }}>
                          <Text size="sm" fw={500} lineClamp={1} c="var(--claude-near-black)">{a.title}</Text>
                          <Badge size="xs" variant="light" radius="xl" color={modeConf.color}>
                            {modeConf.label}
                          </Badge>
                        </Box>
                      </Group>
                      <Badge
                        variant={due.urgent ? 'filled' : 'light'}
                        color="terracotta"
                        size="sm" radius="xl"
                        style={{ flexShrink: 0 }}
                      >
                        {due.text}
                      </Badge>
                    </Group>
                  </Paper>
                );
              })}
            </Stack>
          )}
        </SectionCard>

        {/* Recent activity */}
        <SectionCard
          title={
            <Group gap="xs">
              <ThemeIcon size={28} radius="md" variant="light" color="terracotta">
                <IconHistory size={15} />
              </ThemeIcon>
              <Text fw={500} size="md" c="var(--claude-near-black)">Recent Activity</Text>
            </Group>
          }
          actions={
            <Button
              variant="subtle" size="xs" color="terracotta"
              rightSection={<IconChevronRight size={14} />}
              onClick={() => navigate('/student/history')}
            >
              View all
            </Button>
          }
        >
          {recentSessions.length === 0 ? (
            <Center py="xl">
              <Stack align="center" gap="xs">
                <ThemeIcon size={44} radius="lg" variant="light" color="parchment">
                  <IconTrendingUp size={22} />
                </ThemeIcon>
                <Text size="sm" c="var(--claude-stone)" ta="center" maw={220}>
                  Complete your first simulation to see activity here
                </Text>
              </Stack>
            </Center>
          ) : (
            <Stack gap="xs">
              {recentSessions.map((s) => {
                const modeConf = MODE_CONFIG[s.mode] ?? MODE_CONFIG.practice;
                const ModeIcon = modeConf.icon;
                const assignmentTitle = getAssignmentLabel(assignmentMap, s.assignmentId);
                return (
                  <Paper
                    key={s.sessionId}
                    radius="md" p="sm"
                    style={{
                      background: 'var(--claude-parchment)',
                      cursor: 'pointer',
                      transition: 'background 0.15s ease',
                      border: '1px solid var(--claude-border-cream)',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--claude-border-cream)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--claude-parchment)'; }}
                    onClick={() => navigate(`/student/session/${s.sessionId}/detail`)}
                  >
                    <Group justify="space-between" wrap="nowrap">
                      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                        <ThemeIcon size={32} radius="md" variant="light" color={modeConf.color}>
                          <ModeIcon size={16} />
                        </ThemeIcon>
                        <Box style={{ minWidth: 0 }}>
                          <Text size="sm" fw={500} lineClamp={1} c="var(--claude-near-black)">{assignmentTitle}</Text>
                          <Group gap={8}>
                            <Text size="xs" c="var(--claude-stone)">Attempt #{s.attemptNo}</Text>
                            <Text size="xs" c="var(--claude-stone)">·</Text>
                            <Text size="xs" c="var(--claude-stone)">{formatRelativeDate(s.startedAt)}</Text>
                          </Group>
                        </Box>
                      </Group>
                      <IconChevronRight size={16} style={{ color: 'var(--claude-warm-silver)', flexShrink: 0 }} />
                    </Group>
                  </Paper>
                );
              })}
            </Stack>
          )}
        </SectionCard>
      </SimpleGrid>

      {/* ── Quick actions ── */}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <Paper
          radius="lg" p="lg"
          style={{
            background: 'var(--claude-terracotta)',
            cursor: 'pointer',
            transition: 'box-shadow 0.15s ease, transform 0.15s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 0 0 1px var(--claude-terracotta-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.boxShadow = ''; }}
          onClick={() => navigate('/student/assignments')}
        >
          <Group justify="space-between" align="center">
            <Group gap="md">
              <ThemeIcon size={48} radius="md" variant="filled" color="parchment.0">
                <IconPlayerPlay size={24} color="var(--claude-terracotta)" />
              </ThemeIcon>
              <Box>
                <Text fw={500} size="md" c="var(--claude-ivory)" style={{ fontFamily: 'Georgia, serif' }}>
                  Start a Simulation
                </Text>
                <Text size="xs" c="rgba(250,249,245,0.85)">
                  Browse and launch your assigned simulations
                </Text>
              </Box>
            </Group>
            <IconChevronRight size={20} style={{ color: 'rgba(250,249,245,0.85)' }} />
          </Group>
        </Paper>

        <Paper
          radius="lg" p="lg"
          style={{
            background: 'var(--claude-ivory)',
            cursor: 'pointer',
            border: '1px solid var(--claude-border-cream)',
            boxShadow: 'var(--claude-shadow-whisper)',
            transition: 'box-shadow 0.15s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 0 0 1px var(--claude-terracotta)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'var(--claude-shadow-whisper)'; }}
          onClick={() => navigate('/student/history')}
        >
          <Group justify="space-between" align="center">
            <Group gap="md">
              <ThemeIcon size={48} radius="md" variant="light" color="terracotta">
                <IconTrendingUp size={24} />
              </ThemeIcon>
              <Box>
                <Text fw={500} size="md" c="var(--claude-near-black)" style={{ fontFamily: 'Georgia, serif' }}>
                  View Performance
                </Text>
                <Text size="xs" c="var(--claude-olive)">
                  Review past sessions and track your growth
                </Text>
              </Box>
            </Group>
            <IconChevronRight size={20} style={{ color: 'var(--claude-stone)' }} />
          </Group>
        </Paper>
      </SimpleGrid>
    </Stack>
  );
}
