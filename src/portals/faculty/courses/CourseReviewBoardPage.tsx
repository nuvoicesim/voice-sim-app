import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
  Box,
  Title,
  Card,
  Group,
  Button,
  Stack,
  Text,
  Table,
  Loader,
  Anchor,
  Drawer,
  Badge,
  Slider,
} from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";
import {
  fetchCourse,
  selectCurrentCourse,
  fetchEnrollments,
  selectCurrentEnrollments,
  fetchInstructors,
  selectCurrentInstructors,
} from "../../../slices/courseSlice";
import { fetchModules, selectModulesByCourse } from "../../../slices/moduleSlice";
import { fetchItems } from "../../../slices/moduleItemSlice";
import { selectUserId } from "../../../slices/authSlice";
import type { AppDispatch } from "../../../store";
import { moduleItemApi } from "../../../api/moduleItemApi";
import { MarkdownView } from "../../../components/courses/MarkdownView";
import { MarkdownTextarea } from "../../../components/courses/MarkdownTextarea";
import { notify } from "../../../utils/notify";

export default function CourseReviewBoardPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const course = useSelector(selectCurrentCourse);
  const enrollments = useSelector(selectCurrentEnrollments);
  const instructors = useSelector(selectCurrentInstructors);
  const modules = useSelector(selectModulesByCourse(courseId || ""));
  const allItemsByModule = useSelector((s: any) => s.moduleItems.byModuleId);

  const [drawerOpen, setDrawerOpen] = useState<{
    studentUserId: string;
    studentEmail: string;
    moduleItemId: string;
    title: string;
  } | null>(null);

  useEffect(() => {
    if (courseId) {
      dispatch(fetchCourse(courseId));
      dispatch(fetchEnrollments(courseId));
      dispatch(fetchInstructors(courseId));
      dispatch(fetchModules(courseId));
    }
  }, [dispatch, courseId]);

  useEffect(() => {
    for (const m of modules) {
      if (!allItemsByModule[m.moduleId]) {
        dispatch(fetchItems(m.moduleId));
      }
    }
  }, [modules, allItemsByModule, dispatch]);

  if (!course) {
    return (
      <Box p="md">
        <Loader />
      </Box>
    );
  }

  const assignmentItems: Array<{ id: string; title: string; moduleTitle: string }> = [];
  for (const m of modules) {
    const list = allItemsByModule[m.moduleId] || [];
    for (const it of list) {
      if (it.itemType === "assignment") {
        assignmentItems.push({ id: it.moduleItemId, title: it.title, moduleTitle: m.title });
      }
    }
  }
  const activeStudents = enrollments.filter((e) => e.status === "active");

  return (
    <Box p="md">
      <Anchor onClick={() => navigate(`/faculty/courses/${courseId}`)} mb="xs">
        <Group gap={4}>
          <IconArrowLeft size={14} />
          <Text size="sm">Back to course</Text>
        </Group>
      </Anchor>
      <Title order={2} mb="md">
        Review Board: {course.title}
      </Title>
      <Card withBorder mb="md">
        <Text size="sm">
          Click a cell to view the student's best attempt and write your feedback. The matrix shows
          student × assignment status. Co-teacher feedback status is shown but content is private.
        </Text>
      </Card>

      {assignmentItems.length === 0 || activeStudents.length === 0 ? (
        <Card withBorder p="xl" ta="center">
          <Text c="dimmed">
            {activeStudents.length === 0
              ? "No active students enrolled."
              : "No assignment-type items in this course."}
          </Text>
        </Card>
      ) : (
        <Box style={{ overflowX: "auto" }}>
          <Table withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Student</Table.Th>
                {assignmentItems.map((a) => (
                  <Table.Th key={a.id}>
                    <Text size="xs" fw={600}>
                      {a.moduleTitle}
                    </Text>
                    <Text size="sm">{a.title}</Text>
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {activeStudents.map((e) => (
                <Table.Tr key={e.studentUserId}>
                  <Table.Td>{e.studentEmail || e.studentUserId}</Table.Td>
                  {assignmentItems.map((a) => (
                    <ReviewMatrixCell
                      key={a.id}
                      studentUserId={e.studentUserId}
                      studentEmail={e.studentEmail || e.studentUserId}
                      moduleItemId={a.id}
                      title={a.title}
                      onOpen={setDrawerOpen}
                      instructorIds={instructors.map((i) => i.facultyUserId)}
                    />
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Box>
      )}

      <Drawer
        opened={!!drawerOpen}
        onClose={() => setDrawerOpen(null)}
        position="right"
        size="xl"
        title={drawerOpen ? `${drawerOpen.studentEmail} — ${drawerOpen.title}` : ""}
      >
        {drawerOpen && (
          <ReviewerWorkspace
            studentUserId={drawerOpen.studentUserId}
            studentEmail={drawerOpen.studentEmail}
            moduleItemId={drawerOpen.moduleItemId}
            onClose={() => setDrawerOpen(null)}
          />
        )}
      </Drawer>
    </Box>
  );
}

function ReviewMatrixCell({
  studentUserId,
  studentEmail,
  moduleItemId,
  title,
  onOpen,
  instructorIds,
}: {
  studentUserId: string;
  studentEmail: string;
  moduleItemId: string;
  title: string;
  onOpen: (v: any) => void;
  instructorIds: string[];
}) {
  const myUserId = useSelector(selectUserId);
  const [progress, setProgress] = useState<any>(null);
  const [feedback, setFeedback] = useState<any[]>([]);

  useEffect(() => {
    moduleItemApi
      .getProgress(moduleItemId, studentUserId)
      .then((p: any) => setProgress(p.progress))
      .catch(() => {});
    moduleItemApi
      .listFeedback(moduleItemId, studentUserId)
      .then((f: any) => setFeedback(f.feedback || []))
      .catch(() => {});
  }, [moduleItemId, studentUserId]);

  const myFeedback = feedback.find(
    (f) => f.source === "reviewer" && f.reviewerUserId === myUserId
  );
  const aiFeedback = feedback.find((f) => f.source === "ai");
  const otherInstructorIds = instructorIds.filter((id) => id !== myUserId);
  const coTeacherFeedback = feedback.find(
    (f) => f.source === "reviewer" && otherInstructorIds.includes(f.reviewerUserId)
  );

  return (
    <Table.Td
      style={{ cursor: "pointer", textAlign: "center" }}
      onClick={() => onOpen({ studentUserId, studentEmail, moduleItemId, title })}
    >
      {progress?.bestSessionScore != null ? (
        <Stack gap={4} align="center">
          <Badge size="md" color="terracotta" variant="light">
            score {progress.bestSessionScore.toFixed?.(0) ?? progress.bestSessionScore}/24
          </Badge>
          <Group gap={4}>
            <FeedbackDot label="AI" present={!!aiFeedback} />
            <FeedbackDot label="Me" present={!!myFeedback} />
            <FeedbackDot label="Co" present={!!coTeacherFeedback} />
          </Group>
        </Stack>
      ) : (
        <Text size="xs" c="dimmed">
          —
        </Text>
      )}
    </Table.Td>
  );
}

function FeedbackDot({ label, present }: { label: string; present: boolean }) {
  return (
    <Badge size="xs" color={present ? "terracotta" : "parchment"} variant={present ? "filled" : "outline"}>
      {label}
      {present ? " ✓" : ""}
    </Badge>
  );
}

function ReviewerWorkspace({
  studentUserId,
  moduleItemId,
  onClose,
}: {
  studentUserId: string;
  studentEmail: string;
  moduleItemId: string;
  onClose: () => void;
}) {
  const myUserId = useSelector(selectUserId);
  const instructors = useSelector(selectCurrentInstructors);
  const [bestSession, setBestSession] = useState<any>(null);
  const [feedback, setFeedback] = useState<any[]>([]);
  const [score, setScore] = useState<number>(4);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      moduleItemApi.getBestSession(moduleItemId, studentUserId).catch(() => null),
      moduleItemApi.listFeedback(moduleItemId, studentUserId).catch(() => null),
    ]).then(([bs, fb]: any) => {
      setBestSession(bs);
      const list = fb?.feedback || [];
      setFeedback(list);
      const mine = list.find(
        (f: any) => f.source === "reviewer" && f.reviewerUserId === myUserId
      );
      if (mine) {
        setScore(mine.score ?? 4);
        setBody(mine.body || "");
      }
      setLoading(false);
    });
  }, [moduleItemId, studentUserId, myUserId]);

  const myFeedback = feedback.find(
    (f) => f.source === "reviewer" && f.reviewerUserId === myUserId
  );
  const otherInstructorIds = instructors
    .map((i) => i.facultyUserId)
    .filter((id) => id !== myUserId);
  const coTeacherSubmitted = feedback.some(
    (f) => f.source === "reviewer" && otherInstructorIds.includes(f.reviewerUserId)
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      await moduleItemApi.submitFeedback(moduleItemId, studentUserId, score, body);
      const fb: any = await moduleItemApi.listFeedback(moduleItemId, studentUserId);
      setFeedback(fb.feedback || []);
      notify.success("Feedback saved");
    } catch (e: any) {
      notify.error(e.message || "unknown error", "Failed to save feedback");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loader />;
  if (!bestSession?.session) {
    return <Text c="dimmed">No best session yet — student hasn't completed a simulation.</Text>;
  }

  const session = bestSession.session;
  const turns: any[] = bestSession.turns || [];
  const evaluation = bestSession.evaluation;
  const locked = !!myFeedback?.locked;

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text size="sm">
          Best attempt #{session.attemptNo} —{" "}
          <Badge color="terracotta" variant="light" size="sm">
            score {evaluation?.totalScore ?? "—"}/24
          </Badge>
        </Text>
        <Badge color={coTeacherSubmitted ? "terracotta" : "parchment"} variant={coTeacherSubmitted ? "filled" : "light"}>
          {coTeacherSubmitted ? "Co-teacher submitted ✓" : "Co-teacher pending"}
        </Badge>
      </Group>

      {evaluation?.overallExplanation && (
        <Card withBorder>
          <Text size="sm" fw={500} mb={4}>
            AI summary
          </Text>
          <MarkdownView markdown={evaluation.overallExplanation} />
        </Card>
      )}

      <Card withBorder>
        <Text size="sm" fw={500} mb="xs">
          Conversation history ({turns.length} turns)
        </Text>
        <Stack gap="xs" style={{ maxHeight: 300, overflowY: "auto" }}>
          {turns.map((t) => (
            <Box key={t.turnIndex}>
              <Text size="xs" c="dimmed">
                Turn {t.turnIndex}
              </Text>
              <Text size="sm">
                <b>Student:</b> {t.userText || "(silence)"}
              </Text>
              <Text size="sm">
                <b>Patient:</b> {t.modelText || "(silence)"}
              </Text>
            </Box>
          ))}
        </Stack>
      </Card>

      <Card withBorder>
        <Text fw={600} mb="xs">
          My feedback {locked && <Badge color="terracotta" variant="light">Locked (student submitted AI detection)</Badge>}
        </Text>
        <Stack gap="md">
          <Box>
            <Text size="sm" fw={500} mb={4}>
              Score: {score} / 7
            </Text>
            <Slider
              value={score}
              onChange={setScore}
              min={1}
              max={7}
              step={1}
              disabled={locked}
              marks={[1, 2, 3, 4, 5, 6, 7].map((v) => ({ value: v, label: String(v) }))}
            />
          </Box>
          <MarkdownTextarea
            label="Commentary"
            value={body}
            onChange={setBody}
            minRows={6}
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={onClose}>
              Close
            </Button>
            <Button onClick={handleSave} loading={saving} disabled={locked || !body.trim()}>
              {myFeedback ? "Update Feedback" : "Submit Feedback"}
            </Button>
          </Group>
        </Stack>
      </Card>
    </Stack>
  );
}
