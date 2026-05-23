import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import {
  Title, Text, Button, Stack, Group, Badge, Box,
  ThemeIcon, Skeleton, Alert,
} from '@mantine/core';
import {
  IconArrowBack, IconChartBar, IconPlayerStop,
  IconBook2, IconClipboardCheck, IconHash, IconCircleFilled, IconAlertCircle, IconPlayerPlay,
} from '@tabler/icons-react';
import { fetchSession, completeSession, selectCurrentSession, selectSessionsLoading } from '../../slices/sessionSlice';
import { selectUserId } from '../../slices/authSlice';
import { sessionApi } from '../../api/sessionApi';
import { assignmentApi } from '../../api/assignmentApi';
import { apiPost } from '../../api/apiClient';
import type { AppDispatch } from '../../store';

type CourseContextStatus = 'idle' | 'resolving' | 'resolved' | 'legacy' | 'error';

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
  // courseId / moduleItemId / assignmentId are propagated by
  // AssignmentPlayer when launching a session from a course module item.
  // They let us navigate the student back to the right course page on
  // "Back to Course" and let SessionDetailPage offer the same option.
  const routeState = location.state as {
    unityLaunchUrl?: string;
    courseId?: string;
    moduleItemId?: string;
    assignmentId?: string;
  } | null;
  const session = useSelector(selectCurrentSession);
  const loading = useSelector(selectSessionsLoading);
  const userId = useSelector(selectUserId);

  const [iframeReady, setIframeReady] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [runtimeToken, setRuntimeToken] = useState<RuntimeTokenResponse | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  // Stage 2 course-context recovery: when routeState.courseId is missing
  // (e.g. page refresh, direct URL, deep link), look up the assignment to
  // recover course linkage from durable backend data instead of treating
  // the session as legacy and showing the unsafe End Session button.
  const [courseContextStatus, setCourseContextStatus] = useState<CourseContextStatus>('idle');
  const [resolvedCourseId, setResolvedCourseId] = useState<string | null>(null);
  const [resolvedModuleItemId, setResolvedModuleItemId] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const prewarmedSessionRef = useRef<string | null>(null);
  // Tracks the assignmentId we have already initiated a lookup for, so the
  // resolution effect can't re-fire on every render. Reset implicitly when
  // session.assignmentId changes because the effect dep array picks it up.
  const assignmentLookupRef = useRef<string | null>(null);
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

  // While the session is still active, periodically refetch it so the
  // status badge reflects the authoritative backend state. Unity's
  // task-progress chain auto-completes the session in the backend when all
  // required keys arrive, but this page has no postMessage channel from
  // Unity, so the badge would otherwise remain "In Progress" until the
  // user manually navigates. Polling stops as soon as status flips to
  // completed/abandoned (the effect re-runs with the new status and the
  // early return clears the interval).
  useEffect(() => {
    if (!session?.sessionId || session.status !== 'active') return;
    const intervalId = window.setInterval(() => {
      dispatch(fetchSession(session.sessionId));
    }, 6000);
    return () => window.clearInterval(intervalId);
  }, [session?.sessionId, session?.status, dispatch]);

  // Resolve durable course context for the active-state button:
  //   1. Fast path: routeState.courseId is set by AssignmentPlayer when
  //      the student launches from a course module item. Use it directly,
  //      no network call.
  //   2. Recovery path: when routeState is missing (page refresh, direct
  //      URL, etc.) and currentSession.assignmentId is loaded, look the
  //      assignment up and read its courseId / moduleItemId. The same
  //      backend fields drive course-LMS unlock (markCourseProgressCompleted)
  //      so they are the authoritative source.
  //   3. Confirmed-legacy: the assignment has neither courseId nor
  //      moduleItemId — only then do we render the legacy End Session
  //      button.
  //   4. Error / unresolved-partial: a network error OR an assignment that
  //      carries only moduleItemId (no courseId) is treated as
  //      course-linked-but-unspecified; Back to Course falls back to
  //      /student/courses rather than risking End Session.
  useEffect(() => {
    if (!session?.sessionId) return;

    // Fast path.
    if (routeState?.courseId) {
      setResolvedCourseId(routeState.courseId);
      setResolvedModuleItemId(routeState.moduleItemId ?? null);
      setCourseContextStatus('resolved');
      return;
    }

    const assignmentIdToLookup = session.assignmentId;
    if (!assignmentIdToLookup) {
      // No way to recover — extremely unlikely (session schema requires
      // assignmentId) but defensively treat as legacy. Clear any stale
      // resolved values from a previous session (the same component
      // instance can be reused for a different sessionId without
      // unmounting if React Router decides to keep it alive).
      setResolvedCourseId(null);
      setResolvedModuleItemId(null);
      setCourseContextStatus('legacy');
      return;
    }

    // Guard: never re-fetch the same assignmentId. (Already-resolved
    // state for this assignmentId is correct and must not be cleared.)
    if (assignmentLookupRef.current === assignmentIdToLookup) return;
    assignmentLookupRef.current = assignmentIdToLookup;

    // New assignment to look up: clear any stale resolved values from a
    // previous session before issuing the lookup, so the "Resolving…"
    // button and any premature read of resolvedCourseId during the
    // network window cannot leak the previous session's context into
    // the new session's Back to Course destination or View Results
    // forwarded state.
    setResolvedCourseId(null);
    setResolvedModuleItemId(null);
    setCourseContextStatus('resolving');
    let cancelled = false;
    (async () => {
      try {
        const assignment = await assignmentApi.get(assignmentIdToLookup);
        if (cancelled) return;
        const courseId = (assignment?.courseId as string | null | undefined) ?? null;
        const moduleItemId = (assignment?.moduleItemId as string | null | undefined) ?? null;
        if (courseId) {
          setResolvedCourseId(courseId);
          setResolvedModuleItemId(moduleItemId);
          setCourseContextStatus('resolved');
          return;
        }
        if (moduleItemId) {
          // Partial linkage: assignment is wrapped by a ModuleItem but
          // courseId wasn't back-linked onto the Assignment row. Treat as
          // course-linked-but-unresolved; Back to Course falls back to
          // /student/courses. FOLLOW-UP: optionally call
          // moduleItemApi.get(moduleItemId) to recover courseId.
          setResolvedCourseId(null);
          setResolvedModuleItemId(moduleItemId);
          setCourseContextStatus('resolved');
          return;
        }
        // No course linkage at all — true legacy / non-course session.
        // Clear any prior values (defensive; the lookup-start reset
        // already nulled them, but make this branch self-consistent).
        setResolvedCourseId(null);
        setResolvedModuleItemId(null);
        setCourseContextStatus('legacy');
      } catch (err) {
        if (cancelled) return;
        console.warn('[SessionRunner] Failed to resolve course context from assignment:', err);
        // On error we deliberately do NOT fall through to End Session,
        // because that path can prematurely complete a course-linked
        // session whose context just happened to fail lookup. Render a
        // safe Back to Courses fallback instead. Also clear resolved
        // values so the fallback handler navigates to the generic
        // /student/courses list (it must NOT route to a stale recovered
        // courseId from the previous session).
        setResolvedCourseId(null);
        setResolvedModuleItemId(null);
        setCourseContextStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.sessionId, session?.assignmentId, routeState?.courseId, routeState?.moduleItemId]);

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

  // Course-launched active-state button. Reads the effective courseId
  // from (1) routeState (fast path), then (2) resolvedCourseId recovered
  // via assignment lookup. Both Back to Course and the error-fallback
  // Back to Courses route through this handler — when no courseId is
  // available (partial linkage or error state) it gracefully falls back
  // to the course list. Pure navigation; no PUT /sessions/{sid}/complete.
  const handleBackToCourse = () => {
    const courseId = routeState?.courseId ?? resolvedCourseId;
    if (courseId) {
      navigate(`/student/courses/${courseId}`);
      return;
    }
    navigate('/student/courses');
  };

  // Legacy / non-course active-state button. Preserved for direct
  // assignment launches confirmed to have no course context after the
  // recovery lookup. The thunk is 409-tolerant; .unwrap() lets the local
  // try/catch see non-409 rejections (network failure, 5xx, 403, etc.)
  // — without .unwrap(), createAsyncThunk's dispatch resolves to a
  // rejected action object instead of throwing, silently swallowing
  // genuine errors.
  const handleScoreAndComplete = async () => {
    if (!session || !runtimeToken?.runtimeToken || scoring) return;
    setScoring(true);
    try {
      await dispatch(completeSession({
        sessionId: session.sessionId,
        runtimeToken: runtimeToken.runtimeToken,
      })).unwrap();
    } catch (err) {
      console.error('Complete session error:', err);
    } finally {
      setScoring(false);
    }
  };

  // Completed-state button. Forwards the best-available context so the
  // detail page can offer its own "Back to Course" entry point with the
  // recovered courseId even when the user reached SessionRunner without
  // route state (refresh/direct URL).
  const handleViewResults = () => {
    if (!sessionId) return;
    const forwardedState = {
      unityLaunchUrl: routeState?.unityLaunchUrl,
      courseId: routeState?.courseId ?? resolvedCourseId ?? undefined,
      moduleItemId: routeState?.moduleItemId ?? resolvedModuleItemId ?? undefined,
      assignmentId: routeState?.assignmentId ?? session?.assignmentId ?? undefined,
    };
    navigate(`/student/session/${sessionId}/detail`, { state: forwardedState });
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
              courseContextStatus === 'resolving' || courseContextStatus === 'idle' ? (
                <Button
                  variant="filled"
                  color="terracotta"
                  size="md"
                  h={46}
                  px="xl"
                  radius="lg"
                  loading
                  disabled
                >
                  Resolving…
                </Button>
              ) : courseContextStatus === 'resolved' ? (
                <Button
                  variant="filled"
                  color="terracotta"
                  size="md"
                  h={46}
                  px="xl"
                  radius="lg"
                  leftSection={<IconArrowBack size={16} />}
                  onClick={handleBackToCourse}
                >
                  Back to Course
                </Button>
              ) : courseContextStatus === 'error' ? (
                <Button
                  variant="filled"
                  color="terracotta"
                  size="md"
                  h={46}
                  px="xl"
                  radius="lg"
                  leftSection={<IconArrowBack size={16} />}
                  onClick={handleBackToCourse}
                >
                  Back to Courses
                </Button>
              ) : (
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
              )
            ) : (
              // Completed / abandoned state. Mirror the active-state
              // courseContextStatus branching so course-linked sessions
              // get Back to Course as the primary action regardless of
              // session.status; only true-legacy completed sessions keep
              // View Results. Resolving placeholder is reused for the
              // rare race where status flips to completed before the
              // assignment lookup finishes.
              courseContextStatus === 'resolving' || courseContextStatus === 'idle' ? (
                <Button
                  variant="filled"
                  color="terracotta"
                  size="md"
                  h={46}
                  px="xl"
                  radius="lg"
                  loading
                  disabled
                >
                  Resolving…
                </Button>
              ) : courseContextStatus === 'resolved' ? (
                <Button
                  variant="filled"
                  color="terracotta"
                  size="md"
                  h={46}
                  px="xl"
                  radius="lg"
                  leftSection={<IconArrowBack size={16} />}
                  onClick={handleBackToCourse}
                >
                  Back to Course
                </Button>
              ) : courseContextStatus === 'error' ? (
                <Button
                  variant="filled"
                  color="terracotta"
                  size="md"
                  h={46}
                  px="xl"
                  radius="lg"
                  leftSection={<IconArrowBack size={16} />}
                  onClick={handleBackToCourse}
                >
                  Back to Courses
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
              )
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
