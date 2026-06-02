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
import {
  sessionEvidenceApi,
  type SessionEvidenceRow,
} from "../../../../../api/sessionEvidenceApi";
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
import { SystemEventBubble } from "../../../../shared/sessionDetail/SystemEventBubble";
import {
  extractCueEvents,
  type CueSupportAccessEvent,
} from "../../../../shared/sessionDetail/cueEvents";

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
  // SessionEvidence is loaded in parallel with the session detail. Failures
  // are non-blocking: the transcript still renders if evidence retrieval
  // fails. evidenceStatus differentiates the three states we need:
  //   - "pending": request in flight; UI shows nothing about cue events.
  //   - "ok":      request resolved; cueEvents reflects backend truth.
  //                Zero cue events means the session genuinely has none.
  //   - "error":   request rejected (network / 5xx / non-2xx); we MUST NOT
  //                show "No cue events recorded" because that would
  //                mislead faculty into reading a backend failure as a
  //                clinical signal. UI shows "Cue evidence unavailable".
  const [evidence, setEvidence] = useState<SessionEvidenceRow[]>([]);
  const [evidenceStatus, setEvidenceStatus] = useState<
    "pending" | "ok" | "error"
  >("pending");

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

      // Evidence is best-effort and orthogonal to transcript rendering. We
      // never block the transcript view on evidence and never surface
      // evidence errors as page errors. On failure we flip evidenceStatus
      // to "error" so the UI shows "Cue evidence unavailable" rather than
      // the false-negative "No cue events recorded".
      sessionEvidenceApi
        .listBySession(session.sessionId)
        .then((res) => {
          setEvidence(Array.isArray(res?.evidence) ? res.evidence : []);
          setEvidenceStatus("ok");
        })
        .catch(() => {
          setEvidence([]);
          setEvidenceStatus("error");
        });
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
            <AttemptDetailBody
              detail={detail}
              fallbackSession={session}
              evidence={evidence}
              evidenceStatus={evidenceStatus}
            />
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
  evidence,
  evidenceStatus,
}: {
  detail: SessionDetailResponse;
  fallbackSession: Session;
  evidence: SessionEvidenceRow[];
  evidenceStatus: "pending" | "ok" | "error";
}) {
  const session = detail.session ?? fallbackSession;
  const evaluation = detail.evaluation ?? null;
  const transcriptGroups = useMemo(
    () => groupTranscriptTurns(detail.turns ?? []),
    [detail.turns]
  );
  const turns = detail.turns ?? [];
  // Cue Support Access events extracted from rawEvidencePayload. Sorted by
  // timestamp when present; events without a timestamp follow at the end so
  // they cannot be merged into the wrong chronological slot.
  const cueEvents = useMemo(() => extractCueEvents(evidence), [evidence]);
  // Bucket cue events by transcript group (progressKey / phase+section /
  // phase+task) using the same identifiers transcriptGrouping.ts uses. Events
  // we can confidently associate with a group are inlined into that group's
  // timeline (sorted by timestamp). Events whose identifiers don't match any
  // group fall into a dedicated "Cue Support Access Events" section below
  // the transcript — see the render below.
  const {
    eventsByGroup,
    unmatchedEvents,
  } = useMemo(
    () => bucketCueEventsByGroup(cueEvents, transcriptGroups),
    [cueEvents, transcriptGroups]
  );
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
          <Group gap={4}>
            <Badge variant="light" color="parchment" size="xs" radius="xl">
              {turns.length} {turns.length === 1 ? "turn" : "turns"}
            </Badge>
            {evidenceStatus === "ok" && cueEvents.length > 0 && (
              <Badge variant="light" color="terracotta" size="xs" radius="xl">
                {cueEvents.length} Cue Support Access
              </Badge>
            )}
          </Group>
        </Group>
        {turns.length === 0 && cueEvents.length === 0 ? (
          <Text size="sm" c="dimmed">
            {evidenceStatus === "ok"
              ? "No conversation turns or cue events recorded"
              : "No conversation turns recorded"}
          </Text>
        ) : (
          <Box style={{ maxHeight: 420, overflowY: "auto" }} pr={4}>
            <Stack gap="lg">
              {transcriptGroups.map((group) => {
                const groupCueEvents = eventsByGroup.get(group.key) ?? [];
                const merged = mergeTurnsAndCueEvents(
                  group.turns,
                  groupCueEvents
                );
                return (
                  <Stack key={group.key} gap="sm">
                    <Group justify="space-between" gap="sm">
                      <Text size="xs" fw={600} c="var(--claude-near-black)">
                        {group.label}
                      </Text>
                      <Group gap={4}>
                        <Badge
                          variant="light"
                          color="parchment"
                          size="xs"
                          radius="xl"
                        >
                          {group.turns.length}{" "}
                          {group.turns.length === 1 ? "turn" : "turns"}
                        </Badge>
                        {groupCueEvents.length > 0 && (
                          <Badge
                            variant="light"
                            color="terracotta"
                            size="xs"
                            radius="xl"
                          >
                            {groupCueEvents.length} cue
                          </Badge>
                        )}
                      </Group>
                    </Group>
                    <Stack gap="sm">
                      {merged.map((item) =>
                        item.kind === "turn" ? (
                          <ConversationBubble
                            key={`t-${item.turn.turnIndex}`}
                            turn={item.turn}
                          />
                        ) : (
                          <SystemEventBubble
                            key={`c-${item.event.key}`}
                            event={item.event}
                          />
                        )
                      )}
                    </Stack>
                  </Stack>
                );
              })}
            </Stack>
          </Box>
        )}
      </Card>

      {/*
        Cue Support Access events whose section/task/item identifiers don't
        match any transcript group (or whose timestamps are missing) are
        rendered here in their own block so faculty can still see them
        without us claiming a chronological position we can't verify.
      */}
      {evidenceStatus === "ok" && unmatchedEvents.length > 0 && (
        <Card withBorder p="xs">
          <Group justify="space-between" mb={6}>
            <Text size="sm" fw={500}>
              Cue Support Access Events
            </Text>
            <Badge variant="light" color="terracotta" size="xs" radius="xl">
              {unmatchedEvents.length}{" "}
              {unmatchedEvents.length === 1 ? "event" : "events"}
            </Badge>
          </Group>
          <Text size="xs" c="var(--claude-olive)" mb="sm">
            System events. Cue Support Access means the student clicked a cue
            button; it does not prove actual cue use. These events could not
            be placed reliably inside the transcript timeline above (missing
            section/task identifier, or missing timestamp).
          </Text>
          <Stack gap="sm">
            {unmatchedEvents.map((event) => (
              <SystemEventBubble key={event.key} event={event} />
            ))}
          </Stack>
        </Card>
      )}

      {/*
        Explicit "no cue events recorded" affordance — ONLY when the backend
        confirmed zero rows (status === "ok"). We must NOT render this when
        the evidence fetch failed; that would mislead faculty into reading a
        backend failure as a clinical signal.
      */}
      {evidenceStatus === "ok" && cueEvents.length === 0 && (
        <Card withBorder p="xs">
          <Group gap={6} wrap="nowrap">
            <Text size="xs" c="var(--claude-stone)" fw={500}>
              Cue Support Access:
            </Text>
            <Text size="xs" c="var(--claude-olive)">
              No cue events recorded for this session.
            </Text>
          </Group>
        </Card>
      )}

      {/*
        Backend evidence fetch failed (network / 5xx / non-2xx). Keep the
        transcript visible above; this strip just tells faculty that the
        cue-event side is currently unknown so they don't misread the
        absence as a clinical signal.
      */}
      {evidenceStatus === "error" && (
        <Card withBorder p="xs">
          <Group gap={6} wrap="nowrap">
            <Text size="xs" c="var(--claude-stone)" fw={500}>
              Cue Support Access:
            </Text>
            <Text size="xs" c="var(--claude-olive)">
              Cue evidence unavailable — could not load cue events for this
              session. Transcript above is unaffected.
            </Text>
          </Group>
        </Card>
      )}
    </Stack>
  );
}

