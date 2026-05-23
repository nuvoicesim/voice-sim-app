import { useEffect, useState, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
  Text, Badge, Button, Center, Stack, Group,
  Paper, TextInput, SegmentedControl, SimpleGrid, Box, Alert,
  ThemeIcon, Skeleton,
} from '@mantine/core';
import {
  IconSearch, IconBook2, IconClipboardCheck,
  IconCalendar, IconRepeat, IconInbox, IconPlayerPlay, IconAlertCircle, IconBook,
} from '@tabler/icons-react';
import { fetchAssignments, selectAssignments, selectAssignmentsLoading } from '../../slices/assignmentSlice';
import { startSession } from '../../slices/sessionSlice';
import { fetchCourses, selectCourses } from '../../slices/courseSlice';
import type { AppDispatch } from '../../store';
import type { Assignment } from '../../slices/assignmentSlice';
import { PageHeader, StatCard, EmptyState as EmptyStateCmp } from '../../components/design';

const MODE_CONFIG: Record<string, { color: string; icon: typeof IconBook2; label: string }> = {
  practice: { color: 'parchment', icon: IconBook2, label: 'Practice' },
  assessment: { color: 'terracotta', icon: IconClipboardCheck, label: 'Assessment' },
};

function getRelativeDue(dateStr: string): { text: string; urgent: boolean } {
  const now = new Date();
  const due = new Date(dateStr);
  const diffMs = due.getTime() - now.getTime();
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (days < 0) return { text: `Overdue by ${Math.abs(days)}d`, urgent: true };
  if (days === 0) return { text: 'Due today', urgent: true };
  if (days === 1) return { text: 'Due tomorrow', urgent: true };
  if (days <= 3) return { text: `${days} days left`, urgent: true };
  if (days <= 7) return { text: `${days} days left`, urgent: false };
  return {
    text: due.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    urgent: false,
  };
}

function AssignmentCard({
  assignment,
  onLaunch,
  launching,
  courseTitle,
}: {
  assignment: Assignment;
  onLaunch: (assignmentId: string) => void;
  launching: string | null;
  courseTitle?: string;
}) {
  const modeConf = MODE_CONFIG[assignment.mode] ?? MODE_CONFIG.practice;
  const ModeIcon = modeConf.icon;
  const dueInfo = assignment.dueDate ? getRelativeDue(assignment.dueDate) : null;
  const isLaunching = launching === assignment.assignmentId;

  return (
    <Paper
      radius="lg"
      p={0}
      style={{
        overflow: 'hidden',
        background: 'var(--claude-ivory)',
        border: '1px solid var(--claude-border-cream)',
        boxShadow: 'var(--claude-shadow-whisper)',
        transition: 'box-shadow 0.2s ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 0 0 1px var(--claude-terracotta), var(--claude-shadow-whisper)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'var(--claude-shadow-whisper)'; }}
    >
      <Box p="lg">
        <Group justify="space-between" align="flex-start" mb="sm">
          <Group gap="sm" align="flex-start" style={{ flex: 1, minWidth: 0 }}>
            <ThemeIcon size={44} radius="md" variant="light" color={modeConf.color}>
              <ModeIcon size={22} />
            </ThemeIcon>
            <Box style={{ flex: 1, minWidth: 0 }}>
              {courseTitle && (
                <Box
                  mb={8}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 10px',
                    borderRadius: 999,
                    background: 'var(--claude-border-cream)',
                    border: '1px solid var(--claude-border-warm)',
                    maxWidth: '100%',
                  }}
                >
                  <IconBook size={13} style={{ color: 'var(--claude-terracotta)', flexShrink: 0 }} />
                  <Text size="xs" c="var(--claude-charcoal)" fw={500} lineClamp={1} style={{ letterSpacing: 0.2 }}>
                    {courseTitle}
                  </Text>
                </Box>
              )}
              <Text fw={500} size="md" lineClamp={1} c="var(--claude-near-black)" style={{ fontFamily: 'Georgia, serif' }}>
                {assignment.title}
              </Text>
              {assignment.description && (
                <Text size="xs" c="var(--claude-olive)" lineClamp={2} mt={4} style={{ lineHeight: 1.6 }}>
                  {assignment.description}
                </Text>
              )}
            </Box>
          </Group>
          <Badge variant="light" color={modeConf.color} size="sm" radius="xl" style={{ flexShrink: 0 }}>
            {modeConf.label}
          </Badge>
        </Group>

        <Box mb="md" p="sm" style={{ background: 'var(--claude-parchment)', borderRadius: 10 }}>
          <Group gap="lg">
            {dueInfo && (
              <Group gap={6}>
                <IconCalendar size={14} style={{ color: dueInfo.urgent ? 'var(--claude-terracotta)' : 'var(--claude-stone)' }} />
                <Text size="xs" fw={500} c={dueInfo.urgent ? 'var(--claude-terracotta)' : 'var(--claude-olive)'}>
                  {dueInfo.text}
                </Text>
              </Group>
            )}
            {!dueInfo && (
              <Group gap={6}>
                <IconCalendar size={14} style={{ color: 'var(--claude-warm-silver)' }} />
                <Text size="xs" c="var(--claude-stone)">No deadline</Text>
              </Group>
            )}
            <Group gap={6}>
              <IconRepeat size={14} style={{ color: 'var(--claude-stone)' }} />
              <Text size="xs" c="var(--claude-olive)">
                {assignment.attemptPolicy?.maxAttempts === -1
                  ? 'Unlimited'
                  : `${assignment.attemptPolicy?.maxAttempts} attempts`}
              </Text>
            </Group>
          </Group>
        </Box>

        <Button
          fullWidth
          variant="filled"
          color="terracotta"
          radius="md"
          size="sm"
          rightSection={<IconPlayerPlay size={16} />}
          onClick={() => onLaunch(assignment.assignmentId)}
          loading={isLaunching}
        >
          Launch Simulation
        </Button>
      </Box>
    </Paper>
  );
}

