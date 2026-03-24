import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import {
  Title, Text, Badge, Button, Stack, Group, Center, Box,
  Paper, ThemeIcon, Skeleton, SegmentedControl, Menu,
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

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  draft: { color: 'gray', label: 'Draft' },
  published: { color: 'green', label: 'Published' },
  archived: { color: 'red', label: 'Archived' },
};

const MODE_CONFIG: Record<string, { color: string; icon: typeof IconBook2; label: string }> = {
  practice: { color: 'blue', icon: IconBook2, label: 'Practice' },
  assessment: { color: 'orange', icon: IconClipboardCheck, label: 'Assessment' },
};

function AssignmentRow({
  assignment,
  onStatusChange,
}: {
  assignment: Assignment;
  onStatusChange: (id: string, status: string) => void;
}) {
  const status = STATUS_CONFIG[assignment.status] ?? STATUS_CONFIG.draft;
  const mode = MODE_CONFIG[assignment.mode] ?? MODE_CONFIG.practice;
  const ModeIcon = mode.icon;

  return (
    <Paper
      radius="lg" p="md" withBorder
      style={{
        border: '1px solid #edf0f5',
        transition: 'box-shadow 0.2s ease, transform 0.2s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.06)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = '';
        e.currentTarget.style.transform = '';
      }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap="md" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
          <ThemeIcon size={40} radius="xl" variant="light" color={mode.color}>
            <ModeIcon size={20} />
          </ThemeIcon>
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Group gap="xs" mb={2}>
              <Text fw={600} size="sm" lineClamp={1}>{assignment.title}</Text>
              <Badge variant="light" color={mode.color} size="xs" radius="xl">{mode.label}</Badge>
              <Badge variant="dot" color={status.color} size="xs" radius="xl">{status.label}</Badge>
            </Group>
            <Group gap="lg">
              <Group gap={4}>
                <IconCalendar size={12} style={{ color: 'var(--mantine-color-gray-5)' }} />
                <Text size="xs" c="dimmed">
                  {assignment.dueDate ? new Date(assignment.dueDate).toLocaleDateString() : 'No deadline'}
                </Text>
              </Group>
              {assignment.description && (
                <Text size="xs" c="dimmed" lineClamp={1}>{assignment.description}</Text>
              )}
            </Group>
          </Box>
        </Group>

        <Menu position="bottom-end" withArrow shadow="md">
          <Menu.Target>
            <ThemeIcon
              size={32} radius="xl" variant="light" color="gray"
              style={{ cursor: 'pointer' }}
            >
              <IconDotsVertical size={16} />
            </ThemeIcon>
          </Menu.Target>
          <Menu.Dropdown>
            {assignment.status === 'draft' && (
              <Menu.Item
                leftSection={<IconRocket size={14} />}
                onClick={() => onStatusChange(assignment.assignmentId, 'published')}
              >
                Publish
              </Menu.Item>
            )}
            {assignment.status === 'published' && (
              <Menu.Item
                leftSection={<IconArchive size={14} />}
                color="red"
                onClick={() => onStatusChange(assignment.assignmentId, 'archived')}
              >
                Archive
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

function EmptyState() {
  return (
    <Center style={{ minHeight: 300 }}>
      <Stack align="center" gap="lg">
        <Box
          style={{
            width: 88,
            height: 88,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #f0f4ff 0%, #e8ecff 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <IconInbox size={40} style={{ color: '#9ba3c2' }} />
        </Box>
        <Box style={{ textAlign: 'center' }}>
          <Title order={4} c="dark.4" mb={4}>No assignments yet</Title>
          <Text c="dimmed" size="sm" maw={300} style={{ lineHeight: 1.6 }}>
            Create your first assignment to get started.
          </Text>
        </Box>
      </Stack>
    </Center>
  );
}

export default function AssignmentManagement() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const assignments = useSelector(selectAssignments);
  const loading = useSelector(selectAssignmentsLoading);
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    dispatch(fetchAssignments());
  }, [dispatch]);

  const handleStatusChange = async (assignmentId: string, status: string) => {
    await assignmentApi.updateStatus(assignmentId, status);
    dispatch(fetchAssignments());
  };

  const filtered = statusFilter === 'all'
    ? assignments
    : assignments.filter((a) => a.status === statusFilter);

  const draftCount = assignments.filter((a) => a.status === 'draft').length;
  const publishedCount = assignments.filter((a) => a.status === 'published').length;
  const archivedCount = assignments.filter((a) => a.status === 'archived').length;

  return (
    <Stack gap="xl">
      {/* ── Header ── */}
      <Group justify="space-between" align="flex-start">
        <Box>
          <Group gap="sm" mb={4}>
            <ThemeIcon size={38} radius="xl" variant="gradient" gradient={{ from: 'violet', to: 'indigo' }}>
              <IconClipboardList size={20} color="white" />
            </ThemeIcon>
            <Title order={2} fw={700}>Assignment Management</Title>
          </Group>
          <Text c="dimmed" size="sm" ml={52}>
            Create, publish, and manage assignments
          </Text>
        </Box>
        <Button
          radius="xl"
          leftSection={<IconPlus size={16} />}
          variant="gradient"
          gradient={{ from: 'indigo', to: 'violet' }}
          onClick={() => navigate('/faculty/assignments/new')}
        >
          New Assignment
        </Button>
      </Group>

      {/* ── Filter ── */}
      {!loading && assignments.length > 0 && (
        <SegmentedControl
          value={statusFilter}
          onChange={setStatusFilter}
          radius="xl"
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
        <EmptyState />
      ) : filtered.length === 0 ? (
        <Center style={{ minHeight: 200 }}>
          <Stack align="center" gap="sm">
            <ThemeIcon size={48} radius="xl" variant="light" color="gray">
              <IconClipboardList size={24} />
            </ThemeIcon>
            <Text c="dimmed" size="sm">No assignments in this category</Text>
          </Stack>
        </Center>
      ) : (
        <Stack gap="md">
          {filtered.map((a) => (
            <AssignmentRow
              key={a.assignmentId}
              assignment={a}
              onStatusChange={handleStatusChange}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}