// ───────────── Cue-event ↔ transcript-group bucketing ─────────────
//
// `transcriptGrouping.ts` keys each group on the same identifiers Unity
// stamps onto SessionTurn (progressKey, phaseId+taskId, phaseId+sectionId).
// We mirror the same keying rules on each cue_pressed event so events land
// inside the group they semantically belong to. When a cue event lacks the
// identifiers needed to land in any rendered group, it goes into
// `unmatchedEvents` for the separate Cue Support Access Events section.

import type { TranscriptGroup } from "../../../../shared/sessionDetail/transcriptGrouping";

function normalize(s: string | null | undefined): string {
  return typeof s === "string" ? s.trim().toLowerCase() : "";
}

function candidateGroupKeysForCueEvent(ev: CueSupportAccessEvent): string[] {
  // Cue events don't carry phaseId today, so we fall back to the section/task
  // tokens alone. The transcript-grouping helpers prefix keys with
  // "progress:" / "task:phase#task" / "section:phase#section". Without
  // phaseId we can't construct those prefixed keys; instead we test each
  // candidate group by suffix match below.
  const keys: string[] = [];
  const taskId = normalize(ev.taskId);
  const sectionId = normalize(ev.sectionId);
  if (taskId) keys.push(taskId);
  if (sectionId) keys.push(sectionId);
  return keys;
}

