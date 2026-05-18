import { Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { Box, Loader, Text, Stack } from '@mantine/core';
import { selectRole, selectIsAuthenticated, type UserRole } from '../slices/authSlice';

interface RoleGuardProps {
  allowedRoles: UserRole[];
  children: React.ReactNode;
}

/**
 * Protects routes by checking the user's role.
 *
 * Important: until `setAuth` has fired (initial Redux state has role="student"
 * by default but isAuthenticated=false), we MUST NOT redirect — otherwise a
 * faculty user refreshing on /faculty/* gets bounced through /student/dashboard
 * before role loads, and ends up at /faculty/dashboard losing their URL.
 */
export default function RoleGuard({ allowedRoles, children }: RoleGuardProps) {
  const role = useSelector(selectRole);
  const isAuthenticated = useSelector(selectIsAuthenticated);

  // Auth state hasn't been hydrated from Cognito yet — wait, don't redirect.
  if (!isAuthenticated) {
    return (
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '60vh',
        }}
      >
        <Stack align="center" gap="sm">
          <Loader size="md" />
          <Text size="sm" c="dimmed">
            Loading your session…
          </Text>
        </Stack>
      </Box>
    );
  }

  if (!allowedRoles.includes(role)) {
    const redirectMap: Record<UserRole, string> = {
      student: '/student/dashboard',
      faculty: '/faculty/dashboard',
      simulation_designer: '/simulation-designer/patient-profiles',
      admin: '/admin/dashboard',
    };
    return <Navigate to={redirectMap[role]} replace />;
  }

  return <>{children}</>;
}
