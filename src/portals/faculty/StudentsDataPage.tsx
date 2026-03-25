import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Title, Text, Stack, Paper, Box, Group, Center, Select,
  ThemeIcon, Skeleton, Badge, SimpleGrid, Button, RingProgress,
  TextInput,
} from '@mantine/core';
import {
  IconUsers, IconInbox, IconSearch, IconChevronRight, IconArrowLeft,
  IconUser, IconCalendar, IconCircleCheck, IconActivity, IconHash,
  IconClock, IconTrophy, IconStarFilled, IconMail,
} from '@tabler/icons-react';
import { assignmentApi } from '../../api/assignmentApi';
import { sessionApi } from '../../api/sessionApi';
import { analyticsApi } from '../../api/analyticsApi';
import { cognitoUserApi } from '../../api/cognitoUserApi';

interface SessionRecord {
  sessionId: string;
  assignmentId: string;
  studentUserId: string;
  attemptNo: number;
  mode: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
}

interface StudentSummary {
  studentUserId: string;
  studentEmail?: string;
  totalAttempts: number;
  completedAttempts: number;
  latestDate: string;
  sessions: SessionRecord[];
}

interface StudentAnalytics {
  totalSessions: number;
  completedSessions: number;
  activeSessions: number;
  averageScore: number | null;
  recentScores: number[];
  sessionsByAssignment: Record<string, number>;
}

interface AssignmentInfo {
  assignmentId: string;
  title: string;
  mode: string;
  status: string;
}

function formatRelativeDate(dateStr: string): string {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  active: { color: 'yellow', label: 'Active' },
  completed: { color: 'green', label: 'Completed' },
  abandoned: { color: 'gray', label: 'Abandoned' },
};

/* ────────────────────────────────────────────── */
/*  Sub-components                                */
/* ────────────────────────────────────────────── */

