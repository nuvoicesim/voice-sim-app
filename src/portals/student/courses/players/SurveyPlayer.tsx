import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Card, Stack, Text, Loader } from "@mantine/core";
import {
  fetchInstance,
  saveAnswers,
  submitInstance,
  selectInstance,
} from "../../../../slices/surveyInstanceSlice";
import type { AppDispatch } from "../../../../store";
import { SurveyRunner } from "../../../../components/courses/SurveyRunner";
import { useEventLog } from "../../../../hooks/useEventLog";

export function SurveyPlayer({ item }: { item: any }) {
  const dispatch = useDispatch<AppDispatch>();
  const instance = useSelector(selectInstance(item.moduleItemId));
  const logEvent = useEventLog();
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saveTimer, setSaveTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    dispatch(fetchInstance(item.moduleItemId)).finally(() => setLoading(false));
  }, [dispatch, item.moduleItemId]);

  useEffect(() => {
    if (instance?.answers) setAnswers(instance.answers);
  }, [instance?.surveyInstanceId]);

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
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !instance) return <Loader />;

  const submitted = instance.status === "submitted";
  const questions = instance.schemaSnapshot?.questions || [];

  return (
    <Card withBorder>
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {instance.schemaSnapshot?.name || "Survey"}
        </Text>
        {submitted && (
          <Text size="sm" c="green">
            ✓ Submitted on {new Date(instance.submittedAt!).toLocaleString()}
          </Text>
        )}
        <SurveyRunner
          questions={questions}
          answers={answers}
          onChange={handleChange}
          disabled={submitted}
          onSubmit={submitted ? undefined : handleSubmit}
        />
      </Stack>
    </Card>
  );
}
