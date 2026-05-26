import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Card,
  Collapse,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import {
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconMessageCircle,
  IconStarFilled,
  IconTrophy,
} from "@tabler/icons-react";
import { sessionApi } from "../../../../../api/sessionApi";
import type {
  Session,
  SessionEvaluation,
  SessionTurn,
} from "../../../../../slices/sessionSlice";
import {
  formatDateTime,
  formatDuration,
} from "../../../../shared/sessionDetail/formatters";
import { groupTranscriptTurns } from "../../../../shared/sessionDetail/transcriptGrouping";
import { ConversationBubble } from "../../../../shared/sessionDetail/ConversationBubble";

interface Props {
  itemId: string;
  studentUserId: string;
  courseId: string;
  assignmentId?: string | null;
}

// Shape returned by GET /sessions/{sessionId} (sessionApi.get).
interface SessionDetailResponse {
  session: Session | null;
  turns?: SessionTurn[];
  evaluation?: SessionEvaluation | null;
}

const PERF_COLORS: Record<string, string> = {
  excellent: "terracotta",
  good: "terracotta",
  satisfactory: "parchment",
  "needs improvement": "parchment",
  poor: "parchment",
};

/**
 * Faculty view of a student's VOICE assignment.
 *
 * Mirrors the Student History page: lists every COMPLETED simulation attempt
 * for the selected student + assignment (source of truth = session history),
 * not StudentItemProgress.bestSessionId. Full session detail (info + transcript
 * + evaluation) is loaded lazily, only when an attempt is expanded.
 *
 * All data access here is via read-only GETs (sessionApi.listByAssignment /
 * sessionApi.get) using local component state — no Redux session thunk, no
 * writes, no progress/scoring/bestSessionId side effects.
 */
export function AssignmentItemDetail({
  studentUserId,
  courseId,
  assignmentId,
}: Props) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    // Guard: without an assignmentId there is nothing to query. Do NOT call the
    // API with an undefined id.
    if (!assignmentId) {
      setSessions([]);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    sessionApi
      .listByAssignment(assignmentId, { studentUserId })
      .then((res: unknown) => {
        if (cancelled) return;
        const all = ((res as { sessions?: Session[] })?.sessions ?? []) as Session[];
        // Match Student History: only completed attempts, ordered by attempt no.
        const completed = all
          .filter((s) => s.status === "completed")
          .sort((a, b) => (a.attemptNo ?? 0) - (b.attemptNo ?? 0));
        setSessions(completed);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load sessions");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [assignmentId, studentUserId]);

  if (!assignmentId) {
    return (
      <Text size="sm" c="dimmed">
        Assignment link unavailable
      </Text>
    );
  }
  if (loading) return <Loader size="sm" />;

  return (
    <Stack gap="xs">
      <Group justify="flex-end">
        <Button
          size="xs"
          variant="light"
          onClick={() => navigate(`/faculty/courses/${courseId}/reviews`)}
        >
          Open in Review Board
        </Button>
      </Group>

      {error ? (
        <Text c="terracotta" size="sm">
          {error}
        </Text>
      ) : sessions.length === 0 ? (
        <Text size="sm" c="dimmed">
          No completed session yet
        </Text>
      ) : (
        sessions.map((s) => <AttemptRow key={s.sessionId} session={s} />)
      )}
    </Stack>
  );
}

/**
 * One completed attempt. Collapsed by default; the full session detail is
 * fetched (once) only when the row is first expanded.
 */
function AttemptRow({ session }: { session: Session }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<SessionDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);

  const duration = formatDuration(session.startedAt, session.endedAt);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    // Lazy-load detail only on first expand. Per-attempt failure stays local to
    // this row so the rest of the attempts list keeps working.
    if (next && !fetched && !loading) {
      setLoading(true);
      setError(null);
      sessionApi
        .get(session.sessionId)
        .then((res: unknown) => {
          setDetail(res as SessionDetailResponse);
          setFetched(true);
        })
        .catch((e: unknown) => {
          setError(
            e instanceof Error ? e.message : "Failed to load session detail"
          );
        })
        .finally(() => setLoading(false));
    }
  };

  return (
    <Card withBorder p="xs">
      <UnstyledButton onClick={handleToggle} style={{ width: "100%" }}>
        <Group justify="space-between" wrap="wrap">
          <Group gap="xs" wrap="wrap">
            {open ? (
              <IconChevronDown size={14} />
            ) : (
              <IconChevronRight size={14} />
            )}
            <Badge color="terracotta" variant="light">
              attempt #{session.attemptNo}
            </Badge>
            <Badge color="parchment" variant="outline" size="sm">
              {session.status}
            </Badge>
            <Badge color="parchment" variant="light" size="sm">
              {session.mode}
            </Badge>
          </Group>
          <Group gap="md" wrap="wrap">
            <Text size="xs" c="var(--claude-olive)">
              {formatDateTime(session.startedAt)}
              {session.endedAt ? ` → ${formatDateTime(session.endedAt)}` : ""}
            </Text>
            <Group gap={3} wrap="nowrap">
              <IconClock size={12} style={{ color: "var(--claude-stone)" }} />
              <Text size="xs" c="var(--claude-olive)">
                {duration}
              </Text>
            </Group>
          </Group>
        </Group>
      </UnstyledButton>

      <Collapse in={open}>
        <Box mt="xs">
          {loading && <Loader size="sm" />}
          {error && (
            <Text c="terracotta" size="sm">
              {error}
            </Text>
          )}
          {!loading && !error && detail && (
            <AttemptDetailBody detail={detail} fallbackSession={session} />
          )}
        </Box>
      </Collapse>
    </Card>
  );
}

