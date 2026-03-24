import { useEffect, useState, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
  Title, Text, Badge, Button, Center, Stack, Group,
  Paper, TextInput, SegmentedControl, SimpleGrid, Box,
  ThemeIcon, Skeleton,
} from '@mantine/core';
import {
  IconSearch, IconRocket, IconBook2, IconClipboardCheck,
  IconCalendar, IconRepeat, IconInbox, IconPlayerPlay,
} from '@tabler/icons-react';
import { fetchAssignments, selectAssignments, selectAssignmentsLoading } from '../../slices/assignmentSlice';
import { startSession } from '../../slices/sessionSlice';
import { sceneCatalogApi } from '../../api/sceneCatalogApi';
import type { AppDispatch } from '../../store';
import type { Assignment } from '../../slices/assignmentSlice';

interface SceneInfo {
  sceneId: string;
  unityBuildFolder?: string;
}

const MODE_CONFIG: Record<string, {
  color: string;
  gradient: string;
  icon: typeof IconBook2;
  label: string;
}> = {
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
}: {
  assignment: Assignment;
  onLaunch: (assignmentId: string, sceneId: string) => void;
  launching: string | null;
}) {
  const modeConf = MODE_CONFIG[assignment.mode] ?? MODE_CONFIG.practice;
  const ModeIcon = modeConf.icon;
  const dueInfo = assignment.dueDate ? getRelativeDue(assignment.dueDate) : null;
  const isLaunching = launching === assignment.assignmentId;

  return (
    <Paper
      shadow="sm"
      radius="lg"
      p={0}
      withBorder
      style={{
        overflow: 'hidden',
        transition: 'box-shadow 0.2s ease, transform 0.2s ease',
        border: '1px solid #edf0f5',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 8px 30px rgba(0,0,0,0.08)';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = '';
        e.currentTarget.style.transform = '';
      }}
    >
      <Box style={{ height: 4, background: modeConf.gradient }} />

      <Box p="lg">
        <Group justify="space-between" align="flex-start" mb="sm">
          <Group gap="sm" align="flex-start" style={{ flex: 1, minWidth: 0 }}>
            <ThemeIcon size={44} radius="xl" variant="light" color={modeConf.color}>
              <ModeIcon size={22} />
            </ThemeIcon>
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Text fw={600} size="md" lineClamp={1}>{assignment.title}</Text>
              {assignment.description && (
                <Text size="xs" c="dimmed" lineClamp={2} mt={2} style={{ lineHeight: 1.5 }}>
                  {assignment.description}
                </Text>
              )}
            </Box>
          </Group>
          <Badge variant="light" color={modeConf.color} size="sm" radius="xl" style={{ flexShrink: 0 }}>
            {modeConf.label}
          </Badge>
        </Group>

        <Box
          mb="md"
          p="sm"
          style={{ background: '#f8f9fb', borderRadius: 10 }}
        >
          <Group gap="lg">
            {dueInfo && (
              <Group gap={6}>
                <IconCalendar
                  size={14}
                  style={{ color: dueInfo.urgent ? 'var(--mantine-color-red-6)' : 'var(--mantine-color-gray-5)' }}
                />
                <Text size="xs" fw={500} c={dueInfo.urgent ? 'red.6' : 'dimmed'}>
                  {dueInfo.text}
                </Text>
              </Group>
            )}
            {!dueInfo && (
              <Group gap={6}>
                <IconCalendar size={14} style={{ color: 'var(--mantine-color-gray-4)' }} />
                <Text size="xs" c="dimmed">No deadline</Text>
              </Group>
            )}
            <Group gap={6}>
              <IconRepeat size={14} style={{ color: 'var(--mantine-color-gray-5)' }} />
              <Text size="xs" c="dimmed">
                {assignment.attemptPolicy?.maxAttempts === -1
                  ? 'Unlimited'
                  : `${assignment.attemptPolicy?.maxAttempts} attempts`}
              </Text>
            </Group>
          </Group>
        </Box>

        <Button
          fullWidth
          variant="light"
          color="indigo"
          radius="md"
          size="sm"
          rightSection={<IconPlayerPlay size={16} />}
          onClick={() => onLaunch(assignment.assignmentId, assignment.sceneId)}
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
        <Paper key={i} shadow="sm" radius="lg" withBorder style={{ overflow: 'hidden' }}>
          <Skeleton height={4} radius={0} />
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
          <IconInbox size={44} style={{ color: '#9ba3c2' }} />
        </Box>
        <Box style={{ textAlign: 'center' }}>
          <Title order={4} c="dark.4" mb={4}>No assignments yet</Title>
          <Text c="dimmed" size="sm" maw={300} style={{ lineHeight: 1.6 }}>
            When your instructor publishes new assignments, they will appear here. Check back soon!
          </Text>
        </Box>
      </Stack>
    </Center>
  );
}

