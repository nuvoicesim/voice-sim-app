import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Card,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import {
  IconClock,
  IconMessageCircle,
  IconStarFilled,
  IconTrophy,
} from "@tabler/icons-react";
import { moduleItemApi } from "../../../../../api/moduleItemApi";
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
}

interface BestSessionResponse {
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

export function AssignmentItemDetail({
  itemId,
  studentUserId,
  courseId,
}: Props) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<BestSessionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    moduleItemApi
      .getBestSession(itemId, studentUserId)
      .then((res: unknown) => {
        if (!cancelled) setData(res as BestSessionResponse);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "Failed to load session";
          setError(msg);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId, studentUserId]);

  const turns = data?.turns ?? [];
  const transcriptGroups = useMemo(() => groupTranscriptTurns(turns), [turns]);

  if (loading) return <Loader size="sm" />;
  if (error) return <Text c="terracotta">{error}</Text>;
  if (!data?.session) {
    return (
      <Text size="sm" c="dimmed">
        No completed attempt yet.
      </Text>
    );
  }

  const session = data.session;
  const evaluation = data.evaluation ?? null;
  const duration = formatDuration(session.startedAt, session.endedAt);
  const perfColor = evaluation
    ? PERF_COLORS[evaluation.performanceLevel?.toLowerCase()] || "parchment"
    : "parchment";

  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="wrap">
        <Group gap="xs" wrap="wrap">
          <Badge color="terracotta" variant="light">
            attempt #{session.attemptNo}
          </Badge>
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
        <Button
          size="xs"
          variant="light"
          onClick={() => navigate(`/faculty/courses/${courseId}/reviews`)}
        >
          Open in Review Board
        </Button>
      </Group>

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

      {evaluation?.overallExplanation && (
        <Card withBorder p="xs">
          <Group gap={6} mb={4}>
            <ThemeIcon size={20} radius="md" variant="light" color="terracotta">
              <IconTrophy size={12} />
            </ThemeIcon>
            <Text size="sm" fw={500}>
              Evaluation
            </Text>
          </Group>
          <Text
            size="sm"
            c="var(--claude-olive)"
            style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}
          >
            {evaluation.overallExplanation}
          </Text>
        </Card>
      )}

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
            No conversation turns recorded.
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