function StudentCard({
  student,
  onClick,
}: {
  student: StudentSummary;
  onClick: () => void;
}) {
  const email = student.studentEmail;
  const initial = (email || student.studentUserId).charAt(0).toUpperCase();
  const rate = student.totalAttempts > 0
    ? Math.round((student.completedAttempts / student.totalAttempts) * 100)
    : 0;

  return (
    <Paper
      radius="lg" p="md" withBorder
      style={{
        border: '1px solid #edf0f5',
        cursor: 'pointer',
        transition: 'box-shadow 0.2s ease, transform 0.2s ease',
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 6px 24px rgba(0,0,0,0.07)';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = '';
        e.currentTarget.style.transform = '';
      }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap="md" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
          <Box
            style={{
              width: 42,
              height: 42,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Text fw={700} size="sm" c="white">{initial}</Text>
          </Box>
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Group gap={4}>
              <IconMail size={13} style={{ color: 'var(--mantine-color-blue-5)' }} />
              <Text fw={600} size="sm" lineClamp={1}>
                {email || student.studentUserId}
              </Text>
            </Group>
            <Group gap="lg" mt={4}>
              <Group gap={4}>
                <IconActivity size={12} style={{ color: 'var(--mantine-color-gray-5)' }} />
                <Text size="xs" c="dimmed">{student.totalAttempts} attempts</Text>
              </Group>
              <Group gap={4}>
                <IconCircleCheck size={12} style={{ color: 'var(--mantine-color-green-5)' }} />
                <Text size="xs" c="dimmed">{student.completedAttempts} completed</Text>
              </Group>
              <Group gap={4}>
                <IconCalendar size={12} style={{ color: 'var(--mantine-color-gray-5)' }} />
                <Text size="xs" c="dimmed">{formatRelativeDate(student.latestDate)}</Text>
              </Group>
            </Group>
          </Box>
        </Group>

        <Group gap="sm" wrap="nowrap" style={{ flexShrink: 0 }}>
          <Badge
            variant="light"
            color={rate >= 80 ? 'teal' : rate >= 50 ? 'blue' : 'orange'}
            size="sm" radius="xl"
          >
            {rate}% done
          </Badge>
          <ThemeIcon size={28} radius="xl" variant="light" color="gray">
            <IconChevronRight size={14} />
          </ThemeIcon>
        </Group>
      </Group>
    </Paper>
  );
}

function SessionRow({
  session,
  onClick,
}: {
  session: SessionRecord;
  onClick: () => void;
}) {
  const statusConf = STATUS_CONFIG[session.status] ?? STATUS_CONFIG.active;
  const duration = formatDuration(session.startedAt, session.endedAt);

  return (
    <Paper
      radius="md" p="sm"
      style={{
        background: '#f9fafb',
        cursor: 'pointer',
        transition: 'background 0.15s ease',
      }}
      onClick={onClick}
      onMouseEnter={(e) => { e.currentTarget.style.background = '#f0f2f5'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = '#f9fafb'; }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <ThemeIcon size={30} radius="xl" variant="light" color="indigo">
            <IconHash size={14} />
          </ThemeIcon>
          <Box style={{ minWidth: 0 }}>
            <Group gap="xs">
              <Text size="sm" fw={500}>Attempt {session.attemptNo}</Text>
              <Badge variant="dot" color={statusConf.color} size="xs" radius="xl">
                {statusConf.label}
              </Badge>
            </Group>
            <Group gap="lg" mt={2}>
              <Group gap={4}>
                <IconCalendar size={11} style={{ color: 'var(--mantine-color-gray-5)' }} />
                <Text size="xs" c="dimmed">
                  {new Date(session.startedAt).toLocaleString(undefined, {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </Text>
              </Group>
              <Group gap={4}>
                <IconClock size={11} style={{ color: 'var(--mantine-color-gray-5)' }} />
                <Text size="xs" c="dimmed">{duration}</Text>
              </Group>
            </Group>
          </Box>
        </Group>
        <IconChevronRight size={14} style={{ color: 'var(--mantine-color-gray-4)', flexShrink: 0 }} />
      </Group>
    </Paper>
  );
}

function PageSkeleton() {
  return (
    <Stack gap="xl">
      <Box>
        <Skeleton height={28} width="30%" mb={8} />
        <Skeleton height={14} width="55%" />
      </Box>
      <Skeleton height={40} width="50%" radius="md" />
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
        {Array.from({ length: 4 }).map((_, i) => (
          <Paper key={i} radius="lg" p="md" withBorder>
            <Group justify="space-between">
              <Box><Skeleton height={10} width={60} mb={10} /><Skeleton height={28} width={40} /></Box>
              <Skeleton circle height={42} />
            </Group>
          </Paper>
        ))}
      </SimpleGrid>
      <Stack gap="sm">
        {Array.from({ length: 4 }).map((_, i) => (
          <Paper key={i} radius="lg" p="md" withBorder>
            <Group gap="md">
              <Skeleton circle height={42} />
              <Box style={{ flex: 1 }}>
                <Skeleton height={14} width="45%" mb={8} />
                <Skeleton height={10} width="65%" />
              </Box>
              <Skeleton circle height={28} />
            </Group>
          </Paper>
        ))}
      </Stack>
    </Stack>
  );
}

function EmptyState({ message, sub }: { message: string; sub: string }) {
  return (
    <Center style={{ minHeight: 280 }}>
      <Stack align="center" gap="lg">
        <Box
          style={{
            width: 88,
            height: 88,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #f0f4ff 0%, #e8ecff 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <IconInbox size={40} style={{ color: '#9ba3c2' }} />
        </Box>
        <Box style={{ textAlign: 'center' }}>
          <Title order={4} c="dark.4" mb={4}>{message}</Title>
          <Text c="dimmed" size="sm" maw={320} style={{ lineHeight: 1.6 }}>{sub}</Text>
        </Box>
      </Stack>
    </Center>
  );
}

function StatCard({
  label, value, icon: Icon, color, bgGradient, borderColor,
}: {
  label: string;
  value: string | number;
  icon: typeof IconUsers;
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

/* ────────────────────────────────────────────── */
/*  Student Detail View (Level 2)                 */
/* ────────────────────────────────────────────── */

function StudentDetailView({
  studentId,
  studentEmail,
  sessions,
  analytics,
  analyticsLoading,
  onBack,
  onSessionClick,
}: {
  studentId: string;
  studentEmail?: string;
  sessions: SessionRecord[];
  analytics: StudentAnalytics | null;
  analyticsLoading: boolean;
  onBack: () => void;
  onSessionClick: (sessionId: string) => void;
}) {
  const displayLabel = studentEmail || studentId;
  const initial = displayLabel.charAt(0).toUpperCase();
  const avgScore = analytics?.averageScore;
  const sColor = avgScore != null ? scoreToColor(avgScore) : 'gray';

  return (
    <Stack gap="xl">
      {/* Back + student header */}
      <Box>
        <Button
          variant="subtle" color="gray" size="xs" radius="xl" px="sm" mb="xs"
          leftSection={<IconArrowLeft size={14} />}
          onClick={onBack}
        >
          Back to Student List
        </Button>
        <Group gap="md">
          <Box
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Text fw={700} size="md" c="white">{initial}</Text>
          </Box>
          <Box>
            <Title order={3} fw={700}>{displayLabel}</Title>
            <Text size="sm" c="dimmed">
              {sessions.length} session{sessions.length !== 1 ? 's' : ''} for this assignment
            </Text>
          </Box>
        </Group>
      </Box>

      {/* Analytics cards */}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        {/* Score card */}
        <Paper radius="lg" p="lg" withBorder style={{ border: '1px solid #edf0f5' }}>
          <Group gap="xs" mb="lg">
            <ThemeIcon size={26} radius="xl" variant="light" color="yellow">
              <IconTrophy size={14} />
            </ThemeIcon>
            <Text fw={600} size="sm">Performance</Text>
          </Group>

          {analyticsLoading ? (
            <Center py="xl"><Skeleton circle height={120} /></Center>
          ) : avgScore != null ? (
            <Stack align="center" gap="md">
              <RingProgress
                size={130}
                thickness={12}
                roundCaps
                sections={[{ value: avgScore, color: `var(--mantine-color-${sColor}-6)` }]}
                label={
                  <Stack align="center" gap={0}>
                    <Text fw={800} size="xl" c={`${sColor}.7`}>{Math.round(avgScore)}</Text>
                    <Text size="xs" c="dimmed">avg score</Text>
                  </Stack>
                }
              />
              {analytics!.recentScores.length > 0 && (
                <Group gap={4} justify="center">
                  <Text size="xs" c="dimmed">Recent:</Text>
                  {analytics!.recentScores.slice(-5).map((s, i) => (
                    <Badge key={i} variant="light" color={scoreToColor(s)} size="sm" radius="xl">
                      {s}
                    </Badge>
                  ))}
                </Group>
              )}
            </Stack>
          ) : (
            <Center py="lg">
              <Stack align="center" gap="xs">
                <ThemeIcon size={40} radius="xl" variant="light" color="gray" style={{ opacity: 0.5 }}>
                  <IconTrophy size={20} />
                </ThemeIcon>
                <Text size="sm" c="dimmed">No scores yet</Text>
              </Stack>
            </Center>
          )}
        </Paper>

        {/* Overall stats */}
        <Paper radius="lg" p="lg" withBorder style={{ border: '1px solid #edf0f5' }}>
          <Group gap="xs" mb="lg">
            <ThemeIcon size={26} radius="xl" variant="light" color="indigo">
              <IconActivity size={14} />
            </ThemeIcon>
            <Text fw={600} size="sm">Overall Activity</Text>
          </Group>

          {analyticsLoading ? (
            <Stack gap="sm">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={44} radius="md" />)}
            </Stack>
          ) : analytics ? (
            <Stack gap="sm">
              <Paper radius="md" p="sm" style={{ background: '#f8f9fb' }}>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed" fw={500}>Total Sessions (all assignments)</Text>
                  <Text size="sm" fw={600}>{analytics.totalSessions}</Text>
                </Group>
              </Paper>
              <Paper radius="md" p="sm" style={{ background: '#f8f9fb' }}>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed" fw={500}>Completed</Text>
                  <Text size="sm" fw={600} c="teal.7">{analytics.completedSessions}</Text>
                </Group>
              </Paper>
              <Paper radius="md" p="sm" style={{ background: '#f8f9fb' }}>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed" fw={500}>Active</Text>
                  <Text size="sm" fw={600} c="yellow.7">{analytics.activeSessions}</Text>
                </Group>
              </Paper>
              {avgScore != null && (
                <Paper radius="md" p="sm" style={{ background: '#f8f9fb' }}>
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed" fw={500}>Average Score</Text>
                    <Group gap={4}>
                      <IconStarFilled size={12} style={{ color: `var(--mantine-color-${sColor}-5)` }} />
                      <Text size="sm" fw={600} c={`${sColor}.7`}>{avgScore.toFixed(1)}</Text>
                    </Group>
                  </Group>
                </Paper>
              )}
            </Stack>
          ) : (
            <Center py="lg">
              <Text size="sm" c="dimmed">Unable to load analytics</Text>
            </Center>
          )}
        </Paper>
      </SimpleGrid>

      {/* Session list for this assignment */}
      <Paper radius="lg" p="lg" withBorder style={{ border: '1px solid #edf0f5' }}>
        <Group gap="xs" mb="lg">
          <ThemeIcon size={26} radius="xl" variant="light" color="grape">
            <IconHash size={14} />
          </ThemeIcon>
          <Text fw={600} size="sm">Sessions for This Assignment</Text>
          <Badge variant="light" color="gray" size="sm" radius="xl">{sessions.length}</Badge>
        </Group>

        {sessions.length === 0 ? (
          <Center py="lg">
            <Text size="sm" c="dimmed">No sessions found</Text>
          </Center>
        ) : (
          <Stack gap="sm">
            {sessions
              .sort((a, b) => (b.startedAt > a.startedAt ? 1 : -1))
              .map((s) => (
                <SessionRow
                  key={s.sessionId}
                  session={s}
                  onClick={() => onSessionClick(s.sessionId)}
                />
              ))}
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}

/* ────────────────────────────────────────────── */
/*  Main Page                                     */
/* ────────────────────────────────────────────── */

export default function StudentsDataPage() {
  const navigate = useNavigate();

  const [assignments, setAssignments] = useState<AssignmentInfo[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(true);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);

  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [studentAnalytics, setStudentAnalytics] = useState<StudentAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const [emailMap, setEmailMap] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');

  // Load assignments and user email map on mount
  useEffect(() => {
    assignmentApi.list().then((data) => {
      const list = data.assignments || [];
      setAssignments(list.map((a: any) => ({
        assignmentId: a.assignmentId,
        title: a.title,
        mode: a.mode,
        status: a.status,
      })));
    }).catch(console.error).finally(() => setAssignmentsLoading(false));

    cognitoUserApi.list().then((res) => {
      const map: Record<string, string> = {};
      for (const u of res.users) {
        const sub = u.attributes?.sub;
        const email = u.attributes?.email;
        if (sub && email) map[sub] = email;
      }
      setEmailMap(map);
    }).catch((e) => console.error("Failed to load user emails:", e));
  }, []);

  // Load sessions when assignment changes
  useEffect(() => {
    if (!selectedAssignmentId) {
      setSessions([]);
      return;
    }
    setSessionsLoading(true);
    setSelectedStudentId(null);
    setStudentAnalytics(null);
    sessionApi.listByAssignment(selectedAssignmentId)
      .then((data) => setSessions(data.sessions || []))
      .catch(console.error)
      .finally(() => setSessionsLoading(false));
  }, [selectedAssignmentId]);

  // Load student analytics when a student is selected
  const handleSelectStudent = useCallback((studentId: string) => {
    setSelectedStudentId(studentId);
    setAnalyticsLoading(true);
    setStudentAnalytics(null);
    analyticsApi.student(studentId)
      .then(setStudentAnalytics)
      .catch(console.error)
      .finally(() => setAnalyticsLoading(false));
  }, []);

  // Group sessions by student
  const students = useMemo<StudentSummary[]>(() => {
    const map = new Map<string, SessionRecord[]>();
    for (const s of sessions) {
      const list = map.get(s.studentUserId) || [];
      list.push(s);
      map.set(s.studentUserId, list);
    }
    return Array.from(map.entries()).map(([userId, userSessions]) => ({
      studentUserId: userId,
      studentEmail: emailMap[userId],
      totalAttempts: userSessions.length,
      completedAttempts: userSessions.filter((s) => s.status === 'completed').length,
      latestDate: userSessions.reduce((latest, s) =>
        s.startedAt > latest ? s.startedAt : latest, userSessions[0].startedAt),
      sessions: userSessions,
    })).sort((a, b) => (b.latestDate > a.latestDate ? 1 : -1));
  }, [sessions, emailMap]);

  const filteredStudents = useMemo(() => {
    if (!search.trim()) return students;
    const q = search.toLowerCase();
    return students.filter((s) =>
      s.studentUserId.toLowerCase().includes(q) ||
      (s.studentEmail?.toLowerCase().includes(q) ?? false)
    );
  }, [students, search]);

  const uniqueStudents = students.length;
  const totalSessions = sessions.length;
  const completedSessions = sessions.filter((s) => s.status === 'completed').length;
  const completionRate = totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0;

  // Level 2: student detail view
  if (selectedStudentId) {
    const studentSessions = sessions.filter((s) => s.studentUserId === selectedStudentId);
    const selectedStudent = students.find((s) => s.studentUserId === selectedStudentId);
    return (
      <Stack gap="xl">
        <Box>
          <Group gap="sm" mb={4}>
            <ThemeIcon size={38} radius="xl" variant="gradient" gradient={{ from: 'blue', to: 'cyan' }}>
              <IconUser size={20} color="white" />
            </ThemeIcon>
            <Title order={2} fw={700}>Student Detail</Title>
          </Group>
        </Box>
        <StudentDetailView
          studentId={selectedStudentId}
          studentEmail={selectedStudent?.studentEmail}
          sessions={studentSessions}
          analytics={studentAnalytics}
          analyticsLoading={analyticsLoading}
          onBack={() => setSelectedStudentId(null)}
          onSessionClick={(sid) => navigate(`/student/session/${sid}/detail`)}
        />
      </Stack>
    );
  }

  // Level 1: main view
  if (assignmentsLoading) return <PageSkeleton />;

  return (
    <Stack gap="xl">
      {/* ── Header ── */}
      <Box>
        <Group gap="sm" mb={4}>
          <ThemeIcon size={38} radius="xl" variant="gradient" gradient={{ from: 'blue', to: 'cyan' }}>
            <IconUsers size={20} color="white" />
          </ThemeIcon>
          <Title order={2} fw={700}>Student Data</Title>
        </Group>
        <Text c="dimmed" size="sm" ml={52}>
          Select an assignment to view student activity and performance
        </Text>
      </Box>

      {/* ── Assignment selector ── */}
      <Select
        placeholder="Select an assignment..."
        data={assignments.map((a) => ({
          value: a.assignmentId,
          label: `${a.title} (${a.status})`,
        }))}
        value={selectedAssignmentId}
        onChange={setSelectedAssignmentId}
        radius="md"
        size="md"
        searchable
        clearable
        style={{ maxWidth: 480 }}
      />

      {/* No assignment selected */}
      {!selectedAssignmentId && (
        <EmptyState
          message="Select an assignment"
          sub="Choose an assignment above to see student participation, attempt counts, and performance data."
        />
      )}

      {/* Loading sessions */}
      {selectedAssignmentId && sessionsLoading && (
        <Stack gap="sm">
          {Array.from({ length: 4 }).map((_, i) => (
            <Paper key={i} radius="lg" p="md" withBorder>
              <Group gap="md">
                <Skeleton circle height={42} />
                <Box style={{ flex: 1 }}>
                  <Skeleton height={14} width="45%" mb={8} />
                  <Skeleton height={10} width="65%" />
                </Box>
              </Group>
            </Paper>
          ))}
        </Stack>
      )}

      {/* Assignment selected, data loaded */}
      {selectedAssignmentId && !sessionsLoading && (
        <>
          {/* Stats */}
          {students.length > 0 && (
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
              <StatCard
                label="Students"
                value={uniqueStudents}
                icon={IconUsers}
                color="blue"
                bgGradient="linear-gradient(135deg, #eef5ff 0%, #e0edff 100%)"
                borderColor="#c9deff"
              />
              <StatCard
                label="Sessions"
                value={totalSessions}
                icon={IconActivity}
                color="indigo"
                bgGradient="linear-gradient(135deg, #f0f4ff 0%, #e8ecff 100%)"
                borderColor="#dbe1ff"
              />
              <StatCard
                label="Completed"
                value={completedSessions}
                icon={IconCircleCheck}
                color="teal"
                bgGradient="linear-gradient(135deg, #f0fff4 0%, #e6ffed 100%)"
                borderColor="#c6f6d5"
              />
              <StatCard
                label="Rate"
                value={`${completionRate}%`}
                icon={IconTrophy}
                color="orange"
                bgGradient="linear-gradient(135deg, #fff7f0 0%, #fff0e6 100%)"
                borderColor="#ffdfc4"
              />
            </SimpleGrid>
          )}

          {/* Search */}
          {students.length > 0 && (
            <TextInput
              placeholder="Search by name or email..."
              leftSection={<IconSearch size={16} />}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              radius="xl"
              style={{ maxWidth: 360 }}
            />
          )}

          {/* Student list */}
          {students.length === 0 ? (
            <EmptyState
              message="No student data"
              sub="No students have started sessions for this assignment yet."
            />
          ) : filteredStudents.length === 0 ? (
            <Center style={{ minHeight: 160 }}>
              <Stack align="center" gap="sm">
                <ThemeIcon size={48} radius="xl" variant="light" color="gray">
                  <IconSearch size={24} />
                </ThemeIcon>
                <Text c="dimmed" size="sm">No students match your search</Text>
              </Stack>
            </Center>
          ) : (
            <Stack gap="sm">
              {filteredStudents.map((s) => (
                <StudentCard
                  key={s.studentUserId}
                  student={s}
                  onClick={() => handleSelectStudent(s.studentUserId)}
                />
              ))}
            </Stack>
          )}
        </>
      )}
    </Stack>
  );
}
