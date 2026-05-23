import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import {
  Text, Badge, Button, Stack, Group, Center, Box,
  Paper, ThemeIcon, Skeleton, SegmentedControl, Menu, Modal,
} from '@mantine/core';
import {
  IconClipboardList, IconPlus, IconRocket, IconArchive,
  IconPencil, IconCalendar, IconBook2, IconClipboardCheck,
  IconInbox, IconDotsVertical,
} from '@tabler/icons-react';
import { fetchAssignments, selectAssignments, selectAssignmentsLoading } from '../../slices/assignmentSlice';
import { assignmentApi } from '../../api/assignmentApi';
import type { AppDispatch } from '../../store';
import type { Assignment } from '../../slices/assignmentSlice';
import { PageHeader, EmptyState as EmptyStateCmp } from '../../components/design';

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  draft: { color: 'parchment', label: 'Draft' },
  published: { color: 'terracotta', label: 'Published' },
  archived: { color: 'parchment', label: 'Archived' },
};

const MODE_CONFIG: Record<string, { color: string; icon: typeof IconBook2; label: string }> = {
  practice: { color: 'parchment', icon: IconBook2, label: 'Practice' },
  assessment: { color: 'terracotta', icon: IconClipboardCheck, label: 'Assessment' },
};

function AssignmentRow({
  assignment,
  onStatusChange,
  onEdit,
  onArchive,
}: {
  assignment: Assignment;
  onStatusChange: (id: string, status: string) => void;
  onEdit: (id: string) => void;
  onArchive: (assignment: Assignment) => void;
}) {
  const status = STATUS_CONFIG[assignment.status] ?? STATUS_CONFIG.draft;
  const mode = MODE_CONFIG[assignment.mode] ?? MODE_CONFIG.practice;
  const ModeIcon = mode.icon;

  return (
    <Paper
      radius="lg" p="md"
      style={{
        background: 'var(--claude-ivory)',
        border: '1px solid var(--claude-border-cream)',
        boxShadow: 'var(--claude-shadow-whisper)',
        transition: 'box-shadow 0.2s ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 0 0 1px var(--claude-terracotta), var(--claude-shadow-whisper)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'var(--claude-shadow-whisper)'; }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap="md" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
          <ThemeIcon size={40} radius="md" variant="light" color={mode.color}>
            <ModeIcon size={20} />
          </ThemeIcon>
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Group gap="xs" mb={2}>
              <Text fw={500} size="sm" lineClamp={1} c="var(--claude-near-black)" style={{ fontFamily: 'Georgia, serif' }}>
                {assignment.title}
              </Text>
              <Badge variant="light" color={mode.color} size="xs" radius="xl">{mode.label}</Badge>
              <Badge variant="dot" color={status.color} size="xs" radius="xl">{status.label}</Badge>
            </Group>
            <Group gap="lg">
              <Group gap={4}>
                <IconCalendar size={12} style={{ color: 'var(--claude-stone)' }} />
                <Text size="xs" c="var(--claude-olive)">
                  {assignment.dueDate ? new Date(assignment.dueDate).toLocaleDateString() : 'No deadline'}
                </Text>
              </Group>
              {assignment.description && (
                <Text size="xs" c="var(--claude-olive)" lineClamp={1}>{assignment.description}</Text>
              )}
            </Group>
          </Box>
        </Group>

        <Menu position="bottom-end" withArrow shadow="md">
          <Menu.Target>
            <ThemeIcon
              size={32} radius="md" variant="light" color="parchment"
              style={{ cursor: 'pointer' }}
            >
              <IconDotsVertical size={16} />
            </ThemeIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              leftSection={<IconPencil size={14} />}
              onClick={() => onEdit(assignment.assignmentId)}
            >
              Edit
            </Menu.Item>
            {assignment.status === 'draft' && (
              <Menu.Item
                leftSection={<IconRocket size={14} />}
                onClick={() => onStatusChange(assignment.assignmentId, 'published')}
              >
                Publish
              </Menu.Item>
            )}
            {assignment.status === 'archived' && (
              <Menu.Item
                leftSection={<IconPencil size={14} />}
                onClick={() => onStatusChange(assignment.assignmentId, 'draft')}
              >
                Move to Draft
              </Menu.Item>
            )}
            {assignment.status !== 'archived' && (
              <Menu.Item
                leftSection={<IconArchive size={14} />}
                color="terracotta"
                onClick={() => onArchive(assignment)}
              >
                Archive
              </Menu.Item>
            )}
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Paper>
  );
}

function LoadingSkeleton() {
  return (
    <Stack gap="md">
      {Array.from({ length: 4 }).map((_, i) => (
        <Paper key={i} radius="lg" p="md" withBorder>
          <Group gap="md">
            <Skeleton circle height={40} />
            <Box style={{ flex: 1 }}>
              <Skeleton height={14} width="50%" mb={8} />
              <Skeleton height={10} width="70%" />
            </Box>
            <Skeleton circle height={32} />
          </Group>
        </Paper>
      ))}
    </Stack>
  );
}

export default function AssignmentManagement() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const createAssignmentPath = '/faculty/assignments/new';
  const assignmentEditBasePath = '/faculty/assignments';
  const assignments = useSelector(selectAssignments);
  const loading = useSelector(selectAssignmentsLoading);
  const [statusFilter, setStatusFilter] = useState('all');
  const [archiveTarget, setArchiveTarget] = useState<Assignment | null>(null);
  const [archiving, setArchiving] = useState(false);

  useEffect(() => {
    dispatch(fetchAssignments());
  }, [dispatch]);

  const handleStatusChange = async (assignmentId: string, status: string) => {
    await assignmentApi.updateStatus(assignmentId, status);
    dispatch(fetchAssignments());
  };

  const handleEdit = (assignmentId: string) => {
    navigate(`${assignmentEditBasePath}/${assignmentId}/edit`);
  };

  const handleArchive = async () => {
    if (!archiveTarget) return;
    setArchiving(true);
    try {
      await assignmentApi.updateStatus(archiveTarget.assignmentId, 'archived');
      setArchiveTarget(null);
      dispatch(fetchAssignments());
    } finally {
      setArchiving(false);
    }
  };

  const filtered = statusFilter === 'all'
    ? assignments
    : assignments.filter((a) => a.status === statusFilter);

  const draftCount = assignments.filter((a) => a.status === 'draft').length;
  const publishedCount = assignments.filter((a) => a.status === 'published').length;
  const archivedCount = assignments.filter((a) => a.status === 'archived').length;

  return (
    <Stack gap="xl">
      <PageHeader
        title="Assignment Management"
        subtitle="Create, publish, and manage assignments"
        actions={
          <Button
            radius="lg"
            color="terracotta"
            leftSection={<IconPlus size={16} />}
            onClick={() => navigate(createAssignmentPath)}
          >
            New Assignment
          </Button>
        }
      />

      {/* ── Filter ── */}
      {!loading && assignments.length > 0 && (
        <SegmentedControl
          value={statusFilter}
          onChange={setStatusFilter}
          radius="xl"
          color="terracotta"
          data={[
            { label: `All (${assignments.length})`, value: 'all' },
            { label: `Draft (${draftCount})`, value: 'draft' },
            { label: `Published (${publishedCount})`, value: 'published' },
            { label: `Archived (${archivedCount})`, value: 'archived' },
          ]}
        />
      )}

      {/* ── Content ── */}
      {loading ? (
        <LoadingSkeleton />
      ) : assignments.length === 0 ? (
        <EmptyStateCmp
          icon={<IconInbox size={28} />}
          title="No assignments yet"
          description="Create your first assignment to get started."
          ctaLabel="New Assignment"
          onCta={() => navigate(createAssignmentPath)}
        />
      ) : filtered.length === 0 ? (
        <Center style={{ minHeight: 200 }}>
          <Stack align="center" gap="sm">
            <ThemeIcon size={48} radius="md" variant="light" color="parchment">
              <IconClipboardList size={24} />
            </ThemeIcon>
            <Text c="var(--claude-stone)" size="sm">No assignments in this category</Text>
          </Stack>
        </Center>
      ) : (
        <Stack gap="md">
          {filtered.map((a) => (
            <AssignmentRow
              key={a.assignmentId}
              assignment={a}
              onStatusChange={handleStatusChange}
              onEdit={handleEdit}
              onArchive={setArchiveTarget}
            />
          ))}
        </Stack>
      )}

      <Modal
        opened={!!archiveTarget}
        onClose={() => setArchiveTarget(null)}
        title="Archive Assignment"
        size="sm"
        radius="lg"
      >
        <Stack gap="md">
          <Text size="sm" c="var(--claude-near-black)">
            Archive <b>{archiveTarget?.title}</b>? This will remove the assignment from active use,
            but keep historical session data intact.
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
