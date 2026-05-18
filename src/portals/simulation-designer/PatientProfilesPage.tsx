import { useEffect, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Modal,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
} from '@mantine/core';
import {
  IconArchive,
  IconBrain,
  IconEdit,
  IconHeadphones,
  IconInbox,
  IconMessageChatbot,
  IconPlus,
} from '@tabler/icons-react';
import { patientProfileApi, type PatientProfilePayload } from '../../api/patientProfileApi';
import { PageHeader, EmptyState } from '../../components/design';

interface PromptConfig {
  systemPrompt: string;
  version?: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

interface TtsConfig {
  profileId?: string;
  version?: string;
  voiceId: string;
  modelId: string;
  stability?: number;
  similarityBoost?: number;
  styleExaggeration?: number;
  speed?: number;
}

interface PatientProfile {
  patientProfileId: string;
  displayName: string;
  profileKey: string;
  dialogueConfig: PromptConfig;
  scoringConfig: PromptConfig;
  ttsConfig: TtsConfig;
  status: 'draft' | 'published' | 'archived';
  createdAt: string;
  updatedAt: string;
}

interface PatientProfileFormState {
  displayName: string;
  profileKey: string;
  dialoguePrompt: string;
  dialogueVersion: string;
  dialogueModel: string;
  dialogueTemperature: number;
  dialogueMaxOutputTokens: number;
  scoringPrompt: string;
  scoringVersion: string;
  scoringModel: string;
  scoringTemperature: number;
  scoringMaxOutputTokens: number;
  voiceProfileId: string;
  voiceVersion: string;
  voiceId: string;
  voiceModelId: string;
  stability: number;
  similarityBoost: number;
  styleExaggeration: number;
  speed: number;
  status: PatientProfile['status'];
}

const EMPTY_FORM: PatientProfileFormState = {
  displayName: '',
  profileKey: '',
  dialoguePrompt: '',
  dialogueVersion: '',
  dialogueModel: 'gpt-4o',
  dialogueTemperature: 0.7,
  dialogueMaxOutputTokens: 220,
  scoringPrompt: '',
  scoringVersion: '',
  scoringModel: 'gpt-4o',
  scoringTemperature: 0.8,
  scoringMaxOutputTokens: 3000,
  voiceProfileId: '',
  voiceVersion: '',
  voiceId: '',
  voiceModelId: 'eleven_multilingual_v2',
  stability: 0.4,
  similarityBoost: 0.75,
  styleExaggeration: 0.3,
  speed: 1,
  status: 'draft',
};

const STATUS_COLORS: Record<PatientProfile['status'], string> = {
  draft: 'parchment',
  published: 'terracotta',
  archived: 'parchment',
};

function toForm(profile: PatientProfile) {
  return {
    displayName: profile.displayName || '',
    profileKey: profile.profileKey || '',
    dialoguePrompt: profile.dialogueConfig?.systemPrompt || '',
    dialogueVersion: profile.dialogueConfig?.version || '',
    dialogueModel: profile.dialogueConfig?.model || 'gpt-4o',
    dialogueTemperature: profile.dialogueConfig?.temperature ?? 0.7,
    dialogueMaxOutputTokens: profile.dialogueConfig?.maxOutputTokens ?? 220,
    scoringPrompt: profile.scoringConfig?.systemPrompt || '',
    scoringVersion: profile.scoringConfig?.version || '',
    scoringModel: profile.scoringConfig?.model || 'gpt-4o',
    scoringTemperature: profile.scoringConfig?.temperature ?? 0.8,
    scoringMaxOutputTokens: profile.scoringConfig?.maxOutputTokens ?? 3000,
    voiceProfileId: profile.ttsConfig?.profileId || '',
    voiceVersion: profile.ttsConfig?.version || '',
    voiceId: profile.ttsConfig?.voiceId || '',
    voiceModelId: profile.ttsConfig?.modelId || 'eleven_multilingual_v2',
    stability: profile.ttsConfig?.stability ?? 0.4,
    similarityBoost: profile.ttsConfig?.similarityBoost ?? 0.75,
    styleExaggeration: profile.ttsConfig?.styleExaggeration ?? 0.3,
    speed: profile.ttsConfig?.speed ?? 1,
    status: profile.status || 'draft',
  };
}

function buildPayload(form: PatientProfileFormState): PatientProfilePayload {
  return {
    displayName: form.displayName.trim(),
    profileKey: form.profileKey.trim(),
    status: form.status,
    dialogueConfig: {
      systemPrompt: form.dialoguePrompt.trim(),
      version: form.dialogueVersion.trim() || undefined,
      model: form.dialogueModel.trim() || undefined,
      temperature: form.dialogueTemperature,
      maxOutputTokens: form.dialogueMaxOutputTokens,
    },
    scoringConfig: {
      systemPrompt: form.scoringPrompt.trim(),
      version: form.scoringVersion.trim() || undefined,
      model: form.scoringModel.trim() || undefined,
      temperature: form.scoringTemperature,
      maxOutputTokens: form.scoringMaxOutputTokens,
    },
    ttsConfig: {
      profileId: form.voiceProfileId.trim() || undefined,
      version: form.voiceVersion.trim() || undefined,
      voiceId: form.voiceId.trim(),
      modelId: form.voiceModelId.trim(),
      stability: form.stability,
      similarityBoost: form.similarityBoost,
      styleExaggeration: form.styleExaggeration,
      speed: form.speed,
    },
  };
}

function LoadingSkeleton() {
  return (
    <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="lg">
      {Array.from({ length: 6 }).map((_, index) => (
        <Paper key={index} radius="lg" withBorder p="lg">
          <Skeleton height={20} width="55%" mb="md" />
          <Skeleton height={14} width="35%" mb="sm" />
          <Skeleton height={60} mb="md" />
          <Skeleton height={54} mb="md" />
          <Skeleton height={16} width="45%" />
        </Paper>
      ))}
    </SimpleGrid>
  );
}

function ProfileCard({
  profile,
  onEdit,
  onArchive,
}: {
  profile: PatientProfile;
  onEdit: (profile: PatientProfile) => void;
  onArchive: (profile: PatientProfile) => void;
}) {
  return (
    <Paper
      radius="lg"
      p="lg"
      style={{
        background: 'var(--claude-ivory)',
        border: '1px solid var(--claude-border-cream)',
        boxShadow: 'var(--claude-shadow-whisper)',
        transition: 'box-shadow 0.2s ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 0 0 1px var(--claude-terracotta), var(--claude-shadow-whisper)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'var(--claude-shadow-whisper)'; }}
    >
      <Group justify="space-between" align="flex-start" mb="md">
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Group gap="xs" mb={4}>
            <Text fw={500} size="md" lineClamp={1} c="var(--claude-near-black)" style={{ fontFamily: 'Georgia, serif' }}>
              {profile.displayName}
            </Text>
            <Badge variant="light" color={STATUS_COLORS[profile.status]} radius="xl" size="xs">
              {profile.status}
            </Badge>
          </Group>
          <Badge variant="outline" radius="xl" size="xs" color="parchment">
            {profile.profileKey}
          </Badge>
        </Box>
        <Group gap={4}>
          <ActionIcon variant="light" color="terracotta" radius="md" size="sm" onClick={() => onEdit(profile)}>
            <IconEdit size={14} />
          </ActionIcon>
          <ActionIcon variant="light" color="parchment" radius="md" size="sm" onClick={() => onArchive(profile)}>
            <IconArchive size={14} />
          </ActionIcon>
        </Group>
      </Group>

      <Stack gap="sm">
        <Paper radius="md" p="sm" style={{ background: 'var(--claude-parchment)' }}>
          <Group gap="xs" mb={6}>
            <ThemeIcon size={24} radius="md" variant="light" color="terracotta">
              <IconMessageChatbot size={14} />
            </ThemeIcon>
            <Text fw={500} size="sm" c="var(--claude-near-black)">Dialogue Prompt</Text>
          </Group>
          <Text size="xs" c="var(--claude-olive)" lineClamp={3}>{profile.dialogueConfig.systemPrompt}</Text>
        </Paper>

        <Paper radius="md" p="sm" style={{ background: 'var(--claude-parchment)' }}>
          <Group gap="xs" mb={6}>
            <ThemeIcon size={24} radius="md" variant="light" color="terracotta">
              <IconBrain size={14} />
            </ThemeIcon>
            <Text fw={500} size="sm" c="var(--claude-near-black)">Scoring Prompt</Text>
          </Group>
          <Text size="xs" c="var(--claude-olive)" lineClamp={3}>{profile.scoringConfig.systemPrompt}</Text>
        </Paper>

        <Paper radius="md" p="sm" style={{ background: 'var(--claude-parchment)' }}>
          <Group gap="xs" mb={6}>
            <ThemeIcon size={24} radius="md" variant="light" color="terracotta">
              <IconHeadphones size={14} />
            </ThemeIcon>
            <Text fw={500} size="sm" c="var(--claude-near-black)">Voice Settings</Text>
          </Group>
          <Text size="xs" c="var(--claude-olive)">Voice ID: {profile.ttsConfig.voiceId}</Text>
          <Text size="xs" c="var(--claude-olive)">Model: {profile.ttsConfig.modelId}</Text>
        </Paper>
      </Stack>
    </Paper>
  );
}

export default function PatientProfilesPage() {
  const [profiles, setProfiles] = useState<PatientProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingProfile, setEditingProfile] = useState<PatientProfile | null>(null);
  const [archivingProfileId, setArchivingProfileId] = useState<string | null>(null);
  const [form, setForm] = useState<PatientProfileFormState>({ ...EMPTY_FORM });

  const loadProfiles = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await patientProfileApi.list();
      setProfiles(data.patientProfiles || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load patient profiles');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfiles();
  }, []);

  const openCreate = () => {
    setEditingProfile(null);
    setForm({ ...EMPTY_FORM });
    setModalOpen(true);
  };

  const openEdit = (profile: PatientProfile) => {
    setEditingProfile(profile);
    setForm(toForm(profile));
    setModalOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = buildPayload(form);
      if (editingProfile) {
        await patientProfileApi.update(editingProfile.patientProfileId, payload);
      } else {
        await patientProfileApi.create(payload);
      }
      setModalOpen(false);
      await loadProfiles();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save patient profile');
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (profile: PatientProfile) => {
    setArchivingProfileId(profile.patientProfileId);
    try {
      await patientProfileApi.archive(profile.patientProfileId);
      await loadProfiles();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to archive patient profile');
    } finally {
      setArchivingProfileId(null);
    }
  };

  return (
    <Stack gap="xl">
      <PageHeader
        title="Patient Profiles"
        subtitle="Reusable patient identity, prompts, and ElevenLabs voice settings for assignment launch."
        actions={
          <Button
            radius="lg"
            color="terracotta"
            leftSection={<IconPlus size={16} />}
            onClick={openCreate}
          >
            New Patient Profile
          </Button>
        }
      />

      {error && (
        <Paper radius="md" p="sm" style={{ borderColor: 'var(--claude-terracotta)', background: 'var(--claude-ivory)', border: '1px solid var(--claude-terracotta)' }}>
          <Text size="sm" c="var(--claude-terracotta)">{error}</Text>
        </Paper>
      )}

      {loading ? (
        <LoadingSkeleton />
      ) : profiles.length === 0 ? (
        <EmptyState
          icon={<IconInbox size={28} />}
          title="No patient profiles yet"
          description="Create reusable patient profiles so assignments can pick a patient without duplicating prompts or voice settings."
          ctaLabel="New Patient Profile"
          onCta={openCreate}
        />
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="lg">
          {profiles.map((profile) => (
            <Box key={profile.patientProfileId} style={{ position: 'relative' }}>
              <ProfileCard profile={profile} onEdit={openEdit} onArchive={handleArchive} />
              {archivingProfileId === profile.patientProfileId && (
                <Badge color="terracotta" variant="filled" style={{ position: 'absolute', top: 14, right: 52 }}>
                  Archiving...
                </Badge>
              )}
            </Box>
          ))}
        </SimpleGrid>
      )}

      <Modal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingProfile ? 'Edit Patient Profile' : 'New Patient Profile'}
        size="xl"
        centered
        radius="lg"
      >
        <Stack gap="lg">
          <Group grow>
            <TextInput
              label="Display Name"
              value={form.displayName}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setForm((prev) => ({ ...prev, displayName: value }));
              }}
              required
            />
            <TextInput
              label="Profile Key"
              value={form.profileKey}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setForm((prev) => ({ ...prev, profileKey: value }));
              }}
              required
            />
          </Group>

          <Select
            label="Status"
            value={form.status}
            data={[
              { value: 'draft', label: 'Draft' },
              { value: 'published', label: 'Published' },
              { value: 'archived', label: 'Archived' },
            ]}
            onChange={(value) => setForm((prev) => ({ ...prev, status: (value as typeof EMPTY_FORM.status) || 'draft' }))}
          />

          <Paper radius="md" p="md" withBorder>
            <Group gap="xs" mb="md">
              <ThemeIcon size={26} radius="md" variant="light" color="terracotta">
                <IconMessageChatbot size={14} />
              </ThemeIcon>
              <Text fw={500} size="sm" c="var(--claude-near-black)">Dialogue Config</Text>
            </Group>
            <Stack gap="md">
              <Textarea
                label="System Prompt"
                minRows={6}
                value={form.dialoguePrompt}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  setForm((prev) => ({ ...prev, dialoguePrompt: value }));
                }}
                required
              />
              <Group grow align="flex-end">
                <TextInput
                  label="Version"
                  value={form.dialogueVersion}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setForm((prev) => ({ ...prev, dialogueVersion: value }));
                  }}
                />
                <TextInput
                  label="Model"
                  value={form.dialogueModel}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setForm((prev) => ({ ...prev, dialogueModel: value }));
                  }}
                />
              </Group>
              <Group grow>
                <NumberInput
                  label="Temperature"
                  decimalScale={2}
                  step={0.1}
                  min={0}
                  max={2}
                  value={form.dialogueTemperature}
                  onChange={(value) => setForm((prev) => ({ ...prev, dialogueTemperature: Number(value) }))}
                />
                <NumberInput
                  label="Max Output Tokens"
                  min={1}
                  value={form.dialogueMaxOutputTokens}
                  onChange={(value) => setForm((prev) => ({ ...prev, dialogueMaxOutputTokens: Number(value) }))}
                />
              </Group>
            </Stack>
          </Paper>

          <Paper radius="md" p="md" withBorder>
            <Group gap="xs" mb="md">
              <ThemeIcon size={26} radius="md" variant="light" color="terracotta">
                <IconBrain size={14} />
              </ThemeIcon>
              <Text fw={500} size="sm" c="var(--claude-near-black)">Scoring Config</Text>
            </Group>
            <Stack gap="md">
              <Textarea
                label="Scoring Prompt"
                minRows={6}
                value={form.scoringPrompt}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  setForm((prev) => ({ ...prev, scoringPrompt: value }));
                }}
                required
              />
              <Group grow align="flex-end">
                <TextInput
                  label="Version"
                  value={form.scoringVersion}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setForm((prev) => ({ ...prev, scoringVersion: value }));
                  }}
                />
                <TextInput
                  label="Model"
                  value={form.scoringModel}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setForm((prev) => ({ ...prev, scoringModel: value }));
                  }}
                />
              </Group>
              <Group grow>
                <NumberInput
                  label="Temperature"
                  decimalScale={2}
                  step={0.1}
                  min={0}
                  max={2}
                  value={form.scoringTemperature}
                  onChange={(value) => setForm((prev) => ({ ...prev, scoringTemperature: Number(value) }))}
                />
                <NumberInput
                  label="Max Output Tokens"
                  min={1}
                  value={form.scoringMaxOutputTokens}
                  onChange={(value) => setForm((prev) => ({ ...prev, scoringMaxOutputTokens: Number(value) }))}
                />
              </Group>
            </Stack>
          </Paper>

          <Paper radius="md" p="md" withBorder>
            <Group gap="xs" mb="md">
              <ThemeIcon size={26} radius="md" variant="light" color="terracotta">
                <IconHeadphones size={14} />
              </ThemeIcon>
              <Text fw={500} size="sm" c="var(--claude-near-black)">ElevenLabs Voice Settings</Text>
            </Group>
            <Stack gap="md">
              <Group grow>
                <TextInput
                  label="Voice Profile ID"
                  value={form.voiceProfileId}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setForm((prev) => ({ ...prev, voiceProfileId: value }));
                  }}
                />
                <TextInput
                  label="Version"
                  value={form.voiceVersion}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setForm((prev) => ({ ...prev, voiceVersion: value }));
                  }}
                />
              </Group>
              <Group grow>
                <TextInput
                  label="Voice ID"
                  value={form.voiceId}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setForm((prev) => ({ ...prev, voiceId: value }));
                  }}
                  required
                />
                <TextInput
                  label="Model ID"
                  value={form.voiceModelId}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setForm((prev) => ({ ...prev, voiceModelId: value }));
                  }}
                  required
                />
              </Group>
              <Group grow>
                <NumberInput
                  label="Stability"
                  decimalScale={2}
                  step={0.05}
                  min={0}
                  max={1}
                  value={form.stability}
                  onChange={(value) => setForm((prev) => ({ ...prev, stability: Number(value) }))}
                />
                <NumberInput
                  label="Similarity Boost"
                  decimalScale={2}
                  step={0.05}
                  min={0}
                  max={1}
                  value={form.similarityBoost}
                  onChange={(value) => setForm((prev) => ({ ...prev, similarityBoost: Number(value) }))}
                />
              </Group>
              <Group grow>
                <NumberInput
                  label="Style Exaggeration"
                  decimalScale={2}
                  step={0.05}
                  min={0}
                  max={1}
                  value={form.styleExaggeration}
                  onChange={(value) => setForm((prev) => ({ ...prev, styleExaggeration: Number(value) }))}
                />
                <NumberInput
                  label="Speed"
                  decimalScale={2}
                  step={0.05}
                  min={0.5}
                  max={2}
                  value={form.speed}
                  onChange={(value) => setForm((prev) => ({ ...prev, speed: Number(value) }))}
                />
              </Group>
            </Stack>
          </Paper>

          <Group justify="flex-end">
            <Button variant="subtle" color="parchment" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button
              color="terracotta"
              onClick={handleSave}
              loading={saving}
            >
              {editingProfile ? 'Save Changes' : 'Create Profile'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
