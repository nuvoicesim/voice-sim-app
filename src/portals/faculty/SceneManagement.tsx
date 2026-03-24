import { useEffect, useState } from 'react';
import {
  Title, Text, Badge, Button, Stack, Group, Center, Box,
  Modal, TextInput, Textarea, Select, ActionIcon, Paper,
  ThemeIcon, Skeleton, SimpleGrid,
} from '@mantine/core';
import {
  IconMovie, IconPlus, IconEdit, IconTrash, IconInbox,
  IconTag, IconDeviceGamepad2, IconAlertTriangle,
} from '@tabler/icons-react';
import { sceneCatalogApi } from '../../api/sceneCatalogApi';

interface Scene {
  sceneId: string;
  scenarioKey: string;
  title: string;
  description: string;
  difficulty: string;
  tags: string[];
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

const UNITY_BUILD_OPTIONS = [
  { value: 'broca-aphasia-webgl', label: 'Broca Aphasia (broca-aphasia-webgl)' },
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
  unityBuildFolder: 'broca-aphasia-webgl',
};

function SceneCard({
  scene,
  onEdit,
  onDelete,
}: {
  scene: Scene;
  onEdit: (s: Scene) => void;
  onDelete: (s: Scene) => void;
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
            <ActionIcon variant="light" color="red" radius="xl" size="sm" onClick={() => onDelete(scene)}>
              <IconTrash size={14} />
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
                {scene.unityBuildFolder || 'No game linked'}
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingScene, setEditingScene] = useState<Scene | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Scene | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadScenes = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await sceneCatalogApi.list();
      setScenes(data.scenes || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load scenes');
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
      unityBuildFolder: scene.unityBuildFolder || 'broca-aphasia-webgl',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.scenarioKey || !form.title) return;
    setSaving(true);
    try {
      const payload = {
        scenarioKey: form.scenarioKey,
        title: form.title,
        description: form.description,
        difficulty: form.difficulty,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
        unityBuildFolder: form.unityBuildFolder,
      };
      if (editingScene) {
        await sceneCatalogApi.update(editingScene.sceneId, payload);
      } else {
        await sceneCatalogApi.create(payload);
      }
      setModalOpen(false);
      await loadScenes();
    } catch (err: any) {
      setError(err?.message || 'Failed to save scene');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await sceneCatalogApi.delete(deleteTarget.sceneId);
      setDeleteTarget(null);
      await loadScenes();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete scene');
    } finally {
      setDeleting(false);
    }
  };

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
              onEdit={openEdit}
              onDelete={setDeleteTarget}
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
            label="Unity Build Folder"
            description="Select the Unity WebGL game to bind to this scene"
            placeholder="Select a Unity game"
            data={UNITY_BUILD_OPTIONS}
            value={form.unityBuildFolder}
            onChange={(v) => setForm((prev) => ({ ...prev, unityBuildFolder: v || '' }))}
            clearable
            radius="md"
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

      {/* ── Delete Confirmation Modal ── */}
      <Modal
        opened={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={
          <Group gap="xs">
            <ThemeIcon size={24} radius="xl" variant="light" color="red">
              <IconAlertTriangle size={13} />
            </ThemeIcon>
            <Text fw={600}>Confirm Delete</Text>
          </Group>
        }
        size="sm"
        radius="lg"
      >
        <Stack gap="md">
          <Text size="sm">
            Are you sure you want to deactivate <b>{deleteTarget?.title}</b>?
            This scene will no longer appear in assignment creation.
          </Text>
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" radius="md" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button color="red" radius="md" onClick={handleDelete} loading={deleting}>
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
