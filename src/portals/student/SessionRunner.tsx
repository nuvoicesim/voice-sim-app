import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import {
  Title, Text, Button, Stack, Group, Badge, Box,
  ThemeIcon, Skeleton, Alert,
} from '@mantine/core';
import {
  IconPlayerStop, IconChartBar,
  IconBook2, IconClipboardCheck, IconHash, IconCircleFilled, IconAlertCircle, IconPlayerPlay,
} from '@tabler/icons-react';
import { fetchSession, completeSession, selectCurrentSession, selectSessionsLoading } from '../../slices/sessionSlice';
import { selectUserId } from '../../slices/authSlice';
import { sessionApi } from '../../api/sessionApi';
import { apiPost } from '../../api/apiClient';
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

const PAGE_HEIGHT = 'calc(100dvh - 56px)';
const PAGE_MAX_WIDTH = '1540px';
const PAGE_HORIZONTAL_PADDING = '32px';
const PAGE_VERTICAL_PADDING = '24px';
const UNITY_STAGE_WIDTH = 960;
const UNITY_STAGE_HEIGHT = 600;
const UNITY_STAGE_ASPECT = `${UNITY_STAGE_WIDTH} / ${UNITY_STAGE_HEIGHT}`;
const STAGE_MAX_WIDTH = '1400px';
const STAGE_MAX_HEIGHT = 'calc(100dvh - 240px)';
const STAGE_WIDTH = `min(100%, ${STAGE_MAX_WIDTH}, calc(${STAGE_MAX_HEIGHT} * ${UNITY_STAGE_WIDTH} / ${UNITY_STAGE_HEIGHT}))`;

