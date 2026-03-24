import { useEffect } from "react";
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { Box } from '@mantine/core';
import TopBar from './TopBar';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { fetchUserAttributes } from 'aws-amplify/auth';
import type { AppDispatch } from './store';

import { setAuth, selectRole } from './slices/authSlice';
import type { UserRole } from './slices/authSlice';
import { setCurrentUser } from './reducer';

// Portal components
import RoleGuard from './components/RoleGuard';
import PortalLayout from './components/PortalLayout';

// Student portal
import StudentDashboard from './portals/student/StudentDashboard';
import AssignmentsPage from './portals/student/AssignmentsPage';
import SessionRunner from './portals/student/SessionRunner';
import HistoryPage from './portals/student/HistoryPage';
import SessionDetailPage from './portals/student/SessionDetailPage';

// Faculty portal
import FacultyDashboard from './portals/faculty/FacultyDashboard';
import CreateAssignment from './portals/faculty/CreateAssignment';
import AssignmentManagement from './portals/faculty/AssignmentManagement';
import StudentsDataPage from './portals/faculty/StudentsDataPage';
import AnalysisPage from './portals/faculty/AnalysisPage';
import SceneManagement from './portals/faculty/SceneManagement';

// Admin portal
import AdminDashboard from './portals/admin/AdminDashboard';
import UsersRolesPage from './portals/admin/UsersRolesPage';
import GlobalAnalyticsPage from './portals/admin/GlobalAnalyticsPage';

const PORTAL_HOME: Record<UserRole, string> = {
  student: '/student/dashboard',
  faculty: '/faculty/dashboard',
  admin: '/admin/dashboard',
};

function App() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const { user, signOut } = useAuthenticator();
  const role = useSelector(selectRole);

  useEffect(() => {
    if (!user?.username) return;

    const loadUserData = async () => {
      dispatch(setCurrentUser(user.username));

      const attrs = await fetchUserAttributes();
      const userRole = (attrs['custom:role'] as UserRole) || 'student';

      dispatch(setAuth({
        userId: user.username,
        email: attrs.email,
        role: userRole,
      }));

      navigate(PORTAL_HOME[userRole]);
    };

    loadUserData();
  }, [user?.username, dispatch]);

  return (
    <Box style={{ background: '#f8f9fa', minHeight: '100vh', width: '100vw', position: 'relative', overflow: 'hidden' }}>
      <TopBar signOut={signOut} user={user} role={role} />

      <Box style={{ paddingTop: 56 }}>
        <Routes>
          <Route path="/" element={<Navigate to={PORTAL_HOME[role]} replace />} />

          {/* Student Portal */}
          <Route path="/student/*" element={
            <RoleGuard allowedRoles={['student']}>
              <PortalLayout role="student">
                <Routes>
                  <Route path="dashboard" element={<StudentDashboard />} />
                  <Route path="assignments" element={<AssignmentsPage />} />
                  <Route path="session/:sessionId" element={<SessionRunner />} />
                  <Route path="session/:sessionId/detail" element={<SessionDetailPage />} />
                  <Route path="history" element={<HistoryPage />} />
                  <Route path="*" element={<Navigate to="dashboard" replace />} />
                </Routes>
              </PortalLayout>
            </RoleGuard>
          } />

          {/* Faculty Portal */}
          <Route path="/faculty/*" element={
            <RoleGuard allowedRoles={['faculty', 'admin']}>
              <PortalLayout role="faculty">
                <Routes>
                  <Route path="dashboard" element={<FacultyDashboard />} />
                  <Route path="assignments/new" element={<CreateAssignment />} />
                  <Route path="assignments" element={<AssignmentManagement />} />
                  <Route path="scenes" element={<SceneManagement />} />
                  <Route path="students" element={<StudentsDataPage />} />
                  <Route path="analysis" element={<AnalysisPage />} />
                  <Route path="*" element={<Navigate to="dashboard" replace />} />
                </Routes>
              </PortalLayout>
            </RoleGuard>
          } />

          {/* Admin Portal */}
          <Route path="/admin/*" element={
            <RoleGuard allowedRoles={['admin']}>
              <PortalLayout role="admin">
                <Routes>
                  <Route path="dashboard" element={<AdminDashboard />} />
                  <Route path="users" element={<UsersRolesPage />} />
                  <Route path="analytics" element={<GlobalAnalyticsPage />} />
                  <Route path="*" element={<Navigate to="dashboard" replace />} />
                </Routes>
              </PortalLayout>
            </RoleGuard>
          } />

          {/* Legacy paths redirect to portal home (Phase 3 deprecation) */}
          <Route path="/informed-consent" element={<Navigate to={PORTAL_HOME[role]} replace />} />
          <Route path="/pre-survey" element={<Navigate to={PORTAL_HOME[role]} replace />} />
          <Route path="/simulation-tutorial" element={<Navigate to={PORTAL_HOME[role]} replace />} />
          <Route path="/level-1-simulation" element={<Navigate to={PORTAL_HOME[role]} replace />} />
          <Route path="/level-2-simulation" element={<Navigate to={PORTAL_HOME[role]} replace />} />
          <Route path="/level-3-simulation" element={<Navigate to={PORTAL_HOME[role]} replace />} />
          <Route path="/post-survey" element={<Navigate to={PORTAL_HOME[role]} replace />} />
          <Route path="/completion" element={<Navigate to={PORTAL_HOME[role]} replace />} />

          {/* Catch-all */}
          <Route path="*" element={<Navigate to={PORTAL_HOME[role]} replace />} />
        </Routes>
      </Box>
    </Box>
  );
}

export default App;
