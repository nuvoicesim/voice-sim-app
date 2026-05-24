import { useEffect, useState } from "react";
import {
  Box,
  Card,
  Stack,
  Text,
  Group,
  Badge,
  Button,
  Radio,
  Textarea,
  Loader,
  Alert,
  Divider,
} from "@mantine/core";
import { IconLock, IconBrain, IconCircleCheck } from "@tabler/icons-react";
import { moduleItemApi } from "../../../../api/moduleItemApi";
import { surveyInstanceApi } from "../../../../api/surveyInstanceApi";
import { MarkdownView } from "../../../../components/courses/MarkdownView";
import { useEventLog } from "../../../../hooks/useEventLog";
import { notify } from "../../../../utils/notify";

interface SubQuestion {
  assignmentItemId: string;
  assignmentTitle: string;
  locked: boolean;
  missing?: string[];
  bestSessionId?: string;
  blindedFeedback?: { displayKey: string; body: string; score: number | null }[];
  existingAnswer?: {
    pickedDisplayKey: string;
    isCorrect?: boolean;
    followUpText?: string;
    submittedAt?: string;
  };
}

export function AIDetectionPlayer({ item }: { item: any }) {
  const logEvent = useEventLog();
  const [loading, setLoading] = useState(true);
  const [subs, setSubs] = useState<SubQuestion[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { picked?: string; followUp?: string }>>({});
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});

  const loadSubs = async () => {
    setLoading(true);
    try {
      const r: any = await moduleItemApi.getSubQuestions(item.moduleItemId);
      setSubs(r.subQuestions || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSubs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.moduleItemId]);

  const handleSubmitSub = async (s: SubQuestion) => {
    const draft = drafts[s.assignmentItemId];
    if (!draft?.picked) return;
    setSubmitting((p) => ({ ...p, [s.assignmentItemId]: true }));
    try {
      await moduleItemApi.submitSubAnswer(
        item.moduleItemId,
        s.assignmentItemId,
        draft.picked,
        draft.followUp
      );
      logEvent("ai_detection_subquestion_submitted", {
        assignmentItemId: s.assignmentItemId,
      });
      // Reload to reflect locked state.
      await loadSubs();
    } catch (e: any) {
      notify.error(e.message || "unknown error", "Submit failed");
    } finally {
      setSubmitting((p) => ({ ...p, [s.assignmentItemId]: false }));
    }
  };

  const handleFinalize = async () => {
    try {
      await surveyInstanceApi.submit(item.moduleItemId);
      logEvent("ai_detection_finalized", {});
      await loadSubs();
    } catch (e: any) {
      notify.error(e.message || "unknown error", "Finalize failed");
    }
  };

  if (loading) return <Loader />;

  const allSubmitted = subs.every((s) => !!s.existingAnswer);

  return (
    <Stack gap="md">
      <Alert color="terracotta" variant="light" icon={<IconBrain size={16} />}>
        <Text size="sm">
          For each assignment below, you will see three pieces of feedback. One of them was written by
          AI; the other two were written by your two course instructors. Your task: identify which one
          you think is the AI.
        </Text>
        <Text size="sm" mt={4}>
          Each row only unlocks when both instructors have submitted their feedback for that
          assignment.
        </Text>
      </Alert>

      {subs.length === 0 ? (
        <Card withBorder p="xl" ta="center">
          <Text c="dimmed">No assignments configured for this AI detection survey.</Text>
        </Card>
      ) : (
        subs.map((s) => (
          <Card key={s.assignmentItemId} withBorder>
            <Group justify="space-between" mb="xs">
              <Text fw={600}>{s.assignmentTitle}</Text>
              {s.existingAnswer ? (
                <Badge color="terracotta" variant="light" leftSection={<IconCircleCheck size={12} />}>
                  Submitted
                </Badge>
              ) : s.locked ? (
                <Badge color="parchment" variant="light" leftSection={<IconLock size={12} />}>
                  Locked
                </Badge>
              ) : (
                <Badge color="terracotta" variant="filled">Available</Badge>
              )}
            </Group>

            {s.locked && (
              <Text size="sm" c="dimmed">
                Waiting for: {(s.missing || []).join(", ").replace(/_/g, " ")}
              </Text>
            )}

            {!s.locked && s.blindedFeedback && (
              <SubQuestionBody
                sub={s}
                draft={drafts[s.assignmentItemId] || {}}
                onPick={(picked) =>
                  setDrafts((p) => ({
                    ...p,
                    [s.assignmentItemId]: { ...p[s.assignmentItemId], picked },
                  }))
                }
                onFollowUp={(followUp) =>
                  setDrafts((p) => ({
                    ...p,
                    [s.assignmentItemId]: { ...p[s.assignmentItemId], followUp },
                  }))
                }
                onSubmit={() => handleSubmitSub(s)}
                submitting={!!submitting[s.assignmentItemId]}
                followUpQuestion={item.payload?.followUpQuestion}
              />
            )}
          </Card>
        ))
      )}

      {allSubmitted && subs.length > 0 && (
        <Group justify="flex-end">
          <Button onClick={handleFinalize}>Finalize all submissions</Button>
        </Group>
      )}
    </Stack>
  );
}

