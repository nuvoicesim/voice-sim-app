import { Group, Button, Text, Box, Badge, ThemeIcon } from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import { IconHeadphones, IconLogout, IconArrowsExchange } from '@tabler/icons-react';
import { AuthUser } from 'aws-amplify/auth';
import type { UserRole } from './slices/authSlice';

interface TopBarProps {
  signOut: () => void;
  user?: AuthUser;
  role?: UserRole;
}

const ROLE_LABELS: Record<UserRole, string> = {
  student: 'Student',
  faculty: 'Faculty',
  admin: 'Admin',
};

const ROLE_COLORS: Record<UserRole, string> = {
  student: 'cyan',
  faculty: 'violet',
  admin: 'pink',
};

function UserAvatar({ name }: { name: string }) {
  const initial = (name || 'U').charAt(0).toUpperCase();
  return (
    <Box
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: 'rgba(255,255,255,0.2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <Text size="sm" fw={700} c="white">{initial}</Text>
    </Box>
  );
}

function TopBar({ signOut, user, role = 'student' }: TopBarProps) {
  const navigate = useNavigate();

  const handleLogoClick = () => {
    const portalMap: Record<UserRole, string> = {
      student: '/student/dashboard',
      faculty: '/faculty/dashboard',
      admin: '/admin/dashboard',
    };
    navigate(portalMap[role]);
  };

  const displayName = user?.signInDetails?.loginId || user?.username || 'User';

  return (
    <Box
      style={{
        height: 56,
        background: 'linear-gradient(135deg, #4338ca 0%, #6d28d9 100%)',
        color: 'white',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0 24px',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
      }}
    >
      {/* Left: Logo + admin switch */}
      <Group gap="md">
        <Group
          gap={8}
          style={{ cursor: 'pointer' }}
          onClick={handleLogoClick}
        >
          <ThemeIcon
            size={32} radius="xl"
            variant="filled"
            style={{ background: 'rgba(255,255,255,0.15)' }}
          >
            <IconHeadphones size={18} color="white" />
          </ThemeIcon>
          <Text
            size="md" fw={800} c="white"
            style={{ letterSpacing: 2, userSelect: 'none' }}
          >
            VOICE
          </Text>
        </Group>

        {role === 'admin' && (
          <>
            <Box style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.2)' }} />
            <Group gap={4}>
              <IconArrowsExchange size={14} style={{ color: 'rgba(255,255,255,0.5)' }} />
              <Button
                size="compact-xs" variant="subtle" c="white" radius="xl"
                style={{ opacity: 0.8 }}
                onClick={() => navigate('/admin/dashboard')}
              >
                Admin
              </Button>
              <Button
                size="compact-xs" variant="subtle" c="white" radius="xl"
                style={{ opacity: 0.8 }}
                onClick={() => navigate('/faculty/dashboard')}
              >
                Faculty
              </Button>
            </Group>
          </>
        )}
      </Group>

      {/* Right: Role badge + user + signout */}
      <Group gap="md">
        <Badge
          color={ROLE_COLORS[role]}
          variant="filled"
          size="sm"
          radius="xl"
          style={{ textTransform: 'capitalize' }}
        >
          {ROLE_LABELS[role]}
        </Badge>

        <Group gap={8}>
          <UserAvatar name={displayName} />
          <Text size="sm" c="white" fw={500} visibleFrom="sm">
            {displayName}
          </Text>
        </Group>

        <Button
          variant="subtle"
          c="white"
          size="compact-sm"
          radius="xl"
          leftSection={<IconLogout size={15} />}
          onClick={signOut}
          style={{
            border: '1px solid rgba(255,255,255,0.2)',
            transition: 'background 0.15s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          Sign Out
        </Button>
      </Group>
    </Box>
  );
}

export default TopBar;