function LoadingSkeleton() {
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
      {Array.from({ length: 6 }).map((_, i) => (
        <Paper key={i} radius="lg" withBorder style={{ overflow: 'hidden' }}>
          <Box p="lg">
            <Group mb="sm">
              <Skeleton circle height={44} />
              <Box style={{ flex: 1 }}>
                <Skeleton height={14} width="65%" mb={8} />
                <Skeleton height={10} width="85%" />
              </Box>
            </Group>
            <Skeleton height={48} radius={10} mb="md" />
            <Skeleton height={36} radius="md" />
          </Box>
        </Paper>
      ))}
    </SimpleGrid>
  );
}

export default function AssignmentsPage() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const assignments = useSelector(selectAssignments);
  const courses = useSelector(selectCourses);
  const loading = useSelector(selectAssignmentsLoading);
  const [search, setSearch] = useState('');
  const [modeFilter, setModeFilter] = useState('all');
  const [launching, setLaunching] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);

  useEffect(() => {
    dispatch(fetchAssignments({ status: 'published' }));
    dispatch(fetchCourses());
  }, [dispatch]);

  const courseTitleByCourseId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of courses) map[c.courseId] = c.title;
    return map;
  }, [courses]);

  const filtered = useMemo(() => {
    let list = assignments;
    if (modeFilter !== 'all') {
      list = list.filter((a) => a.mode === modeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) => a.title.toLowerCase().includes(q) || a.description?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [assignments, modeFilter, search]);

  const handleLaunch = async (assignmentId: string) => {
    setLaunching(assignmentId);
    setLaunchError(null);
    try {
      const result = await dispatch(startSession(assignmentId)).unwrap();
      const sessionId = result.session.sessionId;
      navigate(`/student/session/${sessionId}`, {
        state: {
          unityLaunchUrl: result.session.unityLaunchUrl || null,
        },
      });
    } catch (error) {
      setLaunchError(error instanceof Error ? error.message : 'Failed to launch simulation');
    } finally {
      setLaunching(null);
    }
  };

  const practiceCount = assignments.filter((a) => a.mode === 'practice').length;
  const assessmentCount = assignments.filter((a) => a.mode === 'assessment').length;

  return (
    <Stack gap="xl">
      <PageHeader
        title="My Assignments"
        subtitle="Launch simulations and track your learning progress"
      />

      {launchError && (
        <Alert color="terracotta" radius="md" icon={<IconAlertCircle size={16} />}>
          {launchError}
        </Alert>
      )}

      {/* ── Stats overview ── */}
      {!loading && assignments.length > 0 && (
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
          <StatCard label="Total" value={assignments.length} icon={<IconBook2 size={22} />} />
          <StatCard label="Practice" value={practiceCount} icon={<IconBook2 size={22} />} accent="parchment" />
          <StatCard label="Assessment" value={assessmentCount} icon={<IconClipboardCheck size={22} />} />
        </SimpleGrid>
      )}

      {/* ── Search & filter ── */}
      {!loading && assignments.length > 0 && (
        <Group gap="md" wrap="wrap">
          <TextInput
            placeholder="Search assignments..."
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
              { label: `All (${assignments.length})`, value: 'all' },
              { label: `Practice (${practiceCount})`, value: 'practice' },
              { label: `Assessment (${assessmentCount})`, value: 'assessment' },
            ]}
          />
        </Group>
      )}

      {/* ── Content ── */}
      {loading ? (
        <LoadingSkeleton />
      ) : assignments.length === 0 ? (
        <EmptyStateCmp
          icon={<IconInbox size={28} />}
          title="No assignments yet"
          description="When your instructor publishes new assignments, they will appear here. Check back soon!"
        />
      ) : filtered.length === 0 ? (
        <Center style={{ minHeight: 240 }}>
          <Stack align="center" gap="sm">
            <ThemeIcon size={52} radius="lg" variant="light" color="parchment">
              <IconSearch size={26} />
            </ThemeIcon>
            <Text c="var(--claude-stone)" size="sm">No assignments match your filters</Text>
          </Stack>
        </Center>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
          {filtered.map((a) => (
            <AssignmentCard
              key={a.assignmentId}
              assignment={a}
              onLaunch={handleLaunch}
              launching={launching}
              courseTitle={a.courseId ? courseTitleByCourseId[a.courseId] : undefined}
            />
          ))}
        </SimpleGrid>
      )}
    </Stack>
  );
}
