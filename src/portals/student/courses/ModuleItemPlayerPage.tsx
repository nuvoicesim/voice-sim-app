import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { Box, Loader, Anchor, Group, Text, Title, Card } from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";
import { fetchItem, selectCurrentItem } from "../../../slices/moduleItemSlice";
import { fetchMyProgress } from "../../../slices/studentProgressSlice";
import type { AppDispatch } from "../../../store";
import { CourseContextProvider } from "../../../hooks/useCourseContext";
import { useEventLog } from "../../../hooks/useEventLog";

import { AssignmentPlayer } from "./players/AssignmentPlayer";
import { SurveyPlayer } from "./players/SurveyPlayer";
import { ExternalLinkPlayer } from "./players/ExternalLinkPlayer";
import { DebriefPlayer } from "./players/DebriefPlayer";
import { InstructionPlayer } from "./players/InstructionPlayer";
import { RandomizerPlayer } from "./players/RandomizerPlayer";
import { AIDetectionPlayer } from "./players/AIDetectionPlayer";
import { ConsentPlayer } from "./players/ConsentPlayer";

export default function ModuleItemPlayerPage() {
  const { courseId, itemId } = useParams<{ courseId: string; itemId: string }>();
  return (
    <CourseContextProvider value={{ courseId, moduleItemId: itemId }}>
      <Inner />
    </CourseContextProvider>
  );
}

function Inner() {
  const { courseId, itemId } = useParams<{ courseId: string; itemId: string }>();
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const item = useSelector(selectCurrentItem);
  const logEvent = useEventLog();

  useEffect(() => {
    if (itemId) {
      dispatch(fetchItem(itemId));
      dispatch(fetchMyProgress(itemId));
    }
  }, [dispatch, itemId]);

  useEffect(() => {
    if (item && item.moduleItemId === itemId) {
      logEvent("module_item_opened", { itemType: item.itemType, title: item.title });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.moduleItemId, itemId]);

  if (!item || item.moduleItemId !== itemId) {
    return (
      <Box p="md">
        <Loader />
      </Box>
    );
  }

  return (
    <Box p="md" maw={900} mx="auto">
      <Anchor onClick={() => navigate(`/student/courses/${courseId}`)} mb="xs">
        <Group gap={4}>
          <IconArrowLeft size={14} />
          <Text size="sm">Back to course</Text>
        </Group>
      </Anchor>
      <Title order={2} mb="md">
        {item.title}
      </Title>
      <Player item={item} courseId={courseId!} />
    </Box>
  );
}

function Player({ item, courseId }: { item: any; courseId: string }) {
  switch (item.itemType) {
    case "assignment":
      return <AssignmentPlayer item={item} courseId={courseId} />;
    case "survey":
      return <SurveyPlayer item={item} />;
    case "external_link":
      return <ExternalLinkPlayer item={item} />;
    case "debrief":
      return <DebriefPlayer item={item} />;
    case "instruction":
      return <InstructionPlayer item={item} />;
    case "randomizer":
      return <RandomizerPlayer item={item} />;
    case "ai_detection":
      return <AIDetectionPlayer item={item} />;
    case "consent":
      return <ConsentPlayer item={item} />;
    default:
      return (
        <Card withBorder>
          <Text>Unsupported item type: {item.itemType}</Text>
        </Card>
      );
  }
}
