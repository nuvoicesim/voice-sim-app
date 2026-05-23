import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Text, Stack, Paper, Box, Group, Center, Select,
  ThemeIcon, Skeleton, Badge, SimpleGrid, Button, RingProgress,
  TextInput,
} from '@mantine/core';
import {
  IconUsers, IconInbox, IconSearch, IconChevronRight, IconArrowLeft,
  IconCalendar, IconCircleCheck, IconActivity, IconHash,
  IconClock, IconTrophy, IconStarFilled, IconMail, IconClipboardList,
} from '@tabler/icons-react';
import { assignmentApi } from '../../api/assignmentApi';
import { sessionApi } from '../../api/sessionApi';
import { analyticsApi } from '../../api/analyticsApi';
import { cognitoUserApi } from '../../api/cognitoUserApi';
import { surveyInstanceApi } from '../../api/surveyInstanceApi';
import { PageHeader, StatCard, SectionCard, EmptyState } from '../../components/design';

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

interface SurveyQuestion {
  id: string;
  type: 'likert' | 'choice_single' | 'choice_multi' | 'free_text';
  prompt: string;
  required?: boolean;
  config: any;
}

interface SurveyInstanceRecord {
  studentUserId: string;
  surveyInstanceId: string;
  surveyTemplateId: string;
  status: 'in_progress' | 'submitted';
  answers: Record<string, any>;
  startedAt: string;
  submittedAt: string | null;
  updatedAt: string;
}

interface SurveyGroup {
  moduleItemId: string;
  moduleItemTitle: string;
  itemType: 'survey' | 'debrief';
  position: number;
  surveyTemplateId: string | null;
  templateName: string | null;
  templateDescription: string | null;
  questions: SurveyQuestion[];
  instances: SurveyInstanceRecord[];
}

function formatAnswer(q: SurveyQuestion, raw: any): string {
  if (raw === undefined || raw === null || raw === '') return '—';
  if (q.type === 'likert') return String(raw);
  if (q.type === 'choice_single') {
    const opt = q.config?.options?.find((o: any) => o.value === raw);
    return opt?.label ?? String(raw);
  }
  if (q.type === 'choice_multi') {
    if (!Array.isArray(raw) || raw.length === 0) return '—';
    return raw
      .map((v) => q.config?.options?.find((o: any) => o.value === v)?.label ?? v)
      .join(', ');
  }
  return String(raw);
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

// All scores collapse to a single warm scale (terracotta for high, parchment for low)
function scoreToColor(score: number): string {
  if (score >= 75) return 'terracotta';
  return 'parchment';
}

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  active: { color: 'terracotta', label: 'Active' },
  completed: { color: 'terracotta', label: 'Completed' },
  abandoned: { color: 'parchment', label: 'Abandoned' },
};

