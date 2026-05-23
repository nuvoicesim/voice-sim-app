import { useEffect, useState, useCallback } from 'react';
import {
  Text, Badge, Button, Stack, Group, Center, Select,
  Paper, TextInput, Box, ThemeIcon, Skeleton,
} from '@mantine/core';
import {
  IconSearch, IconUser, IconCalendar,
} from '@tabler/icons-react';
import { apiGet, apiPut } from '../../api/apiClient';
import { PageHeader } from '../../components/design';

interface CognitoUser {
  username: string;
  userStatus: string;
  enabled: boolean;
  createdAt: string;
  attributes: Record<string, string>;
}

// All roles collapse to terracotta accent (admin) or parchment (others) — DESIGN.md no chromatic differentiation
const ROLE_COLORS: Record<string, string> = {
  student: 'parchment',
  faculty: 'parchment',
  simulation_designer: 'parchment',
  admin: 'terracotta',
};

function UserRow({
  user,
  updating,
  onRoleChange,
}: {
  user: CognitoUser;
  updating: string | null;
  onRoleChange: (userId: string, role: string) => void;
}) {
  const currentRole = user.attributes?.['custom:role'] || 'student';
  const email = user.attributes?.email || '—';
  const initial = (email !== '—' ? email : 'U').charAt(0).toUpperCase();

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
          <Box
            style={{
              width: 40, height: 40, borderRadius: '50%',
              background: currentRole === 'admin' ? 'var(--claude-terracotta)' : 'var(--claude-border-warm)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            <Text fw={500} size="sm" c={currentRole === 'admin' ? 'var(--claude-ivory)' : 'var(--claude-charcoal)'} style={{ fontFamily: 'Georgia, serif' }}>
              {initial}
            </Text>
          </Box>
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Group gap="xs" mb={2}>
              <Text fw={500} size="sm" lineClamp={1} c="var(--claude-near-black)">{email}</Text>
              <Badge
                variant={user.userStatus === 'CONFIRMED' ? 'light' : 'outline'}
                color={user.userStatus === 'CONFIRMED' ? 'terracotta' : 'parchment'}
                size="xs" radius="xl"
              >
                {user.userStatus}
              </Badge>
            </Group>
            <Group gap="lg">
              <Badge variant="filled" color={ROLE_COLORS[currentRole] || 'parchment'} size="xs" radius="xl">
                {currentRole}
              </Badge>
              <Group gap={4}>
                <IconCalendar size={11} style={{ color: 'var(--claude-stone)' }} />
                <Text size="xs" c="var(--claude-olive)">
                  {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}
                </Text>
              </Group>
            </Group>
          </Box>
        </Group>

        <Select
          size="xs"
          radius="md"
          data={[
            { value: 'student', label: 'Student' },
            { value: 'faculty', label: 'Faculty' },
            { value: 'simulation_designer', label: 'Simulation Designer' },
            { value: 'admin', label: 'Admin' },
          ]}
          value={currentRole}
          onChange={(v) => v && onRoleChange(user.username, v)}
          disabled={updating === user.username}
          style={{ width: 130, flexShrink: 0 }}
        />
      </Group>
    </Paper>
  );
}

function LoadingSkeleton() {
  return (
    <Stack gap="md">
      {Array.from({ length: 5 }).map((_, i) => (
        <Paper key={i} radius="lg" p="md" withBorder>
          <Group gap="md">
            <Skeleton circle height={40} />
            <Box style={{ flex: 1 }}>
              <Skeleton height={14} width="45%" mb={8} />
              <Skeleton height={10} width="30%" />
            </Box>
            <Skeleton height={30} width={130} radius="md" />
          </Group>
        </Paper>
      ))}
    </Stack>
  );
}

export default function UsersRolesPage() {
  const [users, setUsers] = useState<CognitoUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const loadUsers = useCallback(async (searchTerm = '') => {
    try {
      setLoading(true);
      const params: Record<string, string> = { list: 'true', limit: '50' };
      if (searchTerm.trim()) params.search = searchTerm.trim();
      const data = await apiGet('/cognito-user', params);
      setUsers(data.users || []);
    } catch (e) {
      console.error('Failed to load users', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleSearch = () => loadUsers(search);

  const handleRoleChange = async (userId: string, newRole: string) => {
    setUpdating(userId);
    try {
      await apiPut(`/cognito-user/${userId}/role`, { role: newRole });
      await loadUsers();
    } catch (e) {
      console.error('Failed to update role', e);
    } finally {
      setUpdating(null);
    }
  };

  const filteredUsers = users.filter((user) => {
    if (!search.trim()) return true;
    const kw = search.toLowerCase();
    const email = (user.attributes?.email || '').toLowerCase();
    return email.includes(kw) || user.username.toLowerCase().includes(kw);
  });

  return (
    <Stack gap="xl">
      <PageHeader
        title="Users & Roles"
        subtitle="Manage user accounts and assign roles"
      />

      <Group gap="sm">
        <TextInput
          placeholder="Search by email or username..."
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          radius="xl"
          style={{ flex: 1, maxWidth: 400 }}
        />
        <Button onClick={handleSearch} radius="xl" variant="light" color="terracotta">
          Search
        </Button>
      </Group>

      {!loading && users.length > 0 && (
        <Group gap="sm">
          <Badge variant="light" color="parchment" size="lg" radius="xl" leftSection={<IconUser size={12} />}>
            {users.length} users
          </Badge>
          <Badge variant="light" color="parchment" size="lg" radius="xl">
            {users.filter((u) => (u.attributes?.['custom:role'] || 'student') === 'student').length} students
          </Badge>
          <Badge variant="light" color="parchment" size="lg" radius="xl">
            {users.filter((u) => u.attributes?.['custom:role'] === 'faculty').length} faculty
          </Badge>
          <Badge variant="light" color="parchment" size="lg" radius="xl">
            {users.filter((u) => u.attributes?.['custom:role'] === 'simulation_designer').length} simulation designers
          </Badge>
          <Badge variant="light" color="terracotta" size="lg" radius="xl">
            {users.filter((u) => u.attributes?.['custom:role'] === 'admin').length} admins
          </Badge>
        </Group>
      )}

      {loading ? (
        <LoadingSkeleton />
      ) : filteredUsers.length === 0 ? (
        <Center style={{ minHeight: 240 }}>
          <Stack align="center" gap="sm">
            <ThemeIcon size={52} radius="md" variant="light" color="parchment">
              <IconSearch size={26} />
            </ThemeIcon>
            <Text c="var(--claude-stone)" size="sm">
              {search.trim() ? 'No users match your search' : 'No users found'}
            </Text>
          </Stack>
        </Center>
      ) : (
        <Stack gap="sm">
          {filteredUsers.map((user) => (
            <UserRow
              key={user.username}
              user={user}
              updating={updating}
              onRoleChange={handleRoleChange}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}