function NoResultsState() {
  return (
    <Center style={{ minHeight: 240 }}>
      <Stack align="center" gap="sm">
        <ThemeIcon size={52} radius="xl" variant="light" color="gray">
          <IconSearch size={26} />
        </ThemeIcon>
        <Text c="dimmed" size="sm">No assignments match your filters</Text>
      </Stack>
    </Center>
  );
}

export default function AssignmentsPage() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const assignments = useSelector(selectAssignments);
  const loading = useSelector(selectAssignmentsLoading);
  const [sceneMap, setSceneMap] = useState<Record<string, SceneInfo>>({});
  const [search, setSearch] = useState('');
  const [modeFilter, setModeFilter] = useState('all');
  const [launching, setLaunching] = useState<string | null>(null);

  useEffect(() => {
    dispatch(fetchAssignments({ status: 'published' }));
    sceneCatalogApi.list().then((data) => {
      const scenes = data.scenes || data.Items || [];
      const map: Record<string, SceneInfo> = {};
      for (const s of scenes) {
        map[s.sceneId] = { sceneId: s.sceneId, unityBuildFolder: s.unityBuildFolder };
      }
      setSceneMap(map);
    }).catch(() => {});
  }, [dispatch]);

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

  const handleLaunch = async (assignmentId: string, sceneId: string) => {
    setLaunching(assignmentId);
    try {
      const result = await dispatch(startSession(assignmentId));
      if (startSession.fulfilled.match(result)) {
        const sessionId = result.payload.session.sessionId;
        const scene = sceneMap[sceneId];
        navigate(`/student/session/${sessionId}`, {
          state: { unityBuildFolder: scene?.unityBuildFolder || null },
        });
      }
    } finally {
      setLaunching(null);
    }
  };

  const practiceCount = assignments.filter((a) => a.mode === 'practice').length;
  const assessmentCount = assignments.filter((a) => a.mode === 'assessment').length;

  return (
    <Stack gap="xl">
      {/* ── Page header ── */}
      <Box>
        <Group gap="sm" mb={4}>
          <ThemeIcon size={38} radius="xl" variant="gradient" gradient={{ from: 'indigo', to: 'violet' }}>
            <IconRocket size={20} color="white" />
          </ThemeIcon>
          <Title order={2} fw={700}>My Assignments</Title>
        </Group>
        <Text c="dimmed" size="sm" ml={52}>
          Launch simulations and track your learning progress
        </Text>
      </Box>

      {/* ── Stats overview ── */}
      {!loading && assignments.length > 0 && (
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
          <Paper
            radius="lg"
            p="md"
            style={{
              background: 'linear-gradient(135deg, #f0f4ff 0%, #e8ecff 100%)',
              border: '1px solid #dbe1ff',
            }}
          >
            <Group justify="space-between" align="center">
              <Box>
                <Text size="xs" c="dimmed" fw={600} style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
                  Total
                </Text>
                <Title order={2} c="indigo.7" mt={2}>{assignments.length}</Title>
              </Box>
              <ThemeIcon size={42} radius="xl" variant="light" color="indigo">
                <IconBook2 size={22} />
              </ThemeIcon>
            </Group>
          </Paper>

          <Paper
            radius="lg"
            p="md"
            style={{
              background: 'linear-gradient(135deg, #eef5ff 0%, #e0edff 100%)',
              border: '1px solid #c9deff',
            }}
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
            radius="lg"
            p="md"
            style={{
              background: 'linear-gradient(135deg, #fff7f0 0%, #fff0e6 100%)',
              border: '1px solid #ffdfc4',
            }}
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
        <EmptyState />
      ) : filtered.length === 0 ? (
        <NoResultsState />
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
          {filtered.map((a) => (
            <AssignmentCard
              key={a.assignmentId}
              assignment={a}
              onLaunch={handleLaunch}
              launching={launching}
            />
          ))}
        </SimpleGrid>
      )}
    </Stack>
  );
}
