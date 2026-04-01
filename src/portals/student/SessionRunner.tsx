import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import {
  Title, Text, Button, Stack, Group, Badge, Box,
  Paper, ThemeIcon, Skeleton, Alert,
} from '@mantine/core';
import {
  IconPlayerStop, IconChartBar,
  IconBook2, IconClipboardCheck, IconHash, IconCircleFilled, IconAlertCircle,
} from '@tabler/icons-react';
import { fetchSession, completeSession, selectCurrentSession, selectSessionsLoading } from '../../slices/sessionSlice';
import { selectUserId } from '../../slices/authSlice';
import { sessionApi } from '../../api/sessionApi';
import type { AppDispatch } from '../../store';

function resolveUnitySrc(unityLaunchUrl?: string | null) {
  if (unityLaunchUrl && /^https?:\/\//.test(unityLaunchUrl)) {
    return unityLaunchUrl;
  }
  return null;
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

interface RuntimeTokenResponse {
  tokenType: string;
  runtimeToken: string;
  expiresAt: string;
  refreshAfter: string;
  session: {
    sessionId: string;
    assignmentId: string;
    status: string;
    attemptNo: number;
  };
}

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
  const routeState = location.state as { unityLaunchUrl?: string } | null;
  const session = useSelector(selectCurrentSession);
  const loading = useSelector(selectSessionsLoading);
  const userId = useSelector(selectUserId);

  const [scoring, setScoring] = useState(false);
  const [iframeReady, setIframeReady] = useState(false);
  const [runtimeToken, setRuntimeToken] = useState<RuntimeTokenResponse | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const unitySrc = useMemo(
    () => resolveUnitySrc(routeState?.unityLaunchUrl || session?.unityLaunchUrl || null),
    [routeState?.unityLaunchUrl, session?.unityLaunchUrl]
  );
  const iframeOrigin = useMemo(() => {
    try {
      return unitySrc ? new URL(unitySrc, window.location.origin).origin : window.location.origin;
    } catch {
      return window.location.origin;
    }
  }, [unitySrc]);

  useEffect(() => {
    if (sessionId) dispatch(fetchSession(sessionId));
  }, [sessionId, dispatch]);

  useEffect(() => {
    setIframeReady(false);
  }, [sessionId]);

  useEffect(() => {
    if (!session?.sessionId || session.status !== 'active') {
      setRuntimeToken(null);
      setRuntimeError(null);
      return;
    }

    let cancelled = false;
    let refreshTimer: number | null = null;

    const clearRefreshTimer = () => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
        refreshTimer = null;
      }
    };

    const scheduleRefresh = (response: RuntimeTokenResponse) => {
      clearRefreshTimer();
      const refreshAt = new Date(response.refreshAfter).getTime();
      const delayMs = Number.isFinite(refreshAt)
        ? Math.max(5_000, refreshAt - Date.now())
        : 15 * 60 * 1000;

      refreshTimer = window.setTimeout(() => {
        void fetchRuntimeToken();
      }, delayMs);
    };

    const fetchRuntimeToken = async () => {
      try {
        const response = await sessionApi.getRuntimeToken(session.sessionId) as RuntimeTokenResponse;
        if (cancelled) return;
        setRuntimeToken(response);
        setRuntimeError(null);
        scheduleRefresh(response);
      } catch (error) {
        if (cancelled) return;
        console.error('Runtime token error:', error);
        setRuntimeError('Unable to initialize the Unity runtime session.');
      }
    };

    void fetchRuntimeToken();

    return () => {
      cancelled = true;
      clearRefreshTimer();
    };
  }, [session?.sessionId, session?.status]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== iframeOrigin) {
        return;
      }

      if (event.source !== iframeRef.current?.contentWindow) {
        return;
      }

      if (!event.data || typeof event.data !== 'object') {
        return;
      }

      const message = event.data as { type?: string };
      if (message.type === 'unity-ready') {
        setIframeReady(true);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [iframeOrigin]);

  useEffect(() => {
    if (!iframeReady || !runtimeToken || !session || !iframeRef.current?.contentWindow) {
      return;
    }

    iframeRef.current.contentWindow.postMessage(
      {
        type: 'unity-init',
        payload: {
          tokenType: runtimeToken.tokenType,
          runtimeToken: runtimeToken.runtimeToken,
          expiresAt: runtimeToken.expiresAt,
          refreshAfter: runtimeToken.refreshAfter,
          userId: userId ?? session.studentUserId,
          assignmentId: session.assignmentId,
          sessionId: session.sessionId,
        },
      },
      iframeOrigin
    );
  }, [iframeOrigin, iframeReady, runtimeToken, session, userId]);

  const handleScoreAndComplete = async () => {
    if (!session || !runtimeToken?.runtimeToken || scoring) return;
    setScoring(true);
    try {
      await dispatch(completeSession({
        sessionId: session.sessionId,
        runtimeToken: runtimeToken.runtimeToken,
      }));
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
        {runtimeError && isActive && (
          <Alert
            color="red"
            icon={<IconAlertCircle size={16} />}
            m="md"
            mb={0}
            radius="md"
            variant="light"
          >
            {runtimeError}
          </Alert>
        )}
        {unitySrc ? (
          <iframe
            ref={iframeRef}
            src={unitySrc}
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
        ) : (
          <Alert
            color="red"
            icon={<IconAlertCircle size={16} />}
            m="md"
            radius="md"
            variant="light"
          >
            This session does not have a published Unity build URL. Publish a Unity build and relaunch the session.
          </Alert>
        )}
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