/**
 * Renders the session info, evaluation, and conversation transcript for one
 * attempt — the same content the student sees on their Session Detail page,
 * built from the shared sessionDetail helpers/components.
 */
function AttemptDetailBody({
  detail,
  fallbackSession,
}: {
  detail: SessionDetailResponse;
  fallbackSession: Session;
}) {
  const session = detail.session ?? fallbackSession;
  const evaluation = detail.evaluation ?? null;
  const transcriptGroups = useMemo(
    () => groupTranscriptTurns(detail.turns ?? []),
    [detail.turns]
  );
  const turns = detail.turns ?? [];
  const duration = formatDuration(session.startedAt, session.endedAt);
  const perfColor = evaluation
    ? PERF_COLORS[evaluation.performanceLevel?.toLowerCase()] || "parchment"
    : "parchment";

  return (
    <Stack gap="sm">
      <Card withBorder p="xs">
        <Group gap="md" wrap="wrap">
          <SessionMeta label="Started" value={formatDateTime(session.startedAt)} />
          <SessionMeta
            label="Ended"
            value={session.endedAt ? formatDateTime(session.endedAt) : "—"}
          />
          <SessionMeta
            label="Duration"
            value={duration}
            icon={<IconClock size={12} style={{ color: "var(--claude-stone)" }} />}
          />
          <SessionMeta
            label="Turns"
            value={String(turns.length)}
            icon={
              <IconMessageCircle
                size={12}
                style={{ color: "var(--claude-stone)" }}
              />
            }
          />
          <SessionMeta label="Mode" value={session.mode} />
          <SessionMeta label="Status" value={session.status} />
        </Group>
      </Card>

      <Card withBorder p="xs">
        <Group gap={6} mb={4} wrap="wrap">
          <ThemeIcon size={20} radius="md" variant="light" color="terracotta">
            <IconTrophy size={12} />
          </ThemeIcon>
          <Text size="sm" fw={500}>
            Evaluation
          </Text>
          {evaluation?.totalScore != null && (
            <Badge color="terracotta" variant="filled">
              {evaluation.totalScore}/24
            </Badge>
          )}
          {evaluation?.performanceLevel && (
            <Badge color={perfColor} variant="light" radius="xl">
              <Group gap={4} wrap="nowrap">
                <IconStarFilled size={10} />
                {evaluation.performanceLevel}
              </Group>
            </Badge>
          )}
        </Group>
        {evaluation ? (
          evaluation.overallExplanation ? (
            <Text
              size="sm"
              c="var(--claude-olive)"
              style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}
            >
              {evaluation.overallExplanation}
            </Text>
          ) : null
        ) : (
          <Text size="sm" c="var(--claude-stone)">
            No evaluation available
          </Text>
        )}
      </Card>

      <Card withBorder p="xs">
        <Group justify="space-between" mb={6}>
          <Text size="sm" fw={500}>
            Conversation
          </Text>
          <Badge variant="light" color="parchment" size="xs" radius="xl">
            {turns.length} {turns.length === 1 ? "turn" : "turns"}
          </Badge>
        </Group>
        {turns.length === 0 ? (
          <Text size="sm" c="dimmed">
            No conversation turns recorded
          </Text>
        ) : (
          <Box style={{ maxHeight: 420, overflowY: "auto" }} pr={4}>
            <Stack gap="lg">
              {transcriptGroups.map((group) => (
                <Stack key={group.key} gap="sm">
                  <Group justify="space-between" gap="sm">
                    <Text size="xs" fw={600} c="var(--claude-near-black)">
                      {group.label}
                    </Text>
                    <Badge variant="light" color="parchment" size="xs" radius="xl">
                      {group.turns.length}{" "}
                      {group.turns.length === 1 ? "turn" : "turns"}
                    </Badge>
                  </Group>
                  <Stack gap="sm">
                    {group.turns.map((turn) => (
                      <ConversationBubble key={turn.turnIndex} turn={turn} />
                    ))}
                  </Stack>
                </Stack>
              ))}
            </Stack>
          </Box>
        )}
      </Card>
    </Stack>
  );
}

function SessionMeta({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <Paper radius="sm" p={6} style={{ background: "var(--claude-parchment)" }}>
      <Group gap={6} wrap="nowrap">
        <Text size="xs" c="var(--claude-olive)" fw={500}>
          {label}:
        </Text>
        <Group gap={3} wrap="nowrap">
          {icon}
          <Text size="xs" fw={500} c="var(--claude-near-black)">
            {value}
          </Text>
        </Group>
      </Group>
    </Paper>
  );
}
