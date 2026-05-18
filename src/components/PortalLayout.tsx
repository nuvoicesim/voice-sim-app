import { Box, Stack, Text, Group, ThemeIcon } from '@mantine/core';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  IconLayoutDashboard, IconRocket, IconHistory,
  IconMovie, IconFilePlus, IconClipboardList, IconUsers, IconChartBar,
  IconUserCog, IconChartPie, IconUserStar, IconCloudUpload,
  IconBook, IconClipboardCheck, IconSchool, IconFileText,
} from '@tabler/icons-react';
import { selectRole, type UserRole } from '../slices/authSlice';

interface NavItem {
  label: string;
  path: string;
  icon: typeof IconLayoutDashboard;
  section?: string;
}

const NAV_ITEMS: Record<UserRole, NavItem[]> = {
  student: [
    { label: 'Dashboard', path: '/student/dashboard', icon: IconLayoutDashboard },
    { label: 'Courses', path: '/student/courses', icon: IconBook },
    { label: 'Assignments', path: '/student/assignments', icon: IconRocket },
    { label: 'History', path: '/student/history', icon: IconHistory },
  ],
  faculty: [
    { label: 'Dashboard', path: '/faculty/dashboard', icon: IconLayoutDashboard },
    { label: 'Courses', path: '/faculty/courses', icon: IconBook },
    { label: 'Survey Templates', path: '/faculty/surveys', icon: IconClipboardCheck },
    { label: 'Create Assignment', path: '/faculty/assignments/new', icon: IconFilePlus },
    { label: 'Manage Assignments', path: '/faculty/assignments', icon: IconClipboardList },
    { label: 'Student Data', path: '/faculty/students', icon: IconUsers },
    { label: 'Analysis', path: '/faculty/analysis', icon: IconChartBar },
  ],
  simulation_designer: [
    { label: 'Patient Profiles', path: '/simulation-designer/patient-profiles', icon: IconUserStar },
    { label: 'Unity Builds', path: '/simulation-designer/unity-builds', icon: IconCloudUpload },
    { label: 'Manage Scenes', path: '/simulation-designer/scenes', icon: IconMovie },
    // Faculty-equivalent management (same routes; backend authorizes simulation_designer)
    { label: 'Courses', path: '/faculty/courses', icon: IconBook },
    { label: 'Survey Templates', path: '/faculty/surveys', icon: IconClipboardCheck },
    { label: 'Create Assignment', path: '/faculty/assignments/new', icon: IconFilePlus },
    { label: 'Manage Assignments', path: '/faculty/assignments', icon: IconClipboardList },
    { label: 'Student Data', path: '/faculty/students', icon: IconUsers },
    { label: 'Analysis', path: '/faculty/analysis', icon: IconChartBar },
  ],
  admin: [
    { label: 'Dashboard', path: '/admin/dashboard', icon: IconLayoutDashboard },
    { label: 'All Courses', path: '/admin/courses', icon: IconSchool },
    { label: 'Users & Roles', path: '/admin/users', icon: IconUserCog },
    { label: 'Analytics', path: '/admin/analytics', icon: IconChartPie },
    { label: 'Event Logs', path: '/admin/logs', icon: IconFileText },
  ],
};

const ROLE_META: Record<UserRole, { label: string; color: string; dot: string }> = {
  student: {
    label: 'Student Portal',
    color: 'terracotta',
    dot: 'var(--claude-terracotta)',
  },
  faculty: {
    label: 'Faculty Portal',
    color: 'terracotta',
    dot: 'var(--claude-terracotta)',
  },
  simulation_designer: {
    label: 'Simulation Designer Portal',
    color: 'terracotta',
    dot: 'var(--claude-terracotta)',
  },
  admin: {
    label: 'Admin Portal',
    color: 'terracotta',
    dot: 'var(--claude-terracotta)',
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
        gap: 14,
        padding: '12px 16px',
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
        if (!active) e.currentTarget.style.background = 'var(--claude-border-cream)';
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
        size={36}
        radius="md"
        variant={active ? 'light' : 'transparent'}
        color={active ? color : 'gray'}
      >
        <Icon size={20} />
      </ThemeIcon>
      <Text size="md" style={{ fontWeight: 'inherit', color: 'inherit' }}>
        {item.label}
      </Text>
    </Box>
  );
}