function SubQuestionBody({
  sub,
  draft,
  onPick,
  onFollowUp,
  onSubmit,
  submitting,
  followUpQuestion,
}: {
  sub: SubQuestion;
  draft: { picked?: string; followUp?: string };
  onPick: (v: string) => void;
  onFollowUp: (v: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  followUpQuestion?: { prompt: string; minWords?: number };
}) {
  const submitted = !!sub.existingAnswer;
  const picked = sub.existingAnswer?.pickedDisplayKey ?? draft.picked ?? "";

  return (
    <Stack gap="md" mt="xs">
      <Stack gap="xs">
        {(sub.blindedFeedback || []).map((fb) => (
          <Card
            key={fb.displayKey}
            withBorder
            shadow={picked === fb.displayKey ? "md" : undefined}
            style={{
              cursor: submitted ? "default" : "pointer",
              borderColor: picked === fb.displayKey ? "var(--claude-terracotta)" : undefined,
            }}
            onClick={() => !submitted && onPick(fb.displayKey)}
          >
            <Group gap="md" align="flex-start">
              <Radio
                value={fb.displayKey}
                checked={picked === fb.displayKey}
                onChange={() => !submitted && onPick(fb.displayKey)}
                disabled={submitted}
                label=""
              />
              <Box style={{ flex: 1 }}>
                <Group gap={6} mb={4}>
                  <Badge size="sm" variant="outline">
                    Source {fb.displayKey}
                  </Badge>
                  {fb.score != null && (
                    <Badge size="sm" color="parchment" variant="light">
                      {fb.score}/7
                    </Badge>
                  )}
                </Group>
                <MarkdownView markdown={fb.body || ""} />
              </Box>
            </Group>
          </Card>
        ))}
      </Stack>

      {followUpQuestion?.prompt && (
        <Box>
          <Text size="sm" fw={500} mb={4} style={{ whiteSpace: "pre-wrap" }}>
            {followUpQuestion.prompt}
          </Text>
          <Textarea
            value={sub.existingAnswer?.followUpText ?? draft.followUp ?? ""}
            onChange={(e) => onFollowUp(e.currentTarget.value)}
            autosize
            minRows={2}
            disabled={submitted}
          />
        </Box>
      )}

      <Divider />
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {submitted
            ? "Your answer has been recorded. Feedback for this assignment is now locked."
            : "Pick which source you think is the AI."}
        </Text>
        {!submitted && (
          <Button onClick={onSubmit} loading={submitting} disabled={!picked}>
            Submit Answer
          </Button>
        )}
      </Group>
    </Stack>
  );
}
