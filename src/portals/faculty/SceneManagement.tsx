import { useEffect, useState } from 'react';
import {
  Title, Text, Badge, Button, Stack, Group, Center, Box,
  Modal, TextInput, Textarea, Select, ActionIcon, Paper,
  ThemeIcon, Skeleton, SimpleGrid,
} from '@mantine/core';
import {
  IconMovie, IconPlus, IconEdit, IconArchive, IconInbox,
  IconTag, IconDeviceGamepad2, IconAlertTriangle,
} from '@tabler/icons-react';
import { sceneCatalogApi } from '../../api/sceneCatalogApi';
import { unityBuildApi, type UnityBuild } from '../../api/unityBuildApi';

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
  beginner: 'green',
  intermediate: 'yellow',
  advanced: 'red',
};

const DIFFICULTY_GRADIENT: Record<string, string> = {
  beginner: 'linear-gradient(135deg, #38d9a9 0%, #20c997 100%)',
  intermediate: 'linear-gradient(135deg, #fcc419 0%, #fab005 100%)',
  advanced: 'linear-gradient(135deg, #ff6b6b 0%, #f03e3e 100%)',
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
  const diffColor = DIFFICULTY_COLORS[scene.difficulty] || 'gray';
  const diffGrad = DIFFICULTY_GRADIENT[scene.difficulty] || DIFFICULTY_GRADIENT.intermediate;
  const tags = Array.isArray(scene.tags) ? scene.tags : [];

  return (
    <Paper
      radius="lg" p={0} withBorder
      style={{
        overflow: 'hidden',
        border: '1px solid #edf0f5',
        transition: 'box-shadow 0.2s ease, transform 0.2s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 8px 30px rgba(0,0,0,0.08)';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = '';
        e.currentTarget.style.transform = '';
      }}
    >
      <Box style={{ height: 4, background: diffGrad }} />
      <Box p="lg">
        <Group justify="space-between" align="flex-start" mb="sm">
          <Group gap="sm" align="flex-start" style={{ flex: 1, minWidth: 0 }}>
            <ThemeIcon size={40} radius="xl" variant="light" color="violet">
              <IconMovie size={20} />
            </ThemeIcon>
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Text fw={600} size="md" lineClamp={1}>{scene.title}</Text>
              <Badge variant="light" size="xs" radius="xl" mt={2}>{scene.scenarioKey}</Badge>
            </Box>
          </Group>
          <Group gap={4} style={{ flexShrink: 0 }}>
            <ActionIcon variant="light" color="blue" radius="xl" size="sm" onClick={() => onEdit(scene)}>
              <IconEdit size={14} />
            </ActionIcon>
            <ActionIcon variant="light" color="red" radius="xl" size="sm" onClick={() => onArchive(scene)}>
              <IconArchive size={14} />
            </ActionIcon>
          </Group>
        </Group>

        {scene.description && (
          <Text size="xs" c="dimmed" lineClamp={2} mb="sm" style={{ lineHeight: 1.5 }}>
            {scene.description}
          </Text>
        )}

        <Box p="sm" style={{ background: '#f8f9fb', borderRadius: 10 }} mb="sm">
          <Group gap="lg">
            <Group gap={5}>
              <IconDeviceGamepad2 size={13} style={{ color: 'var(--mantine-color-gray-5)' }} />
              <Text size="xs" c="dimmed">
                {unityBuildLabel}
              </Text>
            </Group>
            <Badge color={diffColor} variant="filled" size="xs" radius="xl">
              {scene.difficulty}
            </Badge>
          </Group>
        </Box>

        {tags.length > 0 && (
          <Group gap={4}>
            <IconTag size={12} style={{ color: 'var(--mantine-color-gray-4)' }} />
            {tags.map((tag) => (
              <Badge key={tag} size="xs" variant="outline" radius="xl" color="gray">
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
        <Box
          style={{
            width: 88,
            height: 88,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #f5f0ff 0%, #ede5ff 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <IconInbox size={40} style={{ color: '#9ba3c2' }} />
        </Box>
        <Box style={{ textAlign: 'center' }}>
          <Title order={4} c="dark.4" mb={4}>No scenes yet</Title>
          <Text c="dimmed" size="sm" maw={300} style={{ lineHeight: 1.6 }}>
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
      {/* ── Header ── */}
      <Group justify="space-between" align="flex-start">
        <Box>
          <Group gap="sm" mb={4}>
            <ThemeIcon size={38} radius="xl" variant="gradient" gradient={{ from: 'grape', to: 'violet' }}>
              <IconMovie size={20} color="white" />
            </ThemeIcon>
            <Title order={2} fw={700}>Scene Management</Title>
          </Group>
          <Text c="dimmed" size="sm" ml={52}>
            Create and manage simulation scenes
          </Text>
        </Box>
        <Button
          radius="xl"
          leftSection={<IconPlus size={16} />}
          variant="gradient"
          gradient={{ from: 'grape', to: 'violet' }}
          onClick={openCreate}
        >
          New Scene
        </Button>
      </Group>

      {/* ── Error banner ── */}
      {error && (
        <Paper
          radius="lg" p="sm"
          style={{ background: '#fff5f5', border: '1px solid #fcc' }}
        >
          <Group gap="xs">
            <IconAlertTriangle size={16} style={{ color: 'var(--mantine-color-red-6)' }} />
            <Text c="red" size="sm">{error}</Text>
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
            <ThemeIcon size={24} radius="xl" variant="light" color="violet">
              <IconMovie size={13} />
            </ThemeIcon>
            <Text fw={600}>{editingScene ? 'Edit Scene' : 'Create Scene'}</Text>
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
            <Button variant="subtle" color="gray" radius="md" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button
              radius="md"
              variant="gradient"
              gradient={{ from: 'grape', to: 'violet' }}
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
            <ThemeIcon size={24} radius="xl" variant="light" color="red">
              <IconAlertTriangle size={13} />
            </ThemeIcon>
            <Text fw={600}>Archive Scene</Text>
          </Group>
        }
        size="sm"
        radius="lg"
      >
        <Stack gap="md">
          <Text size="sm">
            Are you sure you want to archive <b>{archiveTarget?.title}</b>?
            This scene will no longer appear in assignment creation.
          </Text>
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" radius="md" onClick={() => setArchiveTarget(null)}>
              Cancel
            </Button>
            <Button color="red" radius="md" onClick={handleArchive} loading={archiving}>
              Archive
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
