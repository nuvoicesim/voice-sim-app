import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDispatch } from "react-redux";
import { Card, Stack, Text, Group, Button } from "@mantine/core";
import { IconRocket } from "@tabler/icons-react";
import { useEventLog } from "../../../../hooks/useEventLog";
import { startSession } from "../../../../slices/sessionSlice";
import type { AppDispatch } from "../../../../store";
import { notify } from "../../../../utils/notify";

export function AssignmentPlayer({ item, courseId }: { item: any; courseId: string }) {
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  const logEvent = useEventLog();
  const [launching, setLaunching] = useState(false);

  const assignmentId = item.payload?.assignmentId;

  const handleLaunch = async () => {
    if (!assignmentId) return;
    setLaunching(true);
    try {
      logEvent("voice_simulation_launched", { assignmentId });
      const result: any = await dispatch(startSession(assignmentId)).unwrap();
      const session = result.session;
      navigate(`/student/session/${session.sessionId}`, {
        state: { courseId, moduleItemId: item.moduleItemId, assignmentId },
      });
    } catch (e: any) {
      notify.error(e.message || "unknown error", "Failed to launch session");
    } finally {
      setLaunching(false);
    }
  };

  return (
    <Card withBorder>
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Voice Simulation Assignment
        </Text>
        <Text>
          Click below to launch the simulation. After completion, you can view your performance and
          retry if your assignment policy allows.
        </Text>
        <Group justify="flex-end">
          <Button
            leftSection={<IconRocket size={16} />}
            onClick={handleLaunch}
            loading={launching}
            disabled={!assignmentId}
          >
            Launch Simulation
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
