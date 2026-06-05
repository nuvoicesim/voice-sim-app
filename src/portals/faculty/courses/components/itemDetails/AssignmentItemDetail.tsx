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
  Tooltip,
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

// ───────────── Verbal engagement (interaction-length) metrics ─────────────
//
// DISPLAY-ONLY, faculty-only. Derived synchronously (useMemo) from the session
// `turns` already lazy-loaded when an attempt is expanded — no new API calls,
// no new effects. These describe interaction LENGTH / verbal participation
// only: NOT a clinical quality score, rubric score, grade, or goal-achievement
// measure. Intended to help faculty spot sessions where a student answered the
// virtual patient with very brief responses (e.g. "yes", "okay") and decide
// whether to read the transcript.

// Preliminary thresholds on AVERAGE words per student response. Constants here;
// may become configurable in a later version.
const ENGAGEMENT_THRESHOLDS = { briefMax: 3, extendedMin: 9 };
// A single student response of this many words or fewer counts as "short".
const SHORT_RESPONSE_MAX_WORDS = 3;

/** Word count: trim, split on whitespace, drop empty tokens; 0 for empty/nullish. */
function wordCount(text: string | null | undefined): number {
  return (text ?? "").trim().split(/\s+/).filter(Boolean).length;
}

interface EngagementMetrics {
  /** Turns with non-empty student (userText) speech. */
  studentResponses: number;
  totalStudentWords: number;
  /** null when there are no student responses (avoid divide-by-zero). */
  avgWordsPerResponse: number | null;
  /** Student responses of SHORT_RESPONSE_MAX_WORDS words or fewer. */
  shortResponses: number;
  longestResponseWords: number;
}

/**
 * Interaction-length metrics over a session's turns. A "student response" is a
 * turn whose userText is non-empty; patient (modelText) turns are intentionally
 * NOT counted or surfaced in V1.1.
 */
function computeEngagement(turns: SessionTurn[]): EngagementMetrics {
  let studentResponses = 0;
  let totalStudentWords = 0;
  let shortResponses = 0;
  let longestResponseWords = 0;
  for (const t of turns) {
    if ((t.userText ?? "").trim() === "") continue;
    const wc = wordCount(t.userText);
    studentResponses += 1;
    totalStudentWords += wc;
    if (wc <= SHORT_RESPONSE_MAX_WORDS) shortResponses += 1;
    if (wc > longestResponseWords) longestResponseWords = wc;
  }
  return {
    studentResponses,
    totalStudentWords,
    avgWordsPerResponse:
      studentResponses > 0 ? totalStudentWords / studentResponses : null,
    shortResponses,
    longestResponseWords,
  };
}

/**
 * Neutral interaction-length label from average words per response. Wording is
 * deliberately Brief / Moderate / Extended — never Poor/Good/Excellent — so it
 * cannot read as a quality grade. Returns null when there is no data.
 */
function engagementLabel(avgWordsPerResponse: number | null): string | null {
  if (avgWordsPerResponse == null) return null;
  if (avgWordsPerResponse <= ENGAGEMENT_THRESHOLDS.briefMax)
    return "Brief responses";
  if (avgWordsPerResponse >= ENGAGEMENT_THRESHOLDS.extendedMin)
    return "Extended responses";
  return "Moderate responses";
}

/**
 * Subtle red / orange / green for the interaction-length chip, ALWAYS paired
 * with the text label (never color alone, so it stays colour-blind-safe). This
 * encodes response LENGTH only — shorter average response → warmer colour — and
 * is NOT a clinical quality score; wording stays Brief / Moderate / Extended.
 */
function engagementColor(label: string | null): string {
  switch (label) {
    case "Brief responses":
      return "red";
    case "Moderate responses":
      return "orange";
    case "Extended responses":
      return "green";
    default:
      // "Not enough data" → neutral.
      return "parchment";
  }
}

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
  // Verbal-engagement metrics: pure, synchronous derivation from the turns
  // already loaded for this attempt — no extra fetch, no new effect.
  const engagement = useMemo(
    () => computeEngagement(detail.turns ?? []),
    [detail.turns]
  );
  const engagementChip = engagementLabel(engagement.avgWordsPerResponse);
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

      {/* Verbal Engagement — DISPLAY-ONLY interaction-length indicator. A small
          red/orange/green status DOT is PAIRED with the always-visible text
          label + a disclaimer (never colour alone) and conveys response LENGTH
          only — it is not the rubric / evaluation score above. */}
      <Card withBorder p="xs">
        <Group gap={6} mb={4} wrap="wrap">
          <ThemeIcon size={20} radius="md" variant="light" color="parchment">
            <IconMessageCircle size={12} />
          </ThemeIcon>
          <Text size="sm" fw={500}>
            Verbal Engagement
          </Text>
          <Tooltip
            label="This color indicates student response length only. It helps identify sessions with very brief responses and is not a clinical quality score."
            withinPortal
            multiline
            w={300}
          >
            <Group gap={6} wrap="nowrap" style={{ cursor: "default" }}>
              {/* Small circular status dot — colour comes from response length;
                  the text label beside it is always visible (never colour alone). */}
              <Box
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  flexShrink: 0,
                  backgroundColor: `var(--mantine-color-${engagementColor(
                    engagementChip
                  )}-filled)`,
                }}
              />
              <Text size="xs" fw={500} c="var(--claude-near-black)">
                {engagementChip ?? "Not enough data"}
              </Text>
            </Group>
          </Tooltip>
        </Group>
        <Text size="xs" c="var(--claude-stone)" mb={8}>
          Based on student response length in this session. This is not a
          clinical quality score.
        </Text>
        <Group gap="md" wrap="wrap">
          <SessionMeta
            label="Avg words / response"
            value={
              engagement.avgWordsPerResponse == null
                ? "—"
                : engagement.avgWordsPerResponse.toFixed(1)
            }
          />
          <SessionMeta
            label="Short responses (≤3 words)"
            value={
              engagement.studentResponses === 0
                ? "—"
                : String(engagement.shortResponses)
            }
          />
          <SessionMeta
            label="Student responses"
            value={String(engagement.studentResponses)}
          />
          <SessionMeta
            label="Total student words"
            value={String(engagement.totalStudentWords)}
          />
          <SessionMeta
            label="Longest response (words)"
            value={
              engagement.studentResponses === 0
                ? "—"
                : String(engagement.longestResponseWords)
            }
          />
        </Group>
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
