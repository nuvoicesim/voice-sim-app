import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import {
  Title, Text, Button, Stack, Group, Badge, Box,
  Paper, ThemeIcon, Skeleton,
} from '@mantine/core';
import {
  IconPlayerStop, IconChartBar,
  IconBook2, IconClipboardCheck, IconHash, IconCircleFilled,
} from '@tabler/icons-react';
import { fetchSession, completeSession, selectCurrentSession, selectSessionsLoading } from '../../slices/sessionSlice';
import type { AppDispatch } from '../../store';

const DEFAULT_UNITY_FOLDER = 'broca-aphasia-webgl';

function buildUnityPath(folder: string) {
  return `/unity/${folder}/index.html`;
}

const MODE_CONFIG: Record<string, { color: string; icon: typeof IconBook2; label: string }> = {
  practice: { color: 'blue', icon: IconBook2, label: 'Practice' },
  assessment: { color: 'orange', icon: IconClipboardCheck, label: 'Assessment' },
};

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  active: { color: 'green', label: 'In Progress' },
  completed: { color: 'blue', label: 'Completed' },
  abandoned: { color: 'gray', label: 'Abandoned' },
};

function LoadingSkeleton() {
  return (
    <Stack gap="md" style={{ height: 'calc(100vh - 120px)' }}>
      <Paper radius="lg" p="md" withBorder>
        <Group justify="space-between">
          <Group gap="md">
            <Skeleton circle height={44} />
            <Box>
              <Skeleton height={18} width={200} mb={8} />
              <Skeleton height={12} width={280} />
            </Box>
          </Group>
          <Skeleton height={36} width={120} radius="md" />
        </Group>
      </Paper>
      <Skeleton style={{ flex: 1, minHeight: 500 }} radius="lg" />
    </Stack>
  );
}

export default function SessionRunner() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = location.state as { unityBuildFolder?: string } | null;
  const session = useSelector(selectCurrentSession);
  const loading = useSelector(selectSessionsLoading);

  const [scoring, setScoring] = useState(false);

  useEffect(() => {
    if (sessionId) dispatch(fetchSession(sessionId));
  }, [sessionId, dispatch]);

  const handleScoreAndComplete = async () => {
    if (!session || scoring) return;
    setScoring(true);
    try {
      await dispatch(completeSession(session.sessionId));
    } catch (err) {
      console.error('Complete session error:', err);
    } finally {
      setScoring(false);
    }
  };

  const handleViewResults = () => {
    if (sessionId) navigate(`/student/session/${sessionId}/detail`);
  };

  if (loading || !session) return <LoadingSkeleton />;

  const isActive = session.status === 'active';
  const modeConf = MODE_CONFIG[session.mode] ?? MODE_CONFIG.practice;
  const statusConf = STATUS_CONFIG[session.status] ?? STATUS_CONFIG.active;
  const ModeIcon = modeConf.icon;

  return (
    <Stack gap="md" style={{ height: 'calc(100vh - 120px)' }}>
      {/* ── Session header bar ── */}
      <Paper
        radius="lg" p="md" withBorder
        style={{
          border: '1px solid #edf0f5',
          background: 'white',
          position: 'sticky',
          top: 56,
          zIndex: 10,
        }}
      >
        <Group justify="space-between" wrap="nowrap">
          <Group gap="md" wrap="nowrap" style={{ minWidth: 0 }}>
            <ThemeIcon size={44} radius="xl" variant="light" color={modeConf.color}>
              <ModeIcon size={22} />
            </ThemeIcon>
            <Box style={{ minWidth: 0 }}>
              <Title order={4} fw={700} lineClamp={1}>Simulation Session</Title>
              <Group gap="sm" mt={2}>
                <Group gap={4}>
                  <IconHash size={12} style={{ color: 'var(--mantine-color-gray-5)' }} />
                  <Text size="xs" c="dimmed">Attempt {session.attemptNo}</Text>
                </Group>
                <Badge variant="light" color={modeConf.color} size="xs" radius="xl">
                  {modeConf.label}
                </Badge>
                <Badge
                  variant="dot" color={statusConf.color} size="xs" radius="xl"
                  leftSection={
                    isActive
                      ? <IconCircleFilled size={8} style={{ color: 'var(--mantine-color-green-6)', animation: 'pulse 2s infinite' }} />
                      : undefined
                  }
                >
                  {statusConf.label}
                </Badge>
              </Group>
            </Box>
          </Group>

          <Group gap="sm" wrap="nowrap" style={{ flexShrink: 0 }}>
            {isActive ? (
              <Button
                variant="light"
                color="red"
                radius="md"
                leftSection={<IconPlayerStop size={16} />}
                onClick={handleScoreAndComplete}
                loading={scoring}
                disabled={scoring}
              >
                End Session
              </Button>
            ) : (
              <Button
                variant="light"
                color="indigo"
                radius="md"
                leftSection={<IconChartBar size={16} />}
                onClick={handleViewResults}
              >
                View Results
              </Button>
            )}
          </Group>
        </Group>
      </Paper>

      {/* ── Unity iframe ── */}
      <Paper
        radius="lg"
        withBorder
        style={{
          flex: 1,
          overflow: 'hidden',
          border: '1px solid #edf0f5',
          position: 'relative',
        }}
      >
        <iframe
          src={buildUnityPath(routeState?.unityBuildFolder || DEFAULT_UNITY_FOLDER)}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            display: 'block',
            minHeight: 560,
          }}
          allow="microphone; autoplay"
          title="Unity Simulation"
        />
      </Paper>

      {/* Pulse animation for active indicator */}
      {isActive && (
        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }
        `}</style>
      )}
    </Stack>
  );
}
