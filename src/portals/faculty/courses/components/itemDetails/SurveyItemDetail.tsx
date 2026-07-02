import { useEffect, useState } from "react";
import { Stack, Text, Loader, Card, Group, Badge } from "@mantine/core";
import {
  surveyInstanceApi,
  type SurveyInstanceRow,
} from "../../../../../api/surveyInstanceApi";
import {
  formatAnswer,
  likertScaleHint,
  type SurveyQuestionDef,
} from "../../../../../utils/surveyAnswerFormat";

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
      .then((res) => {
        if (!cancelled) setInstance(res?.instance ?? null);
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load survey");
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

  // Full question definitions (including choice option value→label pairs)
  // are available in the instance's frozen schemaSnapshot — use them so
  // answers render as the labels students actually saw, not internal
  // values like "opt1".
  const questions: SurveyQuestionDef[] = instance.schemaSnapshot?.questions || [];
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
        questions.map((q) => {
          const scaleHint = likertScaleHint(q);
          return (
            <Card key={q.id} withBorder p="xs">
              <Text size="sm" fw={500}>
                {q.prompt}
              </Text>
              <Text size="sm" mt={2}>
                {formatAnswer(q, answers[q.id], answers, "(no answer)")}
              </Text>
              {scaleHint && (
                <Text size="xs" c="dimmed" mt={2}>
                  {scaleHint}
                </Text>
              )}
            </Card>
          );
        })
      )}
    </Stack>
  );
}
