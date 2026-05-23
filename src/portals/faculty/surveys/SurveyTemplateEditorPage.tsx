import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { Box, Button, Group, Loader, Title, Anchor, Text, Alert } from "@mantine/core";
import { IconArrowLeft, IconAlertCircle } from "@tabler/icons-react";
import {
  fetchTemplate,
  selectCurrentTemplate,
  updateTemplate,
  clearCurrentTemplate,
} from "../../../slices/surveyTemplateSlice";
import type { AppDispatch } from "../../../store";
import { SurveyEditor } from "../../../components/courses/SurveyEditor";

export default function SurveyTemplateEditorPage() {
  const { templateId } = useParams<{ templateId: string }>();
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const template = useSelector(selectCurrentTemplate);

  const [draft, setDraft] = useState<{ title: string; description: string; questions: any[] } | null>(
    null
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (templateId) dispatch(fetchTemplate(templateId));
    return () => {
      dispatch(clearCurrentTemplate());
    };
  }, [dispatch, templateId]);

  useEffect(() => {
    if (template && template.surveyTemplateId === templateId) {
      setDraft({
        title: template.name,
        description: template.description || "",
        questions: template.questions || [],
      });
    }
  }, [template, templateId]);

  if (!draft) {
    return (
      <Box p="md">
        <Loader />
      </Box>
    );
  }

  const handleSave = async () => {
    if (!templateId) return;
    setSaving(true);
    try {
      await dispatch(
        updateTemplate({
          id: templateId,
          data: {
            name: draft.title,
            description: draft.description,
            questions: draft.questions,
          },
        })
      ).unwrap();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box p="md" maw={900} mx="auto">
      <Anchor onClick={() => navigate("/faculty/surveys")} mb="xs">
        <Group gap={4}>
          <IconArrowLeft size={14} />
          <Text size="sm">Back to templates</Text>
        </Group>
      </Anchor>
      <Title order={2} mb="md">
        Edit Survey Template
      </Title>
      <Alert color="yellow" icon={<IconAlertCircle size={16} />} mb="md">
        Editing this template will not affect students who have already started a survey instance —
        their answers are frozen against the snapshot taken when they first opened the survey.
      </Alert>
      <SurveyEditor
        title={draft.title}
        description={draft.description}
        questions={draft.questions}
        onChange={setDraft}
      />
      <Group justify="flex-end" mt="md">
        <Button onClick={handleSave} loading={saving} disabled={!draft.title.trim()}>
          Save Template
        </Button>
      </Group>
    </Box>
  );
}
