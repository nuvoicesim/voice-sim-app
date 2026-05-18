import { useEffect, useState } from 'react';
import {
  Title as MantineTitle, Text, Badge, Button, Stack, Group, Center, Box,
  Modal, TextInput, Textarea, Select, ActionIcon, Paper,
  ThemeIcon, Skeleton, SimpleGrid,
} from '@mantine/core';
import {
  IconMovie, IconPlus, IconEdit, IconArchive, IconInbox,
  IconTag, IconDeviceGamepad2, IconAlertTriangle,
} from '@tabler/icons-react';
import { sceneCatalogApi } from '../../api/sceneCatalogApi';
import { unityBuildApi, type UnityBuild } from '../../api/unityBuildApi';
import { PageHeader } from '../../components/design';

interface Scene {
  sceneId: string;
  scenarioKey: string;
  title: string;
  description: string;
  difficulty: string;
  tags: string[];
  unityBuildId?: string | null;
  unityBuildFolder: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const DIFFICULTY_OPTIONS = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
];

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: 'parchment',
  intermediate: 'terracotta',
  advanced: 'terracotta',
};

const DIFFICULTY_BAR: Record<string, string> = {
  beginner: 'var(--claude-warm-silver)',
  intermediate: 'var(--claude-coral)',
  advanced: 'var(--claude-terracotta)',
};

const EMPTY_FORM = {
  scenarioKey: '',
  title: '',
  description: '',
  difficulty: 'intermediate',
  tags: '',
  unityBuildId: '',
};

