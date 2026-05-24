import { useEffect, useState } from "react";
import { Stack, Text, Loader, Card, Group, Badge } from "@mantine/core";
import {
  surveyInstanceApi,
  type SurveyInstanceRow,
} from "../../../../../api/surveyInstanceApi";

interface Props {
  itemId: string;
  studentUserId: string;
}

export function SurveyItemDetail({ itemId, studentUserId }: Props) {
  const [loading, setLoading] = useState(true);
  const [instance, setInstance] = useState<SurveyInstanceRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    surveyInstanceApi
      .getForStudent(itemId, studentUserId)
      .then((res: any) => {
        if (!cancelled) setInstance(res?.instance ?? null);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message || "Failed to load survey");
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
  if (!instance)
    return (
      <Text size="sm" c="dimmed">
        Not started.
      </Text>
    );

  const questions: Array<{ id: string; prompt: string }> =
    instance.schemaSnapshot?.questions || [];
  const answers = instance.answers || {};

  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Badge
          color="terracotta"
          variant={instance.status === "submitted" ? "filled" : "light"}
        >
          {instance.status}
        </Badge>
        {instance.submittedAt && (
          <Text size="xs" c="dimmed">
            submitted {new Date(instance.submittedAt).toLocaleString()}
          </Text>
        )}
      </Group>

      {questions.length === 0 ? (
        <Text size="sm" c="dimmed">
          No questions in snapshot.
        </Text>
      ) : (
        questions.map((q) => (
          <Card key={q.id} withBorder p="xs">
            <Text size="sm" fw={500}>
              {q.prompt}
            </Text>
            <Text size="sm" mt={2}>
              {formatAnswer(answers[q.id])}
            </Text>
          </Card>
        ))
      )}
    </Stack>
  );
}

function formatAnswer(value: unknown): string {
  if (value == null || value === "") return "(no answer)";
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
