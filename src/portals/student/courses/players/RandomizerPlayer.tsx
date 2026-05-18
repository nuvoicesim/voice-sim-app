import { useEffect, useState } from "react";
import { Card, Stack, Text, Button, Badge, Loader } from "@mantine/core";
import { moduleItemApi } from "../../../../api/moduleItemApi";
import { useEventLog } from "../../../../hooks/useEventLog";

export function RandomizerPlayer({ item }: { item: any }) {
  const logEvent = useEventLog();
  const [loading, setLoading] = useState(false);
  const [assignment, setAssignment] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Auto-trigger on first view.
    setLoading(true);
    moduleItemApi
      .randomize(item.moduleItemId)
      .then((r: any) => {
        setAssignment(r.assignment);
        if (!r.alreadyAssigned) {
          logEvent("group_assigned", { groupKey: r.assignment?.groupKey });
        }
      })
      .catch((e: any) => setError(e.message || "Failed"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.moduleItemId]);

  if (loading) return <Loader />;
  if (error)
    return (
      <Card withBorder>
        <Text c="red">{error}</Text>
        <Button mt="md" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </Card>
    );

  return (
    <Card withBorder p="xl">
      <Stack align="center" gap="md">
        <Text size="lg">Your assigned group is</Text>
        <Badge size="xl" color="terracotta" variant="filled">
          {assignment?.groupKey || "—"}
        </Badge>
        <Text size="sm" c="dimmed">
          This decides which path you'll take through the rest of the course.
        </Text>
      </Stack>
    </Card>
  );
}