export default function PortalLayout({ role, children }: PortalLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  // Sidebar nav follows the route's `role` prop by default. This preserves the
  // admin role-switcher in the TopBar (admin clicks "Faculty" → faculty sidebar).
  // Exception: a simulation_designer's nav has been merged with faculty's, so
  // when they browse /faculty/* we still want them to see their original
  // Patient Profiles / Unity Builds / Scenes entries — keep using their role.
  const authRole = useSelector(selectRole);
  const navRole: UserRole =
    authRole === 'simulation_designer' && (role === 'faculty' || role === 'simulation_designer')
      ? 'simulation_designer'
      : role;
  const items = NAV_ITEMS[navRole];
  const meta = ROLE_META[role]; // visual portal label still follows the route
  const isImmersiveSessionRoute = role === 'student' && /^\/student\/session\/[^/]+$/.test(location.pathname);

  return (
    <Box
      style={{
        display: 'flex',
        minHeight: isImmersiveSessionRoute ? 'calc(100dvh - 56px)' : '100dvh',
        background: 'var(--claude-parchment)',
      }}
    >
      {/* ── Sidebar ── */}
      {!isImmersiveSessionRoute && (
        <Box
          style={{
            width: SIDEBAR_W,
            background: 'var(--claude-parchment)',
            borderRight: '1px solid var(--claude-border-cream)',
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
                  background: meta.dot,
                  flexShrink: 0,
                }}
              />
              <Text
                size="xs"
                fw={500}
                c="var(--claude-stone)"
                style={{ textTransform: 'uppercase', letterSpacing: 1.2 }}
              >
                {meta.label}
              </Text>
            </Group>
          </Box>

          {/* Separator */}
          <Box style={{ height: 1, background: 'var(--claude-border-cream)', margin: '0 24px 8px' }} />

          {/* Nav items */}
          <Stack gap={2} style={{ flex: 1, paddingTop: 4, paddingBottom: 20 }}>
            {(() => {
              // Pick the single most-specific matching item: the one whose path
              // is the longest prefix of the current pathname. Prevents e.g.
              // /faculty/assignments/new from highlighting both "Create" and
              // "Manage Assignments".
              let activeIdx = -1;
              let bestLen = -1;
              items.forEach((item, idx) => {
                const exact = location.pathname === item.path;
                const prefix = location.pathname.startsWith(item.path + '/');
                if ((exact || prefix) && item.path.length > bestLen) {
                  activeIdx = idx;
                  bestLen = item.path.length;
                }
              });
              return items.map((item, idx) => {
                const prevSection = idx > 0 ? items[idx - 1].section : undefined;
                const showHeader = item.section && item.section !== prevSection;
                return (
                  <Box key={item.path}>
                    {showHeader && (
                      <Text
                        size="xs"
                        fw={700}
                        c="dimmed"
                        style={{
                          textTransform: 'uppercase',
                          letterSpacing: 1.2,
                          padding: '12px 24px 4px',
                        }}
                      >
                        {item.section}
                      </Text>
                    )}
                    <SidebarItem
                      item={item}
                      active={idx === activeIdx}
                      color={meta.color}
                      onClick={() => navigate(item.path)}
                    />
                  </Box>
                );
              });
            })()}
          </Stack>
        </Box>
      )}

      {/* ── Main content ── */}
      <Box
        style={{
          marginLeft: isImmersiveSessionRoute ? 0 : SIDEBAR_W,
          flex: 1,
          padding: isImmersiveSessionRoute ? 0 : '28px 32px',
          background: 'var(--claude-parchment)',
          minHeight: isImmersiveSessionRoute ? 'calc(100dvh - 56px)' : '100dvh',
          overflow: isImmersiveSessionRoute ? 'auto' : undefined,
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