function SceneCard({
  scene,
  unityBuildLabel,
  onEdit,
  onArchive,
}: {
  scene: Scene;
  unityBuildLabel: string;
  onEdit: (s: Scene) => void;
  onArchive: (s: Scene) => void;
}) {
  const diffColor = DIFFICULTY_COLORS[scene.difficulty] || 'parchment';
  const diffBar = DIFFICULTY_BAR[scene.difficulty] || DIFFICULTY_BAR.intermediate;
  const tags = Array.isArray(scene.tags) ? scene.tags : [];

  return (
    <Paper
      radius="lg" p={0}
      style={{
        overflow: 'hidden',
        background: 'var(--claude-ivory)',
        border: '1px solid var(--claude-border-cream)',
        boxShadow: 'var(--claude-shadow-whisper)',
        transition: 'box-shadow 0.2s ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 0 0 1px var(--claude-terracotta), var(--claude-shadow-whisper)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'var(--claude-shadow-whisper)'; }}
    >
      <Box style={{ height: 4, background: diffBar }} />
      <Box p="lg">
        <Group justify="space-between" align="flex-start" mb="sm">
          <Group gap="sm" align="flex-start" style={{ flex: 1, minWidth: 0 }}>
            <ThemeIcon size={40} radius="md" variant="light" color="terracotta">
              <IconMovie size={20} />
            </ThemeIcon>
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Text fw={500} size="md" lineClamp={1} c="var(--claude-near-black)" style={{ fontFamily: 'Georgia, serif' }}>
                {scene.title}
              </Text>
              <Badge variant="light" color="parchment" size="xs" radius="xl" mt={2}>{scene.scenarioKey}</Badge>
            </Box>
          </Group>
          <Group gap={4} style={{ flexShrink: 0 }}>
            <ActionIcon variant="light" color="terracotta" radius="md" size="sm" onClick={() => onEdit(scene)}>
              <IconEdit size={14} />
            </ActionIcon>
            <ActionIcon variant="light" color="parchment" radius="md" size="sm" onClick={() => onArchive(scene)}>
              <IconArchive size={14} />
            </ActionIcon>
          </Group>
        </Group>

        {scene.description && (
          <Text size="xs" c="var(--claude-olive)" lineClamp={2} mb="sm" style={{ lineHeight: 1.6 }}>
            {scene.description}
          </Text>
        )}

        <Box p="sm" style={{ background: 'var(--claude-parchment)', borderRadius: 10 }} mb="sm">
          <Group gap="lg">
            <Group gap={5}>
              <IconDeviceGamepad2 size={13} style={{ color: 'var(--claude-stone)' }} />
              <Text size="xs" c="var(--claude-olive)">
                {unityBuildLabel}
              </Text>
            </Group>
            <Badge color={diffColor} variant={diffColor === 'terracotta' ? 'filled' : 'light'} size="xs" radius="xl">
              {scene.difficulty}
            </Badge>
          </Group>
        </Box>

        {tags.length > 0 && (
          <Group gap={4}>
            <IconTag size={12} style={{ color: 'var(--claude-stone)' }} />
            {tags.map((tag) => (
              <Badge key={tag} size="xs" variant="outline" radius="xl" color="parchment">
                {tag}
              </Badge>
            ))}
          </Group>
        )}
      </Box>
    </Paper>
  );
}

function LoadingSkeleton() {
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
      {Array.from({ length: 6 }).map((_, i) => (
        <Paper key={i} radius="lg" withBorder style={{ overflow: 'hidden' }}>
          <Skeleton height={4} radius={0} />
          <Box p="lg">
            <Group mb="sm">
              <Skeleton circle height={40} />
              <Box style={{ flex: 1 }}>
                <Skeleton height={14} width="60%" mb={8} />
                <Skeleton height={10} width="35%" />
              </Box>
            </Group>
            <Skeleton height={10} width="90%" mb="sm" />
            <Skeleton height={42} radius={10} mb="sm" />
            <Skeleton height={10} width="50%" />
          </Box>
        </Paper>
      ))}
    </SimpleGrid>
  );
}

function EmptyState() {
  return (
    <Center style={{ minHeight: 320 }}>
      <Stack align="center" gap="lg">
        <ThemeIcon size={88} radius="lg" variant="light" color="terracotta">
          <IconInbox size={40} />
        </ThemeIcon>
        <Box style={{ textAlign: 'center' }}>
          <MantineTitle order={4} c="var(--claude-near-black)" mb={4}>No scenes yet</MantineTitle>
          <Text c="var(--claude-olive)" size="sm" maw={300} style={{ lineHeight: 1.6 }}>
            Create your first simulation scene to get started.
          </Text>
        </Box>
      </Stack>
    </Center>
  );
}

export default function SceneManagement() {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [unityBuilds, setUnityBuilds] = useState<UnityBuild[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingScene, setEditingScene] = useState<Scene | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Scene | null>(null);
  const [archiving, setArchiving] = useState(false);

  const loadScenes = async () => {
    setLoading(true);
    setError(null);
    try {
      const [sceneData, unityBuildData] = await Promise.all([
        sceneCatalogApi.list(),
        unityBuildApi.list(),
      ]);
      setUnityBuilds(unityBuildData.unityBuilds || []);
      const data = sceneData;
      setScenes(data.scenes || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load scenes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadScenes(); }, []);

  const openCreate = () => {
    setEditingScene(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (scene: Scene) => {
    setEditingScene(scene);
    setForm({
      scenarioKey: scene.scenarioKey,
      title: scene.title,
      description: scene.description || '',
      difficulty: scene.difficulty || 'intermediate',
      tags: Array.isArray(scene.tags) ? scene.tags.join(', ') : '',
      unityBuildId: scene.unityBuildId || '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.scenarioKey || !form.title) return;
    if (!form.unityBuildId) {
      setError('Scenes must reference a published Unity build.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        scenarioKey: form.scenarioKey,
        title: form.title,
        description: form.description,
        difficulty: form.difficulty,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
        unityBuildId: form.unityBuildId || null,
      };
      if (editingScene) {
        await sceneCatalogApi.update(editingScene.sceneId, payload);
      } else {
        await sceneCatalogApi.create(payload);
      }
      setModalOpen(false);
      await loadScenes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save scene');
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!archiveTarget) return;
    setArchiving(true);
    try {
      await sceneCatalogApi.archive(archiveTarget.sceneId);
      setArchiveTarget(null);
      await loadScenes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive scene');
    } finally {
      setArchiving(false);
    }
  };

  const unityBuildLabelById = new Map(
    unityBuilds.map((unityBuild) => [
      unityBuild.unityBuildId,
      `${unityBuild.displayName} (${unityBuild.buildKey})`,
    ])
  );

  return (
    <Stack gap="xl">
      <PageHeader
        title="Scene Management"
        subtitle="Create and manage simulation scenes"
        actions={
          <Button
            radius="lg"
            color="terracotta"
            leftSection={<IconPlus size={16} />}
            onClick={openCreate}
          >
            New Scene
          </Button>
        }
      />

      {/* ── Error banner ── */}
      {error && (
        <Paper radius="md" p="sm" style={{ background: 'var(--claude-ivory)', border: '1px solid var(--claude-terracotta)' }}>
          <Group gap="xs">
            <IconAlertTriangle size={16} style={{ color: 'var(--claude-terracotta)' }} />
            <Text c="var(--claude-terracotta)" size="sm">{error}</Text>
          </Group>
        </Paper>
      )}

      {/* ── Content ── */}
      {loading ? (
        <LoadingSkeleton />
      ) : scenes.length === 0 ? (
        <EmptyState />
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
          {scenes.map((s) => (
            <SceneCard
              key={s.sceneId}
              scene={s}
              unityBuildLabel={
                (s.unityBuildId && unityBuildLabelById.get(s.unityBuildId))
                || 'No published Unity build'
              }
              onEdit={openEdit}
              onArchive={setArchiveTarget}
            />
          ))}
        </SimpleGrid>
      )}

      {/* ── Create / Edit Modal ── */}
      <Modal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        title={
          <Group gap="xs">
            <ThemeIcon size={24} radius="md" variant="light" color="terracotta">
              <IconMovie size={13} />
            </ThemeIcon>
            <Text fw={500}>{editingScene ? 'Edit Scene' : 'Create Scene'}</Text>
          </Group>
        }
        size="lg"
        radius="lg"
      >
        <Stack gap="md">
          <TextInput
            label="Scenario Key"
            placeholder="e.g. task4"
            value={form.scenarioKey}
            onChange={(e) => setForm((prev) => ({ ...prev, scenarioKey: e.target.value }))}
            required
            disabled={!!editingScene}
            radius="md"
          />
          <TextInput
            label="Title"
            placeholder="Scene title"
            value={form.title}
            onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
            required
            radius="md"
          />
          <Textarea
            label="Description"
            placeholder="Describe the simulation scenario"
            value={form.description}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            minRows={3}
            radius="md"
          />
          <Select
            label="Difficulty"
            data={DIFFICULTY_OPTIONS}
            value={form.difficulty}
            onChange={(v) => setForm((prev) => ({ ...prev, difficulty: v || 'intermediate' }))}
            radius="md"
          />
          <Select
            label="Unity Build"
            description="Select the published Unity WebGL build to bind to this scene"
            placeholder="Select a Unity build"
            data={unityBuilds
              .filter((unityBuild) => unityBuild.status === 'published')
              .map((unityBuild) => ({
                value: unityBuild.unityBuildId,
                label: `${unityBuild.displayName} (${unityBuild.buildKey})`,
              }))}
            value={form.unityBuildId}
            onChange={(value) => setForm((prev) => ({ ...prev, unityBuildId: value || '' }))}
            radius="md"
            required
          />
          <TextInput
            label="Tags"
            placeholder="comma-separated, e.g. aphasia, broca, mild"
            value={form.tags}
            onChange={(e) => setForm((prev) => ({ ...prev, tags: e.target.value }))}
            radius="md"
          />
          <Group justify="flex-end" mt="sm">
            <Button variant="subtle" color="parchment" radius="md" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button
              radius="md"
              color="terracotta"
              onClick={handleSave}
              loading={saving}
            >
              {editingScene ? 'Save Changes' : 'Create Scene'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* ── Archive Confirmation Modal ── */}
      <Modal
        opened={!!archiveTarget}
        onClose={() => setArchiveTarget(null)}
        title={
          <Group gap="xs">
            <ThemeIcon size={24} radius="md" variant="light" color="terracotta">
              <IconAlertTriangle size={13} />
            </ThemeIcon>
            <Text fw={500}>Archive Scene</Text>
          </Group>
        }
        size="sm"
        radius="lg"
      >
        <Stack gap="md">
          <Text size="sm" c="var(--claude-near-black)">
            Are you sure you want to archive <b>{archiveTarget?.title}</b>?
            This scene will no longer appear in assignment creation.
          </Text>
          <Group justify="flex-end">
            <Button variant="subtle" color="parchment" radius="md" onClick={() => setArchiveTarget(null)}>
              Cancel
            </Button>
            <Button color="terracotta" radius="md" onClick={handleArchive} loading={archiving}>
              Archive
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
