import { useEffect, useState } from "react";
import { Stack, Text, Loader, Card, Group, Badge } from "@mantine/core";
import { moduleItemApi } from "../../../../../api/moduleItemApi";

interface SubQuestion {
  assignmentItemId: string;
  assignmentTitle: string;
  locked: boolean;
  missing?: string[];
  bestSessionId?: string;
  blindedFeedback?: any[];
  existingAnswer?: {
    pickedDisplayKey?: string;
    followUpText?: string;
  } | null;
}

interface Props {
  itemId: string;
  studentUserId: string;
}

export function AIDetectionItemDetail({ itemId, studentUserId }: Props) {
  const [loading, setLoading] = useState(true);
  const [subQuestions, setSubQuestions] = useState<SubQuestion[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    moduleItemApi
      .getSubQuestions(itemId, studentUserId)
      .then((res: any) => {
        if (!cancelled) setSubQuestions(res?.subQuestions || []);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message || "Failed to load");
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
  if (subQuestions.length === 0)
    return (
      <Text size="sm" c="dimmed">
        No sub-questions yet.
      </Text>
    );

  return (
    <Stack gap="xs">
      {subQuestions.map((sq) => (
        <Card key={sq.assignmentItemId} withBorder p="xs">
          <Group gap="xs" mb={4}>
            <Text fw={500}>{sq.assignmentTitle}</Text>
            {sq.locked ? (
              <Badge color="parchment" variant="outline">
                locked
              </Badge>
            ) : (
              <Badge color="terracotta" variant="light">
                unlocked
              </Badge>
            )}
          </Group>
          {sq.locked && sq.missing && sq.missing.length > 0 && (
            <Text size="xs" c="dimmed">
              Missing: {sq.missing.join(", ")}
            </Text>
          )}
          {sq.existingAnswer ? (
            <>
              <Text size="sm">
                <b>Pick:</b> {sq.existingAnswer.pickedDisplayKey || "(none)"}
              </Text>
              {sq.existingAnswer.followUpText && (
                <Text size="sm">
                  <b>Follow-up:</b> {sq.existingAnswer.followUpText}
                </Text>
              )}
            </>
          ) : (
            <Text size="sm" c="dimmed">
              No answer recorded.
            </Text>
          )}
        </Card>
      ))}
    </Stack>
  );
}
