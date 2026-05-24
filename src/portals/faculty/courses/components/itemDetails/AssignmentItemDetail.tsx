import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Stack,
  Text,
  Loader,
  Badge,
  Group,
  Card,
  Button,
  Box,
} from "@mantine/core";
import { moduleItemApi } from "../../../../../api/moduleItemApi";

interface Props {
  itemId: string;
  studentUserId: string;
  courseId: string;
}

export function AssignmentItemDetail({
  itemId,
  studentUserId,
  courseId,
}: Props) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    moduleItemApi
      .getBestSession(itemId, studentUserId)
      .then((res: any) => {
        if (!cancelled) setData(res);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message || "Failed to load session");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId, studentUserId]);

  if (loading) return <Loader size="sm" />;
  if (error) return <Text c="terracotta">{error}</Text>;
  if (!data?.session)
    return (
      <Text size="sm" c="dimmed">
        No completed attempt yet.
      </Text>
    );

  const { session, turns = [], evaluation } = data;
  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Group gap="xs">
          <Badge color="terracotta" variant="light">
            attempt #{session.attemptNo}
          </Badge>
          {evaluation?.totalScore != null && (
            <Badge color="terracotta" variant="filled">
              {evaluation.totalScore}/24
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

      {evaluation?.overallExplanation && (
        <Card withBorder p="xs">
          <Text size="sm">{evaluation.overallExplanation}</Text>
        </Card>
      )}

      <Card withBorder p="xs">
        <Text size="sm" fw={500} mb={4}>
          Conversation ({turns.length} turns)
        </Text>
        <Stack gap={4} style={{ maxHeight: 280, overflowY: "auto" }}>
          {turns.map((t: any) => (
            <Box key={t.turnIndex}>
              <Text size="xs" c="dimmed">
                Turn {t.turnIndex}
              </Text>
              <Text size="sm">
                <b>Student:</b> {t.userText || "(silence)"}
              </Text>
              <Text size="sm">
                <b>Patient:</b> {t.modelText || "(silence)"}
              </Text>
            </Box>
          ))}
        </Stack>
      </Card>
    </Stack>
  );
}
