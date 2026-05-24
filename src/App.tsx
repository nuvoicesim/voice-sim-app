import { useEffect } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
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
import PatientProfilesPage from './portals/simulation-designer/PatientProfilesPage';
import UnityBuildsPage from './portals/simulation-designer/UnityBuildsPage';

// Faculty courses & surveys (Canvas-like LMS feature)
import FacultyCourseListPage from './portals/faculty/courses/FacultyCourseListPage';
import CreateCoursePage from './portals/faculty/courses/CreateCoursePage';
import CourseEditorPage from './portals/faculty/courses/CourseEditorPage';
import ModuleEditorPage from './portals/faculty/courses/ModuleEditorPage';
import ModuleItemEditorPage from './portals/faculty/courses/ModuleItemEditorPage';
import CourseReviewBoardPage from './portals/faculty/courses/CourseReviewBoardPage';
import StudentCourseDetailPage from './portals/faculty/courses/StudentCourseDetailPage';
import SurveyTemplateListPage from './portals/faculty/surveys/SurveyTemplateListPage';
import SurveyTemplateEditorPage from './portals/faculty/surveys/SurveyTemplateEditorPage';

// Student courses
import StudentCourseListPage from './portals/student/courses/StudentCourseListPage';
import StudentCoursePage from './portals/student/courses/StudentCoursePage';
import ModuleItemPlayerPage from './portals/student/courses/ModuleItemPlayerPage';

// Admin portal
import AdminDashboard from './portals/admin/AdminDashboard';
import UsersRolesPage from './portals/admin/UsersRolesPage';
import GlobalAnalyticsPage from './portals/admin/GlobalAnalyticsPage';
import EventLogsPage from './portals/admin/EventLogsPage';

const PORTAL_HOME: Record<UserRole, string> = {
  student: '/student/dashboard',
  faculty: '/faculty/dashboard',
  simulation_designer: '/simulation-designer/patient-profiles',
  admin: '/admin/dashboard',
};

function App() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuthenticator();
  const role = useSelector(selectRole);

  useEffect(() => {
    if (!user?.username) return;

    const loadUserData = async () => {
      dispatch(setCurrentUser(user.username));

      const attrs = await fetchUserAttributes();
      const userRole = (attrs['custom:role'] as UserRole) || 'student';
      const userId = attrs.sub || user.username;

      dispatch(setAuth({
        userId,
        email: attrs.email,
        role: userRole,
      }));

      if (location.pathname === '/') {
        navigate(PORTAL_HOME[userRole], { replace: true });
      }
    };

    loadUserData();
  }, [user?.username, dispatch, navigate, location.pathname]);

  return (
    <Box style={{ background: 'var(--claude-parchment)', minHeight: '100vh', width: '100vw', position: 'relative', overflow: 'hidden' }}>
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
                  <Route path="courses" element={<StudentCourseListPage />} />
                  <Route path="courses/:courseId" element={<StudentCoursePage />} />
                  <Route path="courses/:courseId/items/:itemId" element={<ModuleItemPlayerPage />} />
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
            <RoleGuard allowedRoles={['faculty', 'simulation_designer', 'admin']}>
              <PortalLayout role="faculty">
                <Routes>
                  <Route path="dashboard" element={<FacultyDashboard />} />
                  <Route path="courses" element={<FacultyCourseListPage />} />
                  <Route path="courses/new" element={<CreateCoursePage />} />
                  <Route path="courses/:courseId" element={<CourseEditorPage />} />
                  <Route path="courses/:courseId/reviews" element={<CourseReviewBoardPage />} />
                  <Route path="courses/:courseId/students/:studentUserId" element={<StudentCourseDetailPage />} />
                  <Route path="courses/:courseId/modules/:moduleId" element={<ModuleEditorPage />} />
                  <Route path="courses/:courseId/modules/:moduleId/items/:itemId" element={<ModuleItemEditorPage />} />
                  <Route path="surveys" element={<SurveyTemplateListPage />} />
                  <Route path="surveys/:templateId" element={<SurveyTemplateEditorPage />} />
                  <Route path="assignments/new" element={<CreateAssignment />} />
                  <Route path="assignments/:assignmentId/edit" element={<CreateAssignment />} />
                  <Route path="assignments" element={<AssignmentManagement />} />
                  <Route path="students" element={<StudentsDataPage />} />
                  <Route path="analysis" element={<AnalysisPage />} />
                  <Route path="*" element={<Navigate to="dashboard" replace />} />
                </Routes>
              </PortalLayout>
            </RoleGuard>
          } />

          <Route path="/simulation-designer/*" element={
            <RoleGuard allowedRoles={['simulation_designer', 'admin']}>
              <PortalLayout role="simulation_designer">
                <Routes>
                  <Route path="patient-profiles" element={<PatientProfilesPage />} />
                  <Route path="unity-builds" element={<UnityBuildsPage />} />
                  <Route path="scenes" element={<SceneManagement />} />
                  <Route path="dashboard" element={<Navigate to="/simulation-designer/patient-profiles" replace />} />
                  <Route path="*" element={<Navigate to="patient-profiles" replace />} />
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
                  <Route path="courses" element={<FacultyCourseListPage />} />
                  <Route path="courses/:courseId" element={<CourseEditorPage />} />
                  <Route path="courses/:courseId/modules/:moduleId" element={<ModuleEditorPage />} />
                  <Route path="courses/:courseId/modules/:moduleId/items/:itemId" element={<ModuleItemEditorPage />} />
                  <Route path="courses/:courseId/reviews" element={<CourseReviewBoardPage />} />
                  <Route path="courses/:courseId/students/:studentUserId" element={<StudentCourseDetailPage />} />
                  <Route path="users" element={<UsersRolesPage />} />
                  <Route path="analytics" element={<GlobalAnalyticsPage />} />
                  <Route path="logs" element={<EventLogsPage />} />
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