function StudentCard({ student, onClick }: { student: StudentSummary; onClick: () => void }) {
  const email = student.studentEmail;
  const initial = (email || student.studentUserId).charAt(0).toUpperCase();
  const rate = student.totalAttempts > 0
    ? Math.round((student.completedAttempts / student.totalAttempts) * 100)
    : 0;

  return (
    <Paper
      radius="lg" p="md"
      style={{
        background: 'var(--claude-ivory)',
        border: '1px solid var(--claude-border-cream)',
        boxShadow: 'var(--claude-shadow-whisper)',
        cursor: 'pointer',
        transition: 'box-shadow 0.2s ease',
      }}
      onClick={onClick}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 0 0 1px var(--claude-terracotta), var(--claude-shadow-whisper)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'var(--claude-shadow-whisper)'; }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap="md" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
          <Box
            style={{
              width: 42, height: 42, borderRadius: '50%',
              background: 'var(--claude-terracotta)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            <Text fw={500} size="sm" c="var(--claude-ivory)" style={{ fontFamily: 'Georgia, serif' }}>
              {initial}
            </Text>
          </Box>
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Group gap={4}>
              <IconMail size={13} style={{ color: 'var(--claude-stone)' }} />
              <Text fw={500} size="sm" lineClamp={1} c="var(--claude-near-black)">
                {email || student.studentUserId}
              </Text>
            </Group>
            <Group gap="lg" mt={4}>
              <Group gap={4}>
                <IconActivity size={12} style={{ color: 'var(--claude-stone)' }} />
                <Text size="xs" c="var(--claude-olive)">{student.totalAttempts} attempts</Text>
              </Group>
              <Group gap={4}>
                <IconCircleCheck size={12} style={{ color: 'var(--claude-stone)' }} />
                <Text size="xs" c="var(--claude-olive)">{student.completedAttempts} completed</Text>
              </Group>
              <Group gap={4}>
                <IconCalendar size={12} style={{ color: 'var(--claude-stone)' }} />
                <Text size="xs" c="var(--claude-olive)">{formatRelativeDate(student.latestDate)}</Text>
              </Group>
            </Group>
          </Box>
        </Group>

        <Group gap="sm" wrap="nowrap" style={{ flexShrink: 0 }}>
          <Badge variant="light" color={rate >= 50 ? 'terracotta' : 'parchment'} size="sm" radius="xl">
            {rate}% done
          </Badge>
          <ThemeIcon size={28} radius="md" variant="light" color="parchment">
            <IconChevronRight size={14} />
          </ThemeIcon>
        </Group>
      </Group>
    </Paper>
  );
}

function SessionRow({ session, onClick }: { session: SessionRecord; onClick: () => void }) {
  const statusConf = STATUS_CONFIG[session.status] ?? STATUS_CONFIG.active;
  const duration = formatDuration(session.startedAt, session.endedAt);

  return (
    <Paper
      radius="md" p="sm"
      style={{
        background: 'var(--claude-parchment)',
        border: '1px solid var(--claude-border-cream)',
        cursor: 'pointer',
        transition: 'background 0.15s ease',
      }}
      onClick={onClick}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--claude-border-cream)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--claude-parchment)'; }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <ThemeIcon size={30} radius="md" variant="light" color="terracotta">
            <IconHash size={14} />
          </ThemeIcon>
          <Box style={{ minWidth: 0 }}>
            <Group gap="xs">
              <Text size="sm" fw={500} c="var(--claude-near-black)">Attempt {session.attemptNo}</Text>
              <Badge variant="dot" color={statusConf.color} size="xs" radius="xl">
                {statusConf.label}
              </Badge>
            </Group>
            <Group gap="lg" mt={2}>
              <Group gap={4}>
                <IconCalendar size={11} style={{ color: 'var(--claude-stone)' }} />
                <Text size="xs" c="var(--claude-olive)">
                  {new Date(session.startedAt).toLocaleString(undefined, {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </Text>
              </Group>
              <Group gap={4}>
                <IconClock size={11} style={{ color: 'var(--claude-stone)' }} />
                <Text size="xs" c="var(--claude-olive)">{duration}</Text>
              </Group>
            </Group>
          </Box>
        </Group>
        <IconChevronRight size={14} style={{ color: 'var(--claude-warm-silver)', flexShrink: 0 }} />
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
    </Stack>
  );
}

function StudentDetailView({
  studentId,
  studentEmail,
  sessions,
  surveys,
  analytics,
  analyticsLoading,
  onBack,
  onSessionClick,
}: {
  studentId: string;
  studentEmail?: string;
  sessions: SessionRecord[];
  surveys: SurveyGroup[];
  analytics: StudentAnalytics | null;
  analyticsLoading: boolean;
  onBack: () => void;
  onSessionClick: (sessionId: string) => void;
}) {
  const displayLabel = studentEmail || studentId;
  const initial = displayLabel.charAt(0).toUpperCase();
  const avgScore = analytics?.averageScore;
  const sColor = avgScore != null ? scoreToColor(avgScore) : 'parchment';

  return (
    <Stack gap="xl">
      <Box>
        <Button
          variant="subtle" color="parchment" size="xs" radius="xl" px="sm" mb="xs"
          leftSection={<IconArrowLeft size={14} />}
          onClick={onBack}
        >
          Back to Student List
        </Button>
        <Group gap="md">
          <Box
            style={{
              width: 48, height: 48, borderRadius: '50%',
              background: 'var(--claude-terracotta)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            <Text fw={500} size="md" c="var(--claude-ivory)" style={{ fontFamily: 'Georgia, serif' }}>
              {initial}
            </Text>
          </Box>
          <Box>
            <Text fw={500} c="var(--claude-near-black)" style={{ fontFamily: 'Georgia, serif', fontSize: '1.5rem', lineHeight: 1.2 }}>
              {displayLabel}
            </Text>
            <Text size="sm" c="var(--claude-olive)">
              {sessions.length} session{sessions.length !== 1 ? 's' : ''} for this assignment
            </Text>
          </Box>
        </Group>
      </Box>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <SectionCard
          title={
            <Group gap="xs">
              <ThemeIcon size={26} radius="md" variant="light" color="terracotta">
                <IconTrophy size={14} />
              </ThemeIcon>
              <Text fw={500} size="md" c="var(--claude-near-black)">Performance</Text>
            </Group>
          }
        >
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
                    <Text fw={500} size="xl" c="var(--claude-near-black)" style={{ fontFamily: 'Georgia, serif' }}>
                      {Math.round(avgScore)}
                    </Text>
                    <Text size="xs" c="var(--claude-olive)">avg score</Text>
                  </Stack>
                }
              />
              {analytics!.recentScores.length > 0 && (
                <Group gap={4} justify="center">
                  <Text size="xs" c="var(--claude-stone)">Recent:</Text>
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
                <ThemeIcon size={40} radius="md" variant="light" color="parchment">
                  <IconTrophy size={20} />
                </ThemeIcon>
                <Text size="sm" c="var(--claude-stone)">No scores yet</Text>
              </Stack>
            </Center>
          )}
        </SectionCard>

        <SectionCard
          title={
            <Group gap="xs">
              <ThemeIcon size={26} radius="md" variant="light" color="terracotta">
                <IconActivity size={14} />
              </ThemeIcon>
              <Text fw={500} size="md" c="var(--claude-near-black)">Overall Activity</Text>
            </Group>
          }
        >
          {analyticsLoading ? (
            <Stack gap="sm">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={44} radius="md" />)}
            </Stack>
          ) : analytics ? (
            <Stack gap="sm">
              <Paper radius="md" p="sm" style={{ background: 'var(--claude-parchment)' }}>
                <Group justify="space-between">
                  <Text size="xs" c="var(--claude-olive)" fw={500}>Total Sessions (all assignments)</Text>
                  <Text size="sm" fw={500} c="var(--claude-near-black)">{analytics.totalSessions}</Text>
                </Group>
              </Paper>
              <Paper radius="md" p="sm" style={{ background: 'var(--claude-parchment)' }}>
                <Group justify="space-between">
                  <Text size="xs" c="var(--claude-olive)" fw={500}>Completed</Text>
                  <Text size="sm" fw={500} c="var(--claude-terracotta)">{analytics.completedSessions}</Text>
                </Group>
              </Paper>
              <Paper radius="md" p="sm" style={{ background: 'var(--claude-parchment)' }}>
                <Group justify="space-between">
                  <Text size="xs" c="var(--claude-olive)" fw={500}>Active</Text>
                  <Text size="sm" fw={500} c="var(--claude-charcoal)">{analytics.activeSessions}</Text>
                </Group>
              </Paper>
              {avgScore != null && (
                <Paper radius="md" p="sm" style={{ background: 'var(--claude-parchment)' }}>
                  <Group justify="space-between">
                    <Text size="xs" c="var(--claude-olive)" fw={500}>Average Score</Text>
                    <Group gap={4}>
                      <IconStarFilled size={12} style={{ color: 'var(--claude-terracotta)' }} />
                      <Text size="sm" fw={500} c="var(--claude-terracotta)">{avgScore.toFixed(1)}</Text>
                    </Group>
                  </Group>
                </Paper>
              )}
            </Stack>
          ) : (
            <Center py="lg">
              <Text size="sm" c="var(--claude-stone)">Unable to load analytics</Text>
            </Center>
          )}
        </SectionCard>
      </SimpleGrid>

      <SectionCard
        title={
          <Group gap="xs">
            <ThemeIcon size={26} radius="md" variant="light" color="terracotta">
              <IconHash size={14} />
            </ThemeIcon>
            <Text fw={500} size="md" c="var(--claude-near-black)">Sessions for This Assignment</Text>
            <Badge variant="light" color="parchment" size="sm" radius="xl">{sessions.length}</Badge>
          </Group>
        }
      >
        {sessions.length === 0 ? (
          <Center py="lg">
            <Text size="sm" c="var(--claude-stone)">No sessions found</Text>
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
      </SectionCard>

      <StudentSurveyAnswers surveys={surveys} studentUserId={studentId} />
    </Stack>
  );
}

function SurveyOverviewSection({
  surveys,
  totalStudents,
}: {
  surveys: SurveyGroup[];
  totalStudents: number;
}) {
  if (surveys.length === 0) return null;
  return (
    <SectionCard
      title={
        <Group gap="xs">
          <ThemeIcon size={26} radius="md" variant="light" color="terracotta">
            <IconClipboardList size={14} />
          </ThemeIcon>
          <Text fw={500} size="md" c="var(--claude-near-black)">Survey Completion</Text>
          <Badge variant="light" color="parchment" size="sm" radius="xl">{surveys.length}</Badge>
        </Group>
      }
    >
      <Stack gap="sm">
        {surveys.map((s) => {
          const submitted = s.instances.filter((i) => i.status === 'submitted').length;
          const started = s.instances.length;
          const rate = totalStudents > 0 ? Math.round((submitted / totalStudents) * 100) : 0;
          return (
            <Paper
              key={s.moduleItemId}
              radius="md"
              p="sm"
              style={{ background: 'var(--claude-parchment)', border: '1px solid var(--claude-border-cream)' }}
            >
              <Group justify="space-between" wrap="nowrap">
                <Box style={{ minWidth: 0 }}>
                  <Group gap="xs">
                    <Text size="sm" fw={500} c="var(--claude-near-black)" lineClamp={1}>
                      {s.moduleItemTitle}
                    </Text>
                    <Badge size="xs" variant="light" color="parchment" radius="xl">
                      {s.itemType}
                    </Badge>
                  </Group>
                  <Group gap="lg" mt={4}>
                    <Text size="xs" c="var(--claude-olive)">
                      {submitted} submitted
                    </Text>
                    <Text size="xs" c="var(--claude-olive)">
                      {started - submitted} in progress
                    </Text>
                    <Text size="xs" c="var(--claude-olive)">
                      {s.questions.length} question{s.questions.length !== 1 ? 's' : ''}
                    </Text>
                  </Group>
                </Box>
                <Badge variant="light" color={rate >= 50 ? 'terracotta' : 'parchment'} size="sm" radius="xl">
                  {rate}%
                </Badge>
              </Group>
            </Paper>
          );
        })}
      </Stack>
    </SectionCard>
  );
}

function StudentSurveyAnswers({
  surveys,
  studentUserId,
}: {
  surveys: SurveyGroup[];
  studentUserId: string;
}) {
  if (surveys.length === 0) return null;
  return (
    <SectionCard
      title={
        <Group gap="xs">
          <ThemeIcon size={26} radius="md" variant="light" color="terracotta">
            <IconClipboardList size={14} />
          </ThemeIcon>
          <Text fw={500} size="md" c="var(--claude-near-black)">Survey Answers</Text>
          <Badge variant="light" color="parchment" size="sm" radius="xl">{surveys.length}</Badge>
        </Group>
      }
    >
      <Stack gap="md">
        {surveys.map((s) => {
          const instance = s.instances.find((i) => i.studentUserId === studentUserId);
          const submittedLabel = instance?.submittedAt
            ? `Submitted ${new Date(instance.submittedAt).toLocaleString()}`
            : instance
              ? `In progress (last updated ${new Date(instance.updatedAt).toLocaleString()})`
              : 'Not started';
          return (
            <Paper
              key={s.moduleItemId}
              radius="md"
              p="md"
              style={{ background: 'var(--claude-parchment)', border: '1px solid var(--claude-border-cream)' }}
            >
              <Group justify="space-between" wrap="nowrap" mb="xs">
                <Group gap="xs" style={{ minWidth: 0 }}>
                  <Text size="sm" fw={500} c="var(--claude-near-black)" lineClamp={1}>
                    {s.moduleItemTitle}
                  </Text>
                  <Badge size="xs" variant="light" color="parchment" radius="xl">
                    {s.itemType}
                  </Badge>
                </Group>
                <Badge
                  size="sm"
                  variant="light"
                  color={instance?.status === 'submitted' ? 'terracotta' : 'parchment'}
                  radius="xl"
                >
                  {instance?.status === 'submitted' ? 'Submitted' : instance ? 'In progress' : 'Not started'}
                </Badge>
              </Group>
              <Text size="xs" c="var(--claude-olive)" mb="sm">
                {submittedLabel}
              </Text>
              {!instance ? (
                <Text size="sm" c="var(--claude-stone)">
                  This student has not opened this survey.
                </Text>
              ) : s.questions.length === 0 ? (
                <Text size="sm" c="var(--claude-stone)">
                  Schema unavailable — raw answers: {JSON.stringify(instance.answers)}
                </Text>
              ) : (
                <Stack gap="xs">
                  {s.questions.map((q, idx) => (
                    <Box key={q.id}>
                      <Text size="xs" c="var(--claude-olive)" fw={500}>
                        Q{idx + 1}. {q.prompt}
                      </Text>
                      <Text size="sm" c="var(--claude-near-black)" style={{ whiteSpace: 'pre-wrap' }}>
                        {formatAnswer(q, instance.answers[q.id])}
                      </Text>
                    </Box>
                  ))}
                </Stack>
              )}
            </Paper>
          );
        })}
      </Stack>
    </SectionCard>
  );
}

export default function StudentsDataPage() {
  const navigate = useNavigate();

  const [assignments, setAssignments] = useState<AssignmentInfo[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(true);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);

  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const [surveys, setSurveys] = useState<SurveyGroup[]>([]);
  const [surveysLoading, setSurveysLoading] = useState(false);

  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [studentAnalytics, setStudentAnalytics] = useState<StudentAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const [emailMap, setEmailMap] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');

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

  useEffect(() => {
    if (!selectedAssignmentId) {
      setSessions([]);
      setSurveys([]);
      return;
    }
    setSessionsLoading(true);
    setSurveysLoading(true);
    setSelectedStudentId(null);
    setStudentAnalytics(null);
    sessionApi.listByAssignment(selectedAssignmentId)
      .then((data) => setSessions(data.sessions || []))
      .catch(console.error)
      .finally(() => setSessionsLoading(false));
    surveyInstanceApi.listByAssignment(selectedAssignmentId)
      .then((data: any) => setSurveys(data.surveys || []))
      .catch((e) => {
        console.error('Failed to load surveys:', e);
        setSurveys([]);
      })
      .finally(() => setSurveysLoading(false));
  }, [selectedAssignmentId]);

  const handleSelectStudent = useCallback((studentId: string) => {
    setSelectedStudentId(studentId);
    setAnalyticsLoading(true);
    setStudentAnalytics(null);
    analyticsApi.student(studentId)
      .then(setStudentAnalytics)
      .catch(console.error)
      .finally(() => setAnalyticsLoading(false));
  }, []);

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

  if (selectedStudentId) {
    const studentSessions = sessions.filter((s) => s.studentUserId === selectedStudentId);
    const selectedStudent = students.find((s) => s.studentUserId === selectedStudentId);
    return (
      <Stack gap="xl">
        <PageHeader title="Student Detail" />
        <StudentDetailView
          studentId={selectedStudentId}
          studentEmail={selectedStudent?.studentEmail}
          sessions={studentSessions}
          surveys={surveys}
          analytics={studentAnalytics}
          analyticsLoading={analyticsLoading}
          onBack={() => setSelectedStudentId(null)}
          onSessionClick={(sid) => navigate(`/student/session/${sid}/detail`)}
        />
      </Stack>
    );
  }

  if (assignmentsLoading) return <PageSkeleton />;

  return (
    <Stack gap="xl">
      <PageHeader
        title="Student Data"
        subtitle="Select an assignment to view student activity and performance"
      />

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

      {!selectedAssignmentId && (
        <EmptyState
          icon={<IconInbox size={28} />}
          title="Select an assignment"
          description="Choose an assignment above to see student participation, attempt counts, and performance data."
        />
      )}

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

      {selectedAssignmentId && !sessionsLoading && (
        <>
          {students.length > 0 && (
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
              <StatCard label="Students" value={uniqueStudents} icon={<IconUsers size={22} />} />
              <StatCard label="Sessions" value={totalSessions} icon={<IconActivity size={22} />} accent="parchment" />
              <StatCard label="Completed" value={completedSessions} icon={<IconCircleCheck size={22} />} />
              <StatCard label="Rate" value={`${completionRate}%`} icon={<IconTrophy size={22} />} />
            </SimpleGrid>
          )}

          {surveysLoading ? (
            <Skeleton height={120} radius="lg" />
          ) : (
            <SurveyOverviewSection surveys={surveys} totalStudents={uniqueStudents} />
          )}

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

          {students.length === 0 ? (
            <EmptyState
              icon={<IconInbox size={28} />}
              title="No student data"
              description="No students have started sessions for this assignment yet."
            />
          ) : filteredStudents.length === 0 ? (
            <Center style={{ minHeight: 160 }}>
              <Stack align="center" gap="sm">
                <ThemeIcon size={48} radius="md" variant="light" color="parchment">
                  <IconSearch size={24} />
                </ThemeIcon>
                <Text c="var(--claude-stone)" size="sm">No students match your search</Text>
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
