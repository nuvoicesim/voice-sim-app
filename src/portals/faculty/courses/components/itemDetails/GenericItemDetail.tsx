import { Stack, Text } from "@mantine/core";
import type { StudentItemProgress } from "../../../../../slices/studentProgressSlice";

interface Props {
  progress: StudentItemProgress | null | undefined;
  note?: string;
}

export function GenericItemDetail({ progress, note }: Props) {
  return (
    <Stack gap={4}>
      {progress?.completedAt ? (
        <Text size="sm">
          Completed at {new Date(progress.completedAt).toLocaleString()}.
        </Text>
      ) : (
        <Text size="sm" c="dimmed">
          Not completed yet.
        </Text>
      )}
      {note && (
        <Text size="sm" c="dimmed" fs="italic">
          {note}
        </Text>
      )}
    </Stack>
  );
}
