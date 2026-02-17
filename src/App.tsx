import { useEffect } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { Box } from '@mantine/core';
import TopBar from './TopBar';
import Sidebar from './MainApp/SideBar';
import InformedConsent from './MainApp/StepContents/InformedConsent';
import PreSurvey from './MainApp/StepContents/PreSurvey';
import SimulationTutorial from './MainApp/StepContents/SimulationTutorial';
import Level1Simulation from './MainApp/StepContents/Level1Simulation';
import Level2Simulation from './MainApp/StepContents/Level2Simulation';
import Level3Simulation from './MainApp/StepContents/Level3Simulation'; 
import PostSurvey from './MainApp/StepContents/PostSurvey';
import CompletionPage from './MainApp/StepContents/CompletionPage';
import { autoCompletePreviousSteps, getNextStep, selectAllSteps, selectCompletedStepPaths, setCurrentCompletedStep, setCurrentUser } from './reducer';
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import type { RootState } from './store';
import { fetchUserAttributes } from 'aws-amplify/auth';
import Demo from './poc/pages/Demo';
import Player from "./poc/pages/Player";

function App() {
  const location = useLocation();
  // POC routes 
  if (location.pathname.startsWith('/poc')) {
    return (
      <Routes>
        <Route path="/poc/demo" element={<Demo />} />
        <Route path="/poc/player" element={<Player />} />
      </Routes>
    );
  }

  const dispatch = useDispatch();
  const navigate = useNavigate();
  const steps = useSelector((state: RootState) => selectAllSteps(state));
  const completedStepPaths = useSelector((state: RootState) => selectCompletedStepPaths(state));

  const { user, signOut } = useAuthenticator();

  // Set current user in Redux when user changes
  useEffect(() => {
    if (user?.username) {
      dispatch(setCurrentUser(user.username));
    }
  }, [user?.username, dispatch]);

  // Load user data and sync with Cognito on mount
  useEffect(() => {
    if (!user?.username) return;

    const loadUserData = async () => {
      // First, ensure current user is set in Redux (this initializes user state)
      dispatch(setCurrentUser(user.username));
      
      // Load Current Completed Step from Cognito
      const attrs = await fetchUserAttributes();
      const completedStep = attrs['custom:currentCompletedStep'];
      
      if (completedStep) {
        dispatch(setCurrentCompletedStep(completedStep));
        dispatch(autoCompletePreviousSteps(getNextStep(completedStep)));
        
        // Only auto-navigate if user is on an incomplete step
        const nextStep = getNextStep(completedStep);
        const isOnCompletedStep = completedStepPaths.includes(location.pathname);
        const isOnNextStep = location.pathname === nextStep;
        
        // Only navigate if user is not on a completed step or the next step
        if (!isOnCompletedStep && !isOnNextStep) {
          navigate(nextStep);
        }
      } else {
        navigate('/informed-consent');
      }
    };

    loadUserData();
  }, [user?.username, dispatch, navigate, location.pathname]);
  
  function AppRoutes() {
    return (
      <Box 
        style={{ 
        background: '#f8f9fa', 
        minHeight: '100vh',
        width: '100vw',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      <TopBar signOut={signOut} user={user} />
      <Sidebar
        steps={steps.map(step => ({ name: step.name, path: step.path }))}
        completedSteps={completedStepPaths}
      />
      <Box
        style={{
          marginLeft: '250px', // Account for sidebar width
          minHeight: '100vh',
          width: 'calc(100vw - 250px)', // Full width minus sidebar
          background: 'white',
          boxSizing: 'border-box'
        }}
      >
        <Routes>
          <Route path="/" element={<Navigate to="/informed-consent" replace />} />
          <Route path="/informed-consent" element={<InformedConsent />} />  
          <Route path="/pre-survey" element={<PreSurvey />} />
          <Route path="/simulation-tutorial" element={<SimulationTutorial />} />
          <Route path="/level-1-simulation" element={<Level1Simulation />} />
          <Route path="/level-2-simulation" element={<Level2Simulation />} />
          <Route path="/level-3-simulation" element={<Level3Simulation />} />
          <Route path="/post-survey" element={<PostSurvey />} />
          <Route path="/completion" element={<CompletionPage />} />
        </Routes>
        </Box>
      </Box>
    );
  }

  return (
    <Authenticator>
      <AppRoutes />
    </Authenticator>
  );
}

export default App;
