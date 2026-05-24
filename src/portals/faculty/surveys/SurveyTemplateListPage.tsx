import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import {
  ActionIcon,
  Box,
  Button,
  Card,
  Group,
  Stack,
  Text,
  Loader,
  TextInput,
  Modal,
  Textarea,
  ThemeIcon,
} from "@mantine/core";
import { IconPlus, IconClipboardCheck, IconTrash } from "@tabler/icons-react";
import {
  fetchTemplates,
  selectTemplates,
  createTemplate,
  deleteTemplate,
} from "../../../slices/surveyTemplateSlice";
import type { AppDispatch } from "../../../store";
import { PageHeader, EmptyState } from "../../../components/design";
import { notify } from "../../../utils/notify";

export default function SurveyTemplateListPage() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const templates = useSelector(selectTemplates);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dispatch(fetchTemplates()).finally(() => setLoading(false));
  }, [dispatch]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const t: any = await dispatch(
        createTemplate({ name: name.trim(), description, questions: [] })
      ).unwrap();
      setCreating(false);
      setName("");
      setDescription("");
      navigate(`/faculty/surveys/${t.surveyTemplateId}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Stack gap="xl">
      <PageHeader
        title="My Survey Templates"
        subtitle="Build and manage reusable survey question sets"
        actions={
          <Button color="terracotta" radius="lg" leftSection={<IconPlus size={14} />} onClick={() => setCreating(true)}>
            New Template
          </Button>
        }
      />

      {loading ? (
        <Loader color="terracotta" />
      ) : templates.length === 0 ? (
        <EmptyState
          icon={<IconClipboardCheck size={28} />}
          title="No templates yet"
          description="Create your first survey template to reuse across modules."
          ctaLabel="New Template"
          onCta={() => setCreating(true)}
        />
      ) : (
        <Stack gap="sm">
          {templates.map((t) => (
            <Card
              key={t.surveyTemplateId}
              p="lg"
              radius="lg"
              style={{
                cursor: "pointer",
                background: 'var(--claude-ivory)',
                border: '1px solid var(--claude-border-cream)',
                boxShadow: 'var(--claude-shadow-whisper)',
                transition: 'box-shadow 0.15s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 0 0 1px var(--claude-terracotta), var(--claude-shadow-whisper)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'var(--claude-shadow-whisper)'; }}
              onClick={() => navigate(`/faculty/surveys/${t.surveyTemplateId}`)}
            >
              <Group justify="space-between" wrap="nowrap">
                <Group gap="md" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                  <ThemeIcon size={32} radius="md" variant="light" color="terracotta">
                    <IconClipboardCheck size={16} />
                  </ThemeIcon>
                  <Box style={{ flex: 1, minWidth: 0 }}>
                    <Text fw={500} c="var(--claude-near-black)" style={{ fontFamily: 'Georgia, serif' }} lineClamp={1}>
                      {t.name}
                    </Text>
                    <Text size="sm" c="var(--claude-olive)" lineClamp={1}>
                      {t.description || `${t.questions.length} question${t.questions.length === 1 ? "" : "s"}`}
                    </Text>
                  </Box>
                </Group>
                <Group gap="sm" wrap="nowrap">
                  <Text size="xs" c="var(--claude-stone)">
                    {new Date(t.updatedAt).toLocaleDateString()}
                  </Text>
                  <ActionIcon
                    color="terracotta"
                    variant="subtle"
                    aria-label="Delete template"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!window.confirm(`Delete template "${t.name}"? This cannot be undone.`)) return;
                      try {
                        await dispatch(deleteTemplate(t.surveyTemplateId)).unwrap();
                        notify.success("Template deleted");
                      } catch (err: any) {
                        notify.error(err?.message || "unknown error", "Failed to delete template");
                      }
                    }}
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Group>
              </Group>
            </Card>
          ))}
        </Stack>
      )}

      <Modal opened={creating} onClose={() => setCreating(false)} title="New Survey Template" radius="lg">
        <Stack gap="sm">
          <TextInput label="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} required />
          <Textarea
            label="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            autosize
            minRows={2}
          />
          <Group justify="flex-end">
            <Button variant="subtle" color="parchment" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button color="terracotta" onClick={handleCreate} loading={submitting} disabled={!name.trim()}>
              Create
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
