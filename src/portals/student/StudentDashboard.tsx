import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import {
  Title, Text, SimpleGrid, Paper, Group, Stack, Center, Box,
  ThemeIcon, Badge, Button, Skeleton,
} from '@mantine/core';
import {
  IconLayoutDashboard, IconRocket, IconHistory, IconCalendar,
  IconBook2, IconClipboardCheck, IconTrendingUp, IconChevronRight,
  IconPlayerPlay, IconSparkles, IconTargetArrow,
} from '@tabler/icons-react';
import { fetchAssignments, selectAssignments, selectAssignmentsLoading } from '../../slices/assignmentSlice';
import { sessionApi } from '../../api/sessionApi';
import type { AppDispatch } from '../../store';
import type { Session } from '../../slices/sessionSlice';

const MODE_CONFIG: Record<string, { color: string; icon: typeof IconBook2; label: string }> = {
  practice: { color: 'blue', icon: IconBook2, label: 'Practice' },
  assessment: { color: 'orange', icon: IconClipboardCheck, label: 'Assessment' },
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

function StatCard({
  label, value, icon: Icon, color, bgGradient, borderColor,
}: {
  label: string;
  value: string | number;
  icon: typeof IconBook2;
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
      {/* ── Welcome header ── */}
      <Box>
        <Group gap="sm" mb={4}>
          <ThemeIcon size={38} radius="xl" variant="gradient" gradient={{ from: 'indigo', to: 'cyan' }}>
            <IconLayoutDashboard size={20} color="white" />
          </ThemeIcon>
          <Title order={2} fw={700}>Welcome back</Title>
        </Group>
        <Text c="dimmed" size="sm" ml={52}>
          Here's an overview of your learning progress
        </Text>
      </Box>

      {/* ── Stats ── */}
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
        <StatCard
          label="Assignments"
          value={assignments.length}
          icon={IconRocket}
          color="indigo"
          bgGradient="linear-gradient(135deg, #f0f4ff 0%, #e8ecff 100%)"
          borderColor="#dbe1ff"
        />
        <StatCard
          label="Completed"
          value={completedSessions.length}
          icon={IconTargetArrow}
          color="teal"
          bgGradient="linear-gradient(135deg, #f0fff4 0%, #e6ffed 100%)"
          borderColor="#c6f6d5"
        />
        <StatCard
          label="Practice"
          value={practiceCount}
          icon={IconBook2}
          color="blue"
          bgGradient="linear-gradient(135deg, #eef5ff 0%, #e0edff 100%)"
          borderColor="#c9deff"
        />
        <StatCard
          label="Assessment"
          value={assessmentCount}
          icon={IconClipboardCheck}
          color="orange"
          bgGradient="linear-gradient(135deg, #fff7f0 0%, #fff0e6 100%)"
          borderColor="#ffdfc4"
        />
      </SimpleGrid>

      {/* ── Main content ── */}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        {/* Upcoming deadlines */}
        <Paper
          radius="lg" p="lg" withBorder
          style={{ border: '1px solid #edf0f5' }}
        >
          <Group justify="space-between" mb="md">
            <Group gap="xs">
              <ThemeIcon size={28} radius="xl" variant="light" color="red">
                <IconCalendar size={15} />
              </ThemeIcon>
              <Text fw={600} size="sm">Upcoming Deadlines</Text>
            </Group>
            <Button
              variant="subtle" size="xs" color="gray"
              rightSection={<IconChevronRight size={14} />}
              onClick={() => navigate('/student/assignments')}
            >
              View all
            </Button>
          </Group>

          {upcomingDue.length === 0 ? (
            <Center py="xl">
              <Stack align="center" gap="xs">
                <ThemeIcon size={44} radius="xl" variant="light" color="gray" style={{ opacity: 0.5 }}>
                  <IconSparkles size={22} />
                </ThemeIcon>
                <Text size="sm" c="dimmed">No upcoming deadlines</Text>
              </Stack>
            </Center>
          ) : (
            <Stack gap="xs">
              {upcomingDue.map((a) => {
                const due = formatDueRelative(a.dueDate!);
                return (
                  <Paper
                    key={a.assignmentId}
                    radius="md" p="sm"
                    style={{
                      background: '#f9fafb',
                      cursor: 'pointer',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#f0f2f5'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = '#f9fafb'; }}
                    onClick={() => navigate('/student/assignments')}
                  >
                    <Group justify="space-between" wrap="nowrap">
                      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                        <ThemeIcon
                          size={32} radius="xl" variant="light"
                          color={MODE_CONFIG[a.mode]?.color || 'gray'}
                        >
                          {a.mode === 'assessment'
                            ? <IconClipboardCheck size={16} />
                            : <IconBook2 size={16} />}
                        </ThemeIcon>
                        <Box style={{ minWidth: 0 }}>
                          <Text size="sm" fw={500} lineClamp={1}>{a.title}</Text>
                          <Badge
                            size="xs" variant="light" radius="xl"
                            color={MODE_CONFIG[a.mode]?.color || 'gray'}
                          >
                            {MODE_CONFIG[a.mode]?.label || a.mode}
                          </Badge>
                        </Box>
                      </Group>
                      <Badge
                        variant={due.urgent ? 'filled' : 'light'}
                        color={due.urgent ? 'red' : 'gray'}
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
        </Paper>

        {/* Recent activity */}
        <Paper
          radius="lg" p="lg" withBorder
          style={{ border: '1px solid #edf0f5' }}
        >
          <Group justify="space-between" mb="md">
            <Group gap="xs">
              <ThemeIcon size={28} radius="xl" variant="light" color="violet">
                <IconHistory size={15} />
              </ThemeIcon>
              <Text fw={600} size="sm">Recent Activity</Text>
            </Group>
            <Button
              variant="subtle" size="xs" color="gray"
              rightSection={<IconChevronRight size={14} />}
              onClick={() => navigate('/student/history')}
            >
              View all
            </Button>
          </Group>

          {recentSessions.length === 0 ? (
            <Center py="xl">
              <Stack align="center" gap="xs">
                <ThemeIcon size={44} radius="xl" variant="light" color="gray" style={{ opacity: 0.5 }}>
                  <IconTrendingUp size={22} />
                </ThemeIcon>
                <Text size="sm" c="dimmed" ta="center" maw={220}>
                  Complete your first simulation to see activity here
                </Text>
              </Stack>
            </Center>
          ) : (
            <Stack gap="xs">
              {recentSessions.map((s) => {
                const modeConf = MODE_CONFIG[s.mode] ?? MODE_CONFIG.practice;
                const ModeIcon = modeConf.icon;
                const assignmentTitle = assignmentMap.get(s.assignmentId)?.title || s.assignmentId;
                return (
                  <Paper
                    key={s.sessionId}
                    radius="md" p="sm"
                    style={{
                      background: '#f9fafb',
                      cursor: 'pointer',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#f0f2f5'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = '#f9fafb'; }}
                    onClick={() => navigate(`/student/session/${s.sessionId}/detail`)}
                  >
                    <Group justify="space-between" wrap="nowrap">
                      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                        <ThemeIcon size={32} radius="xl" variant="light" color={modeConf.color}>
                          <ModeIcon size={16} />
                        </ThemeIcon>
                        <Box style={{ minWidth: 0 }}>
                          <Text size="sm" fw={500} lineClamp={1}>{assignmentTitle}</Text>
                          <Group gap={8}>
                            <Text size="xs" c="dimmed">Attempt #{s.attemptNo}</Text>
                            <Text size="xs" c="dimmed">·</Text>
                            <Text size="xs" c="dimmed">{formatRelativeDate(s.startedAt)}</Text>
                          </Group>
                        </Box>
                      </Group>
                      <IconChevronRight size={16} style={{ color: 'var(--mantine-color-gray-4)', flexShrink: 0 }} />
                    </Group>
                  </Paper>
                );
              })}
            </Stack>
          )}
        </Paper>
      </SimpleGrid>

      {/* ── Quick actions ── */}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <Paper
          radius="lg" p="lg"
          style={{
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            cursor: 'pointer',
            transition: 'transform 0.2s ease, box-shadow 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 12px 40px rgba(102,126,234,0.3)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = '';
            e.currentTarget.style.boxShadow = '';
          }}
          onClick={() => navigate('/student/assignments')}
        >
          <Group justify="space-between" align="center">
            <Group gap="md">
              <ThemeIcon size={48} radius="xl" variant="white" color="indigo">
                <IconPlayerPlay size={24} />
              </ThemeIcon>
              <Box>
                <Text fw={700} size="md" c="white">Start a Simulation</Text>
                <Text size="xs" c="white" style={{ opacity: 0.8 }}>
                  Browse and launch your assigned simulations
                </Text>
              </Box>
            </Group>
            <IconChevronRight size={20} style={{ color: 'rgba(255,255,255,0.6)' }} />
          </Group>
        </Paper>

        <Paper
          radius="lg" p="lg"
          style={{
            background: 'linear-gradient(135deg, #a855f7 0%, #6366f1 100%)',
            cursor: 'pointer',
            transition: 'transform 0.2s ease, box-shadow 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 12px 40px rgba(168,85,247,0.3)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = '';
            e.currentTarget.style.boxShadow = '';
          }}
          onClick={() => navigate('/student/history')}
        >
          <Group justify="space-between" align="center">
            <Group gap="md">
              <ThemeIcon size={48} radius="xl" variant="white" color="violet">
                <IconTrendingUp size={24} />
              </ThemeIcon>
              <Box>
                <Text fw={700} size="md" c="white">View Performance</Text>
                <Text size="xs" c="white" style={{ opacity: 0.8 }}>
                  Review past sessions and track your growth
                </Text>
              </Box>
            </Group>
            <IconChevronRight size={20} style={{ color: 'rgba(255,255,255,0.6)' }} />
          </Group>
        </Paper>
      </SimpleGrid>
    </Stack>
  );
}
