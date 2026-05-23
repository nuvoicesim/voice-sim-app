import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Anchor, Badge, Button, Card, Checkbox, Group, Stack, Text } from "@mantine/core";
import { IconCircleCheck, IconExternalLink } from "@tabler/icons-react";
import { markComplete, selectMyProgress } from "../../../../slices/studentProgressSlice";
import type { AppDispatch } from "../../../../store";
import { MarkdownView } from "../../../../components/courses/MarkdownView";
import { useEventLog } from "../../../../hooks/useEventLog";
import { notify } from "../../../../utils/notify";

export function ExternalLinkPlayer({ item }: { item: any }) {
  const dispatch = useDispatch<AppDispatch>();
  const logEvent = useEventLog();
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const url = item.payload?.url;
  const requireConfirm = !!item.payload?.requireConfirmation;
  const progress = useSelector(selectMyProgress(item.moduleItemId));
  const completed = progress?.state === "completed";

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      logEvent("simucase_completion_confirmed", { url });
      await dispatch(markComplete(item.moduleItemId)).unwrap();
      notify.success("Marked as complete");
    } catch (e: any) {
      notify.error(e?.message || "unknown error", "Failed to mark complete");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card withBorder>
      <Stack gap="md">
        {item.payload?.instructions && <MarkdownView markdown={item.payload.instructions} />}
        {url && (
          <Group>
            <Button
              component="a"
              href={url}
              target="_blank"
              leftSection={<IconExternalLink size={16} />}
              onClick={() => logEvent("simucase_link_opened", { url })}
            >
              Open external link
            </Button>
            <Text size="xs" c="dimmed">
              <Anchor href={url} target="_blank" rel="noreferrer">
                {url}
              </Anchor>
            </Text>
          </Group>
        )}
        {requireConfirm && !completed && (
          <Group>
            <Checkbox
              label="I confirm I have completed this activity"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.currentTarget.checked)}
            />
            <Button onClick={handleConfirm} loading={submitting} disabled={!confirmed}>
              Mark complete
            </Button>
          </Group>
        )}
        {completed && (
          <Group justify="flex-end">
            <Badge color="terracotta" size="lg" variant="light" leftSection={<IconCircleCheck size={14} />}>
              Completed
            </Badge>
          </Group>
        )}
        {completed && progress?.completedAt && (
          <Text size="xs" c="dimmed" ta="right">
            Completed on {new Date(progress.completedAt).toLocaleString()}
          </Text>
        )}
      </Stack>
    </Card>
  );
}
