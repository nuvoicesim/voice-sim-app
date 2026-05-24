import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useParams } from "react-router-dom";
import {
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Loader,
  Radio,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconArrowLeft, IconCircleCheck, IconCircleX } from "@tabler/icons-react";
import {
  fetchMyConsent,
  selectMyConsentDecision,
  submitConsent,
} from "../../../../slices/consentSlice";
import type { AppDispatch } from "../../../../store";
import { MarkdownView } from "../../../../components/courses/MarkdownView";
import { notify } from "../../../../utils/notify";
import { useEventLog } from "../../../../hooks/useEventLog";

export function ConsentPlayer({ item }: { item: any }) {
  const dispatch = useDispatch<AppDispatch>();
  const decision = useSelector(selectMyConsentDecision(item.moduleItemId));
  const logEvent = useEventLog();
  const navigate = useNavigate();
  const { courseId } = useParams<{ courseId: string }>();
  const [loading, setLoading] = useState(decision === undefined);
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<"agreed" | "declined" | "">("");

  useEffect(() => {
    if (decision === undefined) {
      setLoading(true);
      dispatch(fetchMyConsent(item.moduleItemId)).finally(() => setLoading(false));
    }
  }, [dispatch, item.moduleItemId, decision]);

  const handleSubmit = async () => {
    if (picked !== "agreed" && picked !== "declined") return;
    setSubmitting(true);
    try {
      await dispatch(
        submitConsent({ itemId: item.moduleItemId, decision: picked })
      ).unwrap();
      logEvent("consent_decision_recorded", { decision: picked });
      notify.success(
        picked === "agreed"
          ? "Recorded: you agreed to participate"
          : "Recorded: you declined to participate"
      );
      setEditing(false);
      setPicked("");
      if (courseId) {
        navigate(`/student/courses/${courseId}`);
      }
    } catch (e: any) {
      notify.error(e?.message || "unknown error", "Failed to record decision");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Loader />;

  const showDecisionForm = !decision || editing;

  return (
    <Stack gap="md">
      <Card withBorder>
        <Stack gap={4}>
          <Title order={3} style={{ fontFamily: "Georgia, serif" }}>
            {item.payload?.title || item.title || "Informed Consent"}
          </Title>
          {item.payload?.studyName && (
            <Text size="sm" c="dimmed">
              {item.payload.studyName}
            </Text>
          )}
          {item.payload?.version && (
            <Text size="xs" c="dimmed">
              Version: {item.payload.version}
            </Text>
          )}
        </Stack>
      </Card>

      {decision && !editing && (
        <Card withBorder>
          <Group justify="space-between">
            <Group>
              {decision.decision === "agreed" ? (
                <>
                  <IconCircleCheck size={22} color="var(--mantine-color-green-7)" />
                  <Box>
                    <Text fw={600} c="green.7">
                      You agreed to participate
                    </Text>
                    <Text size="xs" c="dimmed">
                      Recorded on {new Date(decision.decidedAt).toLocaleString()}
                      {decision.consentVersion ? ` · version ${decision.consentVersion}` : ""}
                    </Text>
                  </Box>
                </>
              ) : (
                <>
                  <IconCircleX size={22} color="var(--mantine-color-gray-6)" />
                  <Box>
                    <Text fw={600}>You declined to participate</Text>
                    <Text size="xs" c="dimmed">
                      Recorded on {new Date(decision.decidedAt).toLocaleString()} · You will still
                      complete the required course activities; research surveys will be skipped.
                    </Text>
                  </Box>
                </>
              )}
            </Group>
            <Anchor size="sm" onClick={() => setEditing(true)}>
              Change my decision
            </Anchor>
          </Group>
        </Card>
      )}

      <Card withBorder>
        <MarkdownView markdown={item.payload?.markdown || ""} />
        {item.payload?.contactInfo && (
          <>
            <Divider my="md" />
            <Text size="sm" c="dimmed">
              {item.payload.contactInfo}
            </Text>
          </>
        )}
      </Card>

      {showDecisionForm && (
        <Card withBorder>
          <Stack gap="md">
            <Title order={5}>Consent Decision</Title>
            <Text size="sm" c="dimmed">
              Please review the information above and choose one option to continue.
            </Text>
            <Radio.Group
              value={picked}
              onChange={(v) => setPicked(v as any)}
            >
              <Stack gap="md">
                <Radio
                  value="agreed"
                  label={
                    <span style={{ whiteSpace: "pre-wrap" }}>
                      {item.payload?.agreeLabel ||
                        "I agree to participate in the research study."}
                    </span>
                  }
                />
                <Radio
                  value="declined"
                  label={
                    <span style={{ whiteSpace: "pre-wrap" }}>
                      {item.payload?.declineLabel ||
                        "I do not agree to participate in the research study."}
                    </span>
                  }
                />
              </Stack>
            </Radio.Group>
            <Group justify="flex-end">
              {editing && (
                <Button
                  variant="subtle"
                  onClick={() => {
                    setEditing(false);
                    setPicked("");
                  }}
                >
                  Cancel
                </Button>
              )}
              <Button
                onClick={handleSubmit}
                loading={submitting}
                disabled={picked !== "agreed" && picked !== "declined"}
              >
                Submit Decision
              </Button>
            </Group>
            {decision && (
              <Badge
                color={decision.decision === "agreed" ? "green" : "gray"}
                variant="light"
              >
                Currently recorded: {decision.decision}
              </Badge>
            )}
          </Stack>
        </Card>
      )}

      {courseId && (
        <Group justify="flex-start">
          <Button
            variant="default"
            leftSection={<IconArrowLeft size={16} />}
            onClick={() => navigate(`/student/courses/${courseId}`)}
          >
            Back to course
          </Button>
        </Group>
      )}
    </Stack>
  );
}
