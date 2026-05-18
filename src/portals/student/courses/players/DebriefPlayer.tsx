import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Badge, Button, Card, Group, Stack, Textarea, Text } from "@mantine/core";
import { IconCircleCheck } from "@tabler/icons-react";
import { markComplete, selectMyProgress } from "../../../../slices/studentProgressSlice";
import type { AppDispatch } from "../../../../store";
import { MarkdownView } from "../../../../components/courses/MarkdownView";
import { useEventLog } from "../../../../hooks/useEventLog";
import { notify } from "../../../../utils/notify";

export function DebriefPlayer({ item }: { item: any }) {
  const dispatch = useDispatch<AppDispatch>();
  const logEvent = useEventLog();
  const [reflection, setReflection] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const progress = useSelector(selectMyProgress(item.moduleItemId));
  const completed = progress?.state === "completed";

  const handleComplete = async () => {
    setSubmitting(true);
    try {
      logEvent("debrief_rating_submitted", { length: reflection.length });
      await dispatch(markComplete(item.moduleItemId)).unwrap();
      notify.success("Debrief submitted");
    } catch (e: any) {
      notify.error(e?.message || "unknown error", "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card withBorder>
      <Stack gap="md">
        <MarkdownView markdown={item.payload?.markdown || ""} />
        {!completed && (
          <>
            <Text size="sm" fw={500}>
              Your reflection (optional)
            </Text>
            <Textarea
              value={reflection}
              onChange={(e) => setReflection(e.currentTarget.value)}
              autosize
              minRows={4}
              placeholder="What did you learn? What would you do differently?"
            />
          </>
        )}
        <Group justify="flex-end">
          {completed ? (
            <Badge color="terracotta" size="lg" variant="light" leftSection={<IconCircleCheck size={14} />}>
              Completed
            </Badge>
          ) : (
            <Button onClick={handleComplete} loading={submitting}>
              Submit & mark complete
            </Button>
          )}
        </Group>
        {completed && progress?.completedAt && (
          <Text size="xs" c="dimmed" ta="right">
            Completed on {new Date(progress.completedAt).toLocaleString()}
          </Text>
        )}
      </Stack>
    </Card>
  );
}
