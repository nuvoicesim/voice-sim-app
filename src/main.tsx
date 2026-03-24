import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { Authenticator } from '@aws-amplify/ui-react'
import '@aws-amplify/ui-react/styles.css'
import { MantineProvider } from '@mantine/core'
import '@mantine/core/styles.css'
import { BrowserRouter } from 'react-router-dom'
import { Amplify } from 'aws-amplify'
import { parseAmplifyConfig } from "aws-amplify/utils";
import outputs from '../amplify_outputs.json'
import { Provider } from 'react-redux'
import { store } from './store'

const amplifyConfig = parseAmplifyConfig(outputs);

// Check if custom API configuration exists
const customAPI = (outputs as any).custom?.API || {};

Amplify.configure({
  ...amplifyConfig,
  API: {
    ...amplifyConfig.API,
    REST: customAPI,
  },
});

const HeadphoneIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
    <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
  </svg>
);

const BrainIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>
  </svg>
);

const ChartIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
  </svg>
);

const BookIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
  </svg>
);

const ShieldIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>
    <path d="m9 12 2 2 4-4"/>
  </svg>
);

const components = {
  Header() {
    return (
      <>
        {/* ── Left brand panel (fixed) ── */}
        <div className="voice-brand-panel">
          <div className="voice-brand-content">
            <div className="voice-brand-logo">
              <HeadphoneIcon />
            </div>
            <h1 className="voice-brand-title">VOICE</h1>
            <p className="voice-brand-tagline">
              Next-generation clinical simulation platform for
              Speech-Language Pathology education.
            </p>

            <div className="voice-brand-features">
              <div className="voice-brand-feature">
                <div className="voice-brand-feature-icon"><BrainIcon /></div>
                <div className="voice-brand-feature-text">
                  <h4>AI-Powered Virtual Patients</h4>
                  <p>Practice with realistic patient simulations driven by advanced language models</p>
                </div>
              </div>
              <div className="voice-brand-feature">
                <div className="voice-brand-feature-icon"><ChartIcon /></div>
                <div className="voice-brand-feature-text">
                  <h4>Real-time Performance Scoring</h4>
                  <p>Get instant feedback with rubric-based evaluation after each session</p>
                </div>
              </div>
              <div className="voice-brand-feature">
                <div className="voice-brand-feature-icon"><BookIcon /></div>
                <div className="voice-brand-feature-text">
                  <h4>Evidence-based Scenarios</h4>
                  <p>Clinically validated simulation scenarios designed by SLP experts</p>
                </div>
              </div>
              <div className="voice-brand-feature">
                <div className="voice-brand-feature-icon"><ShieldIcon /></div>
                <div className="voice-brand-feature-text">
                  <h4>Safe Learning Environment</h4>
                  <p>Practice critical skills without risk in a controlled virtual setting</p>
                </div>
              </div>
            </div>

            <div className="voice-brand-stats">
              <div>
                <p className="voice-brand-stat-value">3D</p>
                <p className="voice-brand-stat-label">Unity Sims</p>
              </div>
              <div>
                <p className="voice-brand-stat-value">AI</p>
                <p className="voice-brand-stat-label">LLM Dialogue</p>
              </div>
              <div>
                <p className="voice-brand-stat-value">Live</p>
                <p className="voice-brand-stat-label">Scoring</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Right panel header (above form) ── */}
        <div className="voice-form-header">
          <h2>Welcome back</h2>
          <p>Sign in to continue to your portal</p>
        </div>
      </>
    );
  },
  Footer() {
    return (
      <div className="voice-auth-footer">
        <p>VOICE &mdash; Speech-Language Pathology Simulation Platform</p>
      </div>
    );
  },
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MantineProvider>
      <BrowserRouter>
        <Provider store={store}>
          <Authenticator components={components} loginMechanisms={['username']}>
            <App />
          </Authenticator>
        </Provider>
      </BrowserRouter>
    </MantineProvider>
  </React.StrictMode>,
)
