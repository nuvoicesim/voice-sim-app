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
  simulation_designer: 'Simulation Designer',
  admin: 'Admin',
};

function UserAvatar({ name }: { name: string }) {
  const initial = (name || 'U').charAt(0).toUpperCase();
  return (
    <Box
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: 'var(--claude-border-cream)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <Text size="sm" fw={500} c="var(--claude-charcoal)">{initial}</Text>
    </Box>
  );
}

function TopBar({ signOut, user, role = 'student' }: TopBarProps) {
  const navigate = useNavigate();

  const handleLogoClick = () => {
    const portalMap: Record<UserRole, string> = {
      student: '/student/dashboard',
      faculty: '/faculty/dashboard',
      simulation_designer: '/simulation-designer/patient-profiles',
      admin: '/admin/dashboard',
    };
    navigate(portalMap[role]);
  };

  const displayName = user?.signInDetails?.loginId || user?.username || 'User';

  return (
    <Box
      style={{
        height: 56,
        background: 'var(--claude-ivory)',
        color: 'var(--claude-charcoal)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0 24px',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        borderBottom: '1px solid var(--claude-border-warm)',
      }}
    >
      {/* Left: Logo + admin switch */}
      <Group gap="md">
        <Group
          gap={10}
          style={{ cursor: 'pointer' }}
          onClick={handleLogoClick}
        >
          <ThemeIcon
            size={32}
            radius="md"
            variant="filled"
            color="terracotta"
          >
            <IconHeadphones size={18} color="var(--claude-ivory)" />
          </ThemeIcon>
          <Text
            fw={500}
            c="var(--claude-charcoal)"
            style={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: '1.0625rem',
              letterSpacing: 4,
              userSelect: 'none',
            }}
          >
            VOICE
          </Text>
        </Group>

        {role === 'admin' && (
          <>
            <Box style={{ width: 1, height: 24, background: 'var(--claude-border-warm)' }} />
            <Group gap={4}>
              <IconArrowsExchange size={14} style={{ color: 'var(--claude-stone)' }} />
              <Button
                size="compact-xs" variant="subtle" c="var(--claude-olive)" radius="xl"
                onClick={() => navigate('/admin/dashboard')}
              >
                Admin
              </Button>
              <Button
                size="compact-xs" variant="subtle" c="var(--claude-olive)" radius="xl"
                onClick={() => navigate('/faculty/dashboard')}
              >
                Faculty
              </Button>
              <Button
                size="compact-xs" variant="subtle" c="var(--claude-olive)" radius="xl"
                onClick={() => navigate('/simulation-designer/patient-profiles')}
              >
                Designer
              </Button>
            </Group>
          </>
        )}
      </Group>

      {/* Right: Role badge + user + signout */}
      <Group gap="md">
        <Badge
          color="terracotta"
          variant="light"
          size="sm"
          radius="xl"
          style={{ textTransform: 'capitalize' }}
        >
          {ROLE_LABELS[role]}
        </Badge>

        <Group gap={8}>
          <UserAvatar name={displayName} />
          <Text size="sm" c="var(--claude-charcoal)" fw={400} visibleFrom="sm">
            {displayName}
          </Text>
        </Group>

        <Button
          variant="subtle"
          c="var(--claude-olive)"
          size="compact-sm"
          radius="xl"
          leftSection={<IconLogout size={15} />}
          onClick={signOut}
          style={{
            border: '1px solid var(--claude-border-warm)',
            transition: 'background 0.15s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--claude-border-cream)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          Sign Out
        </Button>
      </Group>
    </Box>
  );
}

export default TopBar;