function LoadingSkeleton() {
  return (
    <Box
      style={{
        minHeight: PAGE_HEIGHT,
        padding: `${PAGE_VERTICAL_PADDING} ${PAGE_HORIZONTAL_PADDING}`,
        background: 'var(--claude-parchment)',
        boxSizing: 'border-box',
      }}
    >
      <Stack gap="md" maw={PAGE_MAX_WIDTH} mx="auto">
        <Group justify="space-between" align="flex-end" gap="lg" wrap="wrap">
          <Box>
            <Group gap="sm" mb={6}>
              <Skeleton circle height={38} />
              <Skeleton height={26} width={210} />
            </Group>
            <Group gap="sm" ml={52}>
              <Skeleton height={16} width={84} radius="xl" />
              <Skeleton height={16} width={70} radius="xl" />
              <Skeleton height={16} width={88} radius="xl" />
            </Group>
          </Box>
          <Skeleton height={46} width={156} radius="xl" />
        </Group>
        <Skeleton
          radius="md"
          style={{
            width: STAGE_WIDTH,
            aspectRatio: UNITY_STAGE_ASPECT,
            alignSelf: 'center',
          }}
        />
      </Stack>
    </Box>
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
  const prewarmedSessionRef = useRef<string | null>(null);
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
        const detail = error instanceof Error && error.message ? error.message : String(error);
        setRuntimeError(`Unable to initialize the Unity runtime session: ${detail}`);
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

  useEffect(() => {
    if (!session?.sessionId || session.status !== 'active' || !runtimeToken?.runtimeToken) {
      return;
    }

    if (prewarmedSessionRef.current === session.sessionId) {
      return;
    }

    prewarmedSessionRef.current = session.sessionId;

    const runtimeHeaders = { Authorization: `Bearer ${runtimeToken.runtimeToken}` };
    const sharedMetadata = { client: 'web-prewarm', prewarm: true };

    void Promise.allSettled([
      apiPost(
        '/llm-dialogue',
        {
          messages: [{ role: 'user', content: 'Hello.' }],
          options: { temperature: 0, maxOutputTokens: 24 },
          metadata: sharedMetadata,
        },
        runtimeHeaders
      ),
      apiPost(
        '/tts',
        {
          text: 'Hello.',
          options: { format: 'pcm_16000', includeAlignment: false },
          metadata: sharedMetadata,
        },
        runtimeHeaders
      ),
    ]).then(([llmResult, ttsResult]) => {
      console.log('runtime prewarm completed', {
        sessionId: session.sessionId,
        llmStatus: llmResult.status,
        ttsStatus: ttsResult.status,
      });
    });
  }, [runtimeToken?.runtimeToken, session?.sessionId, session?.status]);

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

  return (
    <Box
      style={{
        minHeight: PAGE_HEIGHT,
        padding: `${PAGE_VERTICAL_PADDING} ${PAGE_HORIZONTAL_PADDING}`,
        background: 'var(--claude-parchment)',
        boxSizing: 'border-box',
      }}
    >
      <Stack gap="md" maw={PAGE_MAX_WIDTH} mx="auto">
        <Group justify="space-between" align="flex-end" wrap="wrap" gap="lg">
          <Box>
            <Group gap="sm" mb={4}>
              <ThemeIcon size={38} radius="md" variant="filled" color="terracotta">
                <IconPlayerPlay size={18} color="var(--claude-ivory)" />
              </ThemeIcon>
              <Title order={2} fw={500} fz={36} lh={1.2}>Simulation Session</Title>
            </Group>
            <Group gap="sm" ml={52} wrap="wrap">
                <Group gap={4}>
                  <IconHash size={12} style={{ color: 'var(--claude-stone)' }} />
                  <Text size="xs" c="var(--claude-olive)">Attempt {session.attemptNo}</Text>
                </Group>
                <Badge variant="light" color={modeConf.color} size="xs" radius="xl">
                  {modeConf.label}
                </Badge>
                <Badge
                  variant="light"
                  color={statusConf.color}
                  size="xs"
                  radius="xl"
                  leftSection={
                    isActive
                      ? <IconCircleFilled size={8} style={{ color: 'var(--claude-terracotta)' }} />
                      : undefined
                  }
                >
                  {statusConf.label}
                </Badge>
            </Group>
          </Box>

          <Group gap="sm" wrap="nowrap" style={{ flexShrink: 0 }}>
            {isActive ? (
              <Button
                variant="filled"
                color="terracotta"
                size="md"
                h={46}
                px="xl"
                radius="lg"
                leftSection={<IconPlayerStop size={16} />}
                onClick={handleScoreAndComplete}
                loading={scoring}
                disabled={scoring}
              >
                End Session
              </Button>
            ) : (
              <Button
                variant="filled"
                color="terracotta"
                size="md"
                h={46}
                px="xl"
                radius="lg"
                leftSection={<IconChartBar size={16} />}
                onClick={handleViewResults}
              >
                View Results
              </Button>
            )}
          </Group>
        </Group>

        {runtimeError && isActive && (
          <Alert
            color="terracotta"
            icon={<IconAlertCircle size={16} />}
            radius="md"
            variant="light"
          >
            {runtimeError}
          </Alert>
        )}

        <Box style={{ display: 'flex', justifyContent: 'center', paddingTop: 4 }}>
          {unitySrc ? (
            <iframe
              ref={iframeRef}
              src={unitySrc}
              style={{
                width: STAGE_WIDTH,
                aspectRatio: UNITY_STAGE_ASPECT,
                border: 'none',
                display: 'block',
                background: 'var(--claude-sand)',
                borderRadius: 16,
                boxShadow: 'var(--claude-shadow-whisper)',
              }}
              allow="microphone; autoplay"
              title="Unity Simulation"
            />
          ) : (
            <Alert
              color="terracotta"
              icon={<IconAlertCircle size={16} />}
              radius="md"
              variant="light"
              maw={560}
              style={{ width: STAGE_WIDTH }}
            >
              This session does not have a published Unity build URL. Publish a Unity build and relaunch the session.
            </Alert>
          )}
        </Box>
      </Stack>
    </Box>
  );
}
