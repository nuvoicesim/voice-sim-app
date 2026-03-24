import { Box, Stack, Text, Group, ThemeIcon } from '@mantine/core';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  IconLayoutDashboard, IconRocket, IconHistory,
  IconMovie, IconFilePlus, IconClipboardList, IconUsers, IconChartBar,
  IconUserCog, IconChartPie,
} from '@tabler/icons-react';
import type { UserRole } from '../slices/authSlice';

interface NavItem {
  label: string;
  path: string;
  icon: typeof IconLayoutDashboard;
}

const NAV_ITEMS: Record<UserRole, NavItem[]> = {
  student: [
    { label: 'Dashboard', path: '/student/dashboard', icon: IconLayoutDashboard },
    { label: 'Assignments', path: '/student/assignments', icon: IconRocket },
    { label: 'History', path: '/student/history', icon: IconHistory },
  ],
  faculty: [
    { label: 'Dashboard', path: '/faculty/dashboard', icon: IconLayoutDashboard },
    { label: 'Manage Scenes', path: '/faculty/scenes', icon: IconMovie },
    { label: 'Create Assignment', path: '/faculty/assignments/new', icon: IconFilePlus },
    { label: 'Manage Assignments', path: '/faculty/assignments', icon: IconClipboardList },
    { label: 'Student Data', path: '/faculty/students', icon: IconUsers },
    { label: 'Analysis', path: '/faculty/analysis', icon: IconChartBar },
  ],
  admin: [
    { label: 'Dashboard', path: '/admin/dashboard', icon: IconLayoutDashboard },
    { label: 'Users & Roles', path: '/admin/users', icon: IconUserCog },
    { label: 'Analytics', path: '/admin/analytics', icon: IconChartPie },
  ],
};

const ROLE_META: Record<UserRole, { label: string; color: string; gradient: string }> = {
  student: {
    label: 'Student Portal',
    color: 'indigo',
    gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  },
  faculty: {
    label: 'Faculty Portal',
    color: 'violet',
    gradient: 'linear-gradient(135deg, #a855f7 0%, #6366f1 100%)',
  },
  admin: {
    label: 'Admin Portal',
    color: 'red',
    gradient: 'linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)',
  },
};

const SIDEBAR_W = 260;

interface PortalLayoutProps {
  role: UserRole;
  children: React.ReactNode;
}

function SidebarItem({
  item,
  active,
  color,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  color: string;
  onClick: () => void;
}) {
  const Icon = item.icon;

  return (
    <Box
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 16px',
        margin: '0 12px',
        borderRadius: 10,
        cursor: 'pointer',
        position: 'relative',
        transition: 'background 0.15s ease, color 0.15s ease',
        background: active ? `var(--mantine-color-${color}-0)` : 'transparent',
        color: active ? `var(--mantine-color-${color}-7)` : 'var(--mantine-color-gray-7)',
        fontWeight: active ? 600 : 400,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--mantine-color-gray-1)';
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    >
      {active && (
        <Box
          style={{
            position: 'absolute',
            left: 0,
            top: 8,
            bottom: 8,
            width: 3,
            borderRadius: 3,
            background: `var(--mantine-color-${color}-6)`,
          }}
        />
      )}
      <ThemeIcon
        size={32}
        radius="md"
        variant={active ? 'light' : 'transparent'}
        color={active ? color : 'gray'}
      >
        <Icon size={18} />
      </ThemeIcon>
      <Text size="sm" style={{ fontWeight: 'inherit', color: 'inherit' }}>
        {item.label}
      </Text>
    </Box>
  );
}

export default function PortalLayout({ role, children }: PortalLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const items = NAV_ITEMS[role];
  const meta = ROLE_META[role];

  return (
    <Box style={{ display: 'flex', minHeight: '100vh' }}>
      {/* ── Sidebar ── */}
      <Box
        style={{
          width: SIDEBAR_W,
          background: '#fcfcfd',
          borderRight: '1px solid #eef0f4',
          position: 'fixed',
          top: 56,
          left: 0,
          bottom: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Portal label */}
        <Box style={{ padding: '20px 24px 12px' }}>
          <Group gap={8}>
            <Box
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: meta.gradient,
                flexShrink: 0,
              }}
            />
            <Text
              size="xs"
              fw={700}
              c="dimmed"
              style={{ textTransform: 'uppercase', letterSpacing: 1.2 }}
            >
              {meta.label}
            </Text>
          </Group>
        </Box>

        {/* Separator */}
        <Box style={{ height: 1, background: '#eef0f4', margin: '0 24px 8px' }} />

        {/* Nav items */}
        <Stack gap={2} style={{ flex: 1, paddingTop: 4, paddingBottom: 20 }}>
          {items.map((item) => (
            <SidebarItem
              key={item.path}
              item={item}
              active={location.pathname === item.path}
              color={meta.color}
              onClick={() => navigate(item.path)}
            />
          ))}
        </Stack>
      </Box>

      {/* ── Main content ── */}
      <Box
        style={{
          marginLeft: SIDEBAR_W,
          flex: 1,
          padding: '28px 32px',
          background: '#ffffff',
          minHeight: '100vh',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
