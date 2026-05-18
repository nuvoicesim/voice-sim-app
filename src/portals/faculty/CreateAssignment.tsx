import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import {
  Text, Stack, TextInput, Textarea, Select, NumberInput,
  Button, Group, Badge, ThemeIcon, Alert,
} from '@mantine/core';
import {
  IconArrowLeft, IconDeviceGamepad2,
  IconBook2, IconClipboardCheck, IconCalendar, IconAlertCircle,
} from '@tabler/icons-react';
import { createAssignment } from '../../slices/assignmentSlice';
import { sceneCatalogApi } from '../../api/sceneCatalogApi';
import { patientProfileApi } from '../../api/patientProfileApi';
import { assignmentApi } from '../../api/assignmentApi';
import type { AppDispatch } from '../../store';
import { PageHeader, SectionCard } from '../../components/design';

interface SceneOption {
  sceneId: string;
  title: string;
  scenarioKey: string;
  unityBuildId?: string | null;
  unityBuildFolder?: string | null;
}

interface PatientProfileOption {
  patientProfileId: string;
  displayName: string;
  profileKey: string;
  status: 'draft' | 'published' | 'archived';
}

interface AssignmentFormState {
  sceneId: string;
  patientProfileId: string;
  title: string;
  description: string;
  mode: 'practice' | 'assessment';
  maxAttempts: number;
  dueDate: string;
}

const DEFAULT_FORM: AssignmentFormState = {
  sceneId: '',
  patientProfileId: '',
  title: '',
  description: '',
  mode: 'practice',
  maxAttempts: -1,
  dueDate: '',
};