function groupKeyMatchesCueTokens(
  groupKey: string,
  cueTokens: string[]
): boolean {
  if (cueTokens.length === 0) return false;
  // groupKey looks like "progress:phase1#phase1-section-a" or
  // "section:phase1#phase1-section-a" or "task:phase1#phase1-section-a".
  // Match if any cue token equals the suffix after the "#".
  const hashIdx = groupKey.indexOf("#");
  const suffix = hashIdx >= 0 ? groupKey.slice(hashIdx + 1) : "";
  if (!suffix) return false;
  return cueTokens.some((t) => t === suffix);
}

interface CueBucket {
  eventsByGroup: Map<string, CueSupportAccessEvent[]>;
  unmatchedEvents: CueSupportAccessEvent[];
}

function bucketCueEventsByGroup(
  cueEvents: CueSupportAccessEvent[],
  transcriptGroups: TranscriptGroup[]
): CueBucket {
  const eventsByGroup = new Map<string, CueSupportAccessEvent[]>();
  const unmatchedEvents: CueSupportAccessEvent[] = [];
  for (const ev of cueEvents) {
    const cueTokens = candidateGroupKeysForCueEvent(ev);
    let matched = false;
    if (cueTokens.length > 0) {
      for (const g of transcriptGroups) {
        if (groupKeyMatchesCueTokens(g.key, cueTokens)) {
          const arr = eventsByGroup.get(g.key) ?? [];
          arr.push(ev);
          eventsByGroup.set(g.key, arr);
          matched = true;
          break;
        }
      }
    }
    if (!matched) unmatchedEvents.push(ev);
  }
  return { eventsByGroup, unmatchedEvents };
}

// ───────────── Interleave turns and cue events by timestamp ─────────────
//
// Within one transcript group, merge turns and cue events into a single
// chronological list. Turns are ordered by SessionTurn.timestamp. Cue events
// with a timestamp interleave by ascending timestamp; cue events without a
// timestamp slot to the end of the group rather than guessing a position.

type MergedTimelineItem =
  | { kind: "turn"; turn: SessionTurn; tsMs: number }
  | { kind: "cue"; event: CueSupportAccessEvent; tsMs: number | null };

function tsToMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function mergeTurnsAndCueEvents(
  turns: SessionTurn[],
  cueEvents: CueSupportAccessEvent[]
): MergedTimelineItem[] {
  const turnItems: MergedTimelineItem[] = turns.map((turn) => ({
    kind: "turn" as const,
    turn,
    tsMs: tsToMs(turn.timestamp) ?? 0,
  }));
  const timedCue: MergedTimelineItem[] = [];
  const untimedCue: MergedTimelineItem[] = [];
  for (const event of cueEvents) {
    const tsMs = tsToMs(event.timestamp);
    if (tsMs == null) {
      untimedCue.push({ kind: "cue", event, tsMs: null });
    } else {
      timedCue.push({ kind: "cue", event, tsMs });
    }
  }
  const timed = [...turnItems, ...timedCue].sort((a, b) => {
    const ma = a.tsMs ?? 0;
    const mb = b.tsMs ?? 0;
    return ma - mb;
  });
  return [...timed, ...untimedCue];
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
