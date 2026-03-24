import { Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { selectRole, type UserRole } from '../slices/authSlice';

interface RoleGuardProps {
  allowedRoles: UserRole[];
  children: React.ReactNode;
}

/**
 * Protects routes by checking the user's role.
 * Redirects to the appropriate portal if the role doesn't match.
 */
export default function RoleGuard({ allowedRoles, children }: RoleGuardProps) {
  const role = useSelector(selectRole);

  if (!allowedRoles.includes(role)) {
    const redirectMap: Record<UserRole, string> = {
      student: '/student/dashboard',
      faculty: '/faculty/dashboard',
      admin: '/admin/dashboard',
    };
    return <Navigate to={redirectMap[role]} replace />;
  }

  return <>{children}</>;
}
