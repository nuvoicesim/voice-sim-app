import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Alert, Button, Card, Stack, Text, Loader } from "@mantine/core";
import { IconLock } from "@tabler/icons-react";
import {
  fetchInstance,
  saveAnswers,
  submitInstance,
  selectInstance,
} from "../../../../slices/surveyInstanceSlice";
import type { AppDispatch } from "../../../../store";
import { SurveyRunner } from "../../../../components/courses/SurveyRunner";
import { useEventLog } from "../../../../hooks/useEventLog";
import {
  FeedbackCardDeck,
  type FeedbackCardData,
} from "../../../../components/courses/FeedbackCardDeck";
import { buildPhase3SectionHeaders } from "./phase3-section-headers";

export function SurveyPlayer({ item }: { item: any }) {
  const dispatch = useDispatch<AppDispatch>();
  const instance = useSelector(selectInstance(item.moduleItemId));
  const logEvent = useEventLog();
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveTimer, setSaveTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [cards, setCards] = useState<FeedbackCardData[] | null>(null);
  const isPhase3 = Boolean(item?.payload?.feedbackCardsFromItemId);

  const load = async (resetCards = false) => {
    if (resetCards) setCards(null);
    try {
      const res = (await dispatch(fetchInstance(item.moduleItemId)).unwrap()) as {
        instance?: { phase3Cards?: unknown };
      };
      const loaded = res?.instance?.phase3Cards;
      if (Array.isArray(loaded)) setCards(loaded as FeedbackCardData[]);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Unable to load this survey.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, item.moduleItemId]);

  useEffect(() => {
    if (instance?.answers) setAnswers(instance.answers);
  }, [instance?.surveyInstanceId]);

  const sectionHeaders = useMemo(() => buildPhase3SectionHeaders(item), [item]);

  const handleChange = (qId: string, val: any) => {
    setAnswers((prev) => {
      const next = { ...prev, [qId]: val };
      // Debounced autosave.
      if (saveTimer) clearTimeout(saveTimer);
      const t = setTimeout(() => {
        dispatch(saveAnswers({ itemId: item.moduleItemId, answers: next }));
      }, 600);
      setSaveTimer(t);
      return next;
    });
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      // Final save then submit.
      await dispatch(saveAnswers({ itemId: item.moduleItemId, answers })).unwrap();
      await dispatch(submitInstance(item.moduleItemId)).unwrap();
      logEvent("survey_submitted", { surveyTemplateId: item.payload?.surveyTemplateId });
      if (isPhase3) await load();
    } finally {
      setSubmitting(false);
    }
  };

  const retryReveal = async () => {
    setSubmitting(true);
    try {
      await dispatch(submitInstance(item.moduleItemId)).unwrap();
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Loader />;

  if (loadError || !instance) {
    return (
      <Card withBorder>
        <Alert color="parchment" variant="light" icon={<IconLock size={16} />}>
          <Text fw={600} mb={4}>
            {isPhase3 ? "Phase 3 is not available for your account" : "Survey unavailable"}
          </Text>
          <Text size="sm">
            {isPhase3
              ? "This activity opens only once all three feedback cards for your session have been prepared. If you believe this is an error, please contact the study team."
              : loadError || "This survey could not be loaded."}
          </Text>
        </Alert>
      </Card>
    );
  }

  const submitted = instance.status === "submitted";
  const questions = instance.schemaSnapshot?.questions || [];
  const description = instance.schemaSnapshot?.description;
  const revealPending =
    isPhase3 &&
    submitted &&
    Boolean(item?.payload?.revealOnSubmit?.unblindAssignmentItemId) &&
    Boolean(cards?.some((card) => card.sourceType === null));

  if (isPhase3 && (!cards || cards.length === 0)) {
    return (
      <Card withBorder>
        <Alert color="parchment" variant="light" icon={<IconLock size={16} />}>
          <Text fw={600} mb={4}>Feedback cards unavailable</Text>
          <Text size="sm">
            Your feedback cards could not be loaded, so this survey cannot be started yet.
            Please contact the study team.
          </Text>
        </Alert>
      </Card>
    );
  }

  return (
    <Card withBorder>
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {instance.schemaSnapshot?.name || "Survey"}
        </Text>
        {description && (
          <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
            {description}
          </Text>
        )}
        {submitted && (
          <Text size="sm" c="green">
            ✓ Submitted on {new Date(instance.submittedAt!).toLocaleString()}
          </Text>
        )}
        {revealPending && (
          <Alert color="terracotta" variant="light" icon={<IconLock size={16} />}>
            <Text size="sm" fw={600}>Your blind responses are saved and locked.</Text>
            <Text size="sm" mb="xs">
              The source reveal has not completed yet, so Part D remains unavailable.
            </Text>
            <Button size="xs" variant="light" loading={submitting} onClick={retryReveal}>
              Retry source reveal
            </Button>
          </Alert>
        )}
        {isPhase3 && cards && cards.length > 0 && <FeedbackCardDeck cards={cards} />}
        <SurveyRunner
          questions={questions}
          answers={answers}
          onChange={handleChange}
          disabled={submitted}
          onSubmit={submitted ? undefined : handleSubmit}
          sectionHeaders={sectionHeaders}
          hideQuestionNumbers={item?.payload?.hideQuestionNumbers === true}
        />
      </Stack>
    </Card>
  );
}