export default function CreateAssignment() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const isEditing = Boolean(assignmentId);
  const assignmentsPath = '/faculty/assignments';
  const [scenes, setScenes] = useState<SceneOption[]>([]);
  const [profiles, setProfiles] = useState<PatientProfileOption[]>([]);
  const [scenesLoading, setScenesLoading] = useState(true);
  const [scenesError, setScenesError] = useState<string | null>(null);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [assignmentLoading, setAssignmentLoading] = useState(isEditing);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [form, setForm] = useState<AssignmentFormState>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setScenesLoading(true);
    setScenesError(null);
    setProfilesLoading(true);
    setProfilesError(null);
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

    patientProfileApi.list()
      .then((data) => {
        const list = data.patientProfiles || [];
        setProfiles(Array.isArray(list) ? list : []);
        if (list.length === 0) {
          setProfilesError('No patient profiles found. Create one in the Simulation Designer portal first.');
        }
      })
      .catch((err) => {
        console.error('Failed to load patient profiles:', err);
        setProfilesError(`Failed to load patient profiles: ${err?.message || err}`);
      })
      .finally(() => setProfilesLoading(false));
  }, []);

  useEffect(() => {
    if (!assignmentId) {
      setAssignmentLoading(false);
      setAssignmentError(null);
      setForm(DEFAULT_FORM);
      return;
    }

    setAssignmentLoading(true);
    setAssignmentError(null);

    assignmentApi.get(assignmentId)
      .then((assignment) => {
        setForm({
          sceneId: assignment.sceneId || '',
          patientProfileId: assignment.patientProfileId || '',
          title: assignment.title || '',
          description: assignment.description || '',
          mode: assignment.mode === 'assessment' ? 'assessment' : 'practice',
          maxAttempts: typeof assignment.attemptPolicy?.maxAttempts === 'number'
            ? assignment.attemptPolicy.maxAttempts
            : -1,
          dueDate: assignment.dueDate ? String(assignment.dueDate).slice(0, 10) : '',
        });
      })
      .catch((err) => {
        console.error('Failed to load assignment:', err);
        setAssignmentError(`Failed to load assignment: ${err?.message || err}`);
      })
      .finally(() => setAssignmentLoading(false));
  }, [assignmentId]);

  const handleSubmit = async () => {
    if (!form.sceneId || !form.patientProfileId || !form.title || !form.mode) return;
    const selectedScene = scenes.find((scene) => scene.sceneId === form.sceneId);
    if (!selectedScene?.unityBuildId) {
      setAssignmentError('Assignments require a scene with a published Unity build.');
      return;
    }
    setSubmitting(true);
    setAssignmentError(null);
    try {
      const payload = {
        sceneId: form.sceneId,
        patientProfileId: form.patientProfileId,
        title: form.title,
        description: form.description,
        mode: form.mode,
        attemptPolicy: { maxAttempts: form.maxAttempts },
        dueDate: form.dueDate || null,
      };

      if (assignmentId) {
        await assignmentApi.update(assignmentId, payload);
      } else {
        await dispatch(createAssignment(payload)).unwrap();
      }
      navigate(assignmentsPath);
    } catch (err) {
      console.error('Failed to save assignment:', err);
      setAssignmentError(`Failed to save assignment: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const selectedScene = scenes.find((s) => s.sceneId === form.sceneId);
  const selectedProfile = profiles.find((p) => p.patientProfileId === form.patientProfileId);
  const pageTitle = isEditing ? 'Edit Assignment' : 'Create Assignment';
  const pageDescription = isEditing
    ? 'Update assignment details, targeting, and delivery settings'
    : 'Configure a new assignment for your students';
  const submitLabel = isEditing ? 'Save Changes' : 'Create Assignment';

  return (
    <Stack gap="xl" style={{ maxWidth: 720 }}>
      <Button
        variant="subtle" color="parchment" size="xs" radius="xl" px="sm"
        leftSection={<IconArrowLeft size={14} />}
        onClick={() => navigate(assignmentsPath)}
        style={{ alignSelf: 'flex-start' }}
      >
        Back to Assignments
      </Button>
      <PageHeader title={pageTitle} subtitle={pageDescription} />

      {assignmentError && (
        <Alert color="terracotta" radius="md" icon={<IconAlertCircle size={16} />}>
          {assignmentError}
        </Alert>
      )}

      {/* ── Scene selection ── */}
      <SectionCard
        title={
          <Group gap="xs">
            <ThemeIcon size={26} radius="md" variant="light" color="terracotta">
              <IconDeviceGamepad2 size={14} />
            </ThemeIcon>
            <Text fw={500} size="md" c="var(--claude-near-black)">Scene Configuration</Text>
          </Group>
        }
      >
        <Stack gap="md">
          <Select
            label="Simulation Scene"
            placeholder={scenesLoading ? 'Loading scenes...' : 'Select a simulation scene'}
            data={scenes.map((s) => ({
              value: s.sceneId,
              label: s.unityBuildId
                ? `${s.title} (${s.scenarioKey})`
                : `${s.title} (${s.scenarioKey}) - no published Unity build`,
              disabled: !s.unityBuildId,
            }))}
            value={form.sceneId}
            onChange={(v) => setForm((prev) => ({ ...prev, sceneId: v || '' }))}
            disabled={scenesLoading || assignmentLoading}
            error={scenesError}
            required
            radius="md"
          />
          <Select
            label="Patient Profile"
            placeholder={profilesLoading ? 'Loading patient profiles...' : 'Select a patient profile'}
            data={profiles.map((profile) => ({
              value: profile.patientProfileId,
              label: `${profile.displayName} (${profile.profileKey})`,
            }))}
            value={form.patientProfileId}
            onChange={(value) => setForm((prev) => ({ ...prev, patientProfileId: value || '' }))}
            disabled={profilesLoading || assignmentLoading}
            error={profilesError}
            required
            radius="md"
          />
          {selectedScene && (
            <Stack gap={6} p="sm" style={{ background: 'var(--claude-parchment)', border: '1px solid var(--claude-border-warm)', borderRadius: 8 }}>
              <Group gap="xs">
                <Text size="xs" c="var(--claude-stone)">Linked Unity Game:</Text>
                {selectedScene.unityBuildId ? (
                  <Badge variant="dot" color="terracotta" size="sm">Managed build linked</Badge>
                ) : (
                  <Text size="xs" c="var(--claude-terracotta)">No published Unity build linked</Text>
                )}
              </Group>
            </Stack>
          )}
          {selectedProfile && (
            <Stack gap={6} p="sm" style={{ background: 'var(--claude-parchment)', border: '1px solid var(--claude-border-warm)', borderRadius: 8 }}>
              <Group gap="xs">
                <Text size="xs" c="var(--claude-stone)">Selected Patient:</Text>
                <Badge variant="dot" color="terracotta" size="sm">{selectedProfile.displayName}</Badge>
                <Badge variant="light" color="parchment" size="sm">{selectedProfile.profileKey}</Badge>
              </Group>
            </Stack>
          )}
        </Stack>
      </SectionCard>

      {/* ── Assignment details ── */}
      <SectionCard
        title={
          <Group gap="xs">
            <ThemeIcon size={26} radius="md" variant="light" color="terracotta">
              <IconBook2 size={14} />
            </ThemeIcon>
            <Text fw={500} size="md" c="var(--claude-near-black)">Assignment Details</Text>
          </Group>
        }
      >
        <Stack gap="md">
          <TextInput
            label="Title"
            placeholder="Assignment title"
            value={form.title}
            onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
            required
            radius="md"
            disabled={assignmentLoading}
          />
          <Textarea
            label="Description"
            placeholder="Optional description for students"
            value={form.description}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            minRows={3}
            radius="md"
            disabled={assignmentLoading}
          />
          <Select
            label="Mode"
            data={[
              { value: 'practice', label: 'Practice (retries allowed)' },
              { value: 'assessment', label: 'Assessment (limited attempts)' },
            ]}
            value={form.mode}
            onChange={(v) =>
              setForm((prev) => ({
                ...prev,
                mode: v === 'assessment' ? 'assessment' : 'practice',
              }))
            }
            radius="md"
            disabled={assignmentLoading}
            leftSection={
              form.mode === 'assessment'
                ? <IconClipboardCheck size={16} style={{ color: 'var(--claude-terracotta)' }} />
                : <IconBook2 size={16} style={{ color: 'var(--claude-stone)' }} />
            }
          />
        </Stack>
      </SectionCard>

      {/* ── Policies ── */}
      <SectionCard
        title={
          <Group gap="xs">
            <ThemeIcon size={26} radius="md" variant="light" color="terracotta">
              <IconCalendar size={14} />
            </ThemeIcon>
            <Text fw={500} size="md" c="var(--claude-near-black)">Policies & Scheduling</Text>
          </Group>
        }
      >
        <Stack gap="md">
          <NumberInput
            label="Max Attempts"
            description="-1 for unlimited"
            value={form.maxAttempts}
            onChange={(v) => setForm((prev) => ({ ...prev, maxAttempts: Number(v) }))}
            min={-1}
            radius="md"
            disabled={assignmentLoading}
          />
          <TextInput
            label="Due Date"
            type="date"
            value={form.dueDate}
            onChange={(e) => setForm((prev) => ({ ...prev, dueDate: e.target.value }))}
            radius="md"
            disabled={assignmentLoading}
          />
        </Stack>
      </SectionCard>

      {/* ── Actions ── */}
      <Group justify="flex-end">
        <Button
          variant="subtle" color="parchment" radius="md"
          onClick={() => navigate(assignmentsPath)}
        >
          Cancel
        </Button>
        <Button
          radius="md"
          color="terracotta"
          onClick={handleSubmit}
          loading={submitting}
          disabled={assignmentLoading || Boolean(assignmentError)}
        >
          {submitLabel}
        </Button>
      </Group>
    </Stack>
  );
}
