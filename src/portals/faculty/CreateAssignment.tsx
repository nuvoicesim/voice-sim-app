import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import {
  Title, Text, Stack, TextInput, Textarea, Select, NumberInput,
  Switch, Button, Paper, Group, Badge, Box, ThemeIcon,
} from '@mantine/core';
import {
  IconFilePlus, IconArrowLeft, IconDeviceGamepad2,
  IconBook2, IconClipboardCheck, IconCalendar,
} from '@tabler/icons-react';
import { createAssignment } from '../../slices/assignmentSlice';
import { sceneCatalogApi } from '../../api/sceneCatalogApi';
import type { AppDispatch } from '../../store';

export default function CreateAssignment() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const [scenes, setScenes] = useState<any[]>([]);
  const [scenesLoading, setScenesLoading] = useState(true);
  const [scenesError, setScenesError] = useState<string | null>(null);
  const [form, setForm] = useState({
    sceneId: '',
    title: '',
    description: '',
    mode: 'practice' as 'practice' | 'assessment',
    maxAttempts: -1,
    dueDate: '',
    surveyEnabled: false,
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setScenesLoading(true);
    setScenesError(null);
    sceneCatalogApi.list()
      .then((data) => {
        const list = data.scenes || data.Items || [];
        setScenes(Array.isArray(list) ? list : []);
        if (list.length === 0) {
          setScenesError('No scenes found. Run the seed script: npx tsx scripts/seed-scene-catalog.ts');
        }
      })
      .catch((err) => {
        console.error('Failed to load scenes:', err);
        setScenesError(`Failed to load scenes: ${err?.message || err}`);
      })
      .finally(() => setScenesLoading(false));
  }, []);

  const handleSubmit = async () => {
    if (!form.sceneId || !form.title || !form.mode) return;
    setSubmitting(true);
    try {
      await dispatch(createAssignment({
        sceneId: form.sceneId,
        title: form.title,
        description: form.description,
        mode: form.mode,
        attemptPolicy: { maxAttempts: form.maxAttempts },
        surveyPolicy: { enabled: form.surveyEnabled, required: false, templateId: null, displayTiming: 'post-session' },
        dueDate: form.dueDate || null,
      }));
      navigate('/faculty/assignments');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedScene = scenes.find((s) => s.sceneId === form.sceneId);

  return (
    <Stack gap="xl" style={{ maxWidth: 720 }}>
      {/* ── Header ── */}
      <Box>
        <Button
          variant="subtle" color="gray" size="xs" radius="xl" px="sm" mb="xs"
          leftSection={<IconArrowLeft size={14} />}
          onClick={() => navigate('/faculty/assignments')}
        >
          Back to Assignments
        </Button>
        <Group gap="sm" mb={4}>
          <ThemeIcon size={38} radius="xl" variant="gradient" gradient={{ from: 'indigo', to: 'violet' }}>
            <IconFilePlus size={20} color="white" />
          </ThemeIcon>
          <Title order={2} fw={700}>Create Assignment</Title>
        </Group>
        <Text c="dimmed" size="sm" ml={52}>
          Configure a new assignment for your students
        </Text>
      </Box>

      {/* ── Scene selection ── */}
      <Paper radius="lg" p="lg" withBorder style={{ border: '1px solid #edf0f5' }}>
        <Group gap="xs" mb="md">
          <ThemeIcon size={26} radius="xl" variant="light" color="teal">
            <IconDeviceGamepad2 size={14} />
          </ThemeIcon>
          <Text fw={600} size="sm">Scene Configuration</Text>
        </Group>

        <Stack gap="md">
          <Select
            label="Simulation Scene"
            placeholder={scenesLoading ? 'Loading scenes...' : 'Select a simulation scene'}
            data={scenes.map((s) => ({ value: s.sceneId, label: `${s.title} (${s.scenarioKey})` }))}
            value={form.sceneId}
            onChange={(v) => setForm((prev) => ({ ...prev, sceneId: v || '' }))}
            disabled={scenesLoading}
            error={scenesError}
            required
            radius="md"
          />
          {selectedScene && (
            <Paper radius="md" p="sm" style={{ background: '#f0fff4', border: '1px solid #c6f6d5' }}>
              <Group gap="xs">
                <Text size="xs" c="dimmed">Linked Unity Game:</Text>
                {selectedScene.unityBuildFolder ? (
                  <Badge variant="dot" color="teal" size="sm">{selectedScene.unityBuildFolder}</Badge>
                ) : (
                  <Text size="xs" c="orange">No Unity game linked</Text>
                )}
              </Group>
            </Paper>
          )}
        </Stack>
      </Paper>

      {/* ── Assignment details ── */}
      <Paper radius="lg" p="lg" withBorder style={{ border: '1px solid #edf0f5' }}>
        <Group gap="xs" mb="md">
          <ThemeIcon size={26} radius="xl" variant="light" color="indigo">
            <IconBook2 size={14} />
          </ThemeIcon>
          <Text fw={600} size="sm">Assignment Details</Text>
        </Group>

        <Stack gap="md">
          <TextInput
            label="Title"
            placeholder="Assignment title"
            value={form.title}
            onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
            required
            radius="md"
          />
          <Textarea
            label="Description"
            placeholder="Optional description for students"
            value={form.description}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            minRows={3}
            radius="md"
          />
          <Select
            label="Mode"
            data={[
              { value: 'practice', label: 'Practice (retries allowed)' },
              { value: 'assessment', label: 'Assessment (limited attempts)' },
            ]}
            value={form.mode}
            onChange={(v) => setForm((prev) => ({ ...prev, mode: (v as any) || 'practice' }))}
            radius="md"
            leftSection={
              form.mode === 'assessment'
                ? <IconClipboardCheck size={16} style={{ color: 'var(--mantine-color-orange-5)' }} />
                : <IconBook2 size={16} style={{ color: 'var(--mantine-color-blue-5)' }} />
            }
          />
        </Stack>
      </Paper>

      {/* ── Policies ── */}
      <Paper radius="lg" p="lg" withBorder style={{ border: '1px solid #edf0f5' }}>
        <Group gap="xs" mb="md">
          <ThemeIcon size={26} radius="xl" variant="light" color="orange">
            <IconCalendar size={14} />
          </ThemeIcon>
          <Text fw={600} size="sm">Policies & Scheduling</Text>
        </Group>

        <Stack gap="md">
          <NumberInput
            label="Max Attempts"
            description="-1 for unlimited"
            value={form.maxAttempts}
            onChange={(v) => setForm((prev) => ({ ...prev, maxAttempts: Number(v) }))}
            min={-1}
            radius="md"
          />
          <TextInput
            label="Due Date"
            type="date"
            value={form.dueDate}
            onChange={(e) => setForm((prev) => ({ ...prev, dueDate: e.target.value }))}
            radius="md"
          />
          <Switch
            label="Enable Post-Session Survey"
            checked={form.surveyEnabled}
            onChange={(e) => {
              const checked = e.currentTarget.checked;
              setForm((prev) => ({ ...prev, surveyEnabled: checked }));
            }}
          />
        </Stack>
      </Paper>

      {/* ── Actions ── */}
      <Group justify="flex-end">
        <Button
          variant="subtle" color="gray" radius="md"
          onClick={() => navigate('/faculty/assignments')}
        >
          Cancel
        </Button>
        <Button
          radius="md"
          variant="gradient"
          gradient={{ from: 'indigo', to: 'violet' }}
          onClick={handleSubmit}
          loading={submitting}
        >
          Create Assignment
        </Button>
      </Group>
    </Stack>
  );
}
