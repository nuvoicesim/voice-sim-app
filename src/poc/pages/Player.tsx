// src/poc/pages/Player.tsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Loader, Text, Paper } from '@mantine/core';
import { simulationConfig } from '../config/simulation';

// Extend Window interface to include Unity loader
declare global {
  interface Window {
    createUnityInstance: any;
  }
}

export default function Player() {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const unityInstanceRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadUnity = async () => {
      try {
        if (!canvasRef.current) {
          throw new Error('Canvas ref not found');
        }

        console.log('[Player] Starting Unity load...');

        // Unity build configuration
        const buildConfig = {
          dataUrl: "/poc/Build/poc.data",
          frameworkUrl: "/poc/Build/poc.framework.js",
          codeUrl: "/poc/Build/poc.wasm",
          streamingAssetsUrl: "StreamingAssets",
          companyName: "VOICE",
          productName: "Clinical Simulation",
          productVersion: "1.0.0",
        };

        console.log('[Player] Unity config:', buildConfig);

        // Create Unity instance
        const unityInstance = await window.createUnityInstance(
          canvasRef.current,
          buildConfig,
          (progress: number) => {
            const percent = Math.round(progress * 100);
            setLoadingProgress(percent);
            console.log(`[Player] Loading: ${percent}%`);
          }
        );

        console.log('[Player] Unity loaded successfully');
        unityInstanceRef.current = unityInstance;
        setLoading(false);

        // Wait a moment for Unity to fully initialize
        setTimeout(() => {
          sendConfigToUnity(unityInstance);
        }, 1000);

      } catch (err: any) {
        console.error('[Player] Unity loading error:', err);
        setError(err.message || 'Failed to load simulation');
        setLoading(false);
      }
    };

    loadUnity();

    // Cleanup on unmount
    return () => {
      if (unityInstanceRef.current) {
        console.log('[Player] Cleaning up Unity instance');
        try {
          unityInstanceRef.current.Quit();
        } catch (e) {
          console.warn('[Player] Error during cleanup:', e);
        }
      }
    };
  }, []);

  const sendConfigToUnity = (unityInstance: any) => {
    // Build config object to send to Unity
    const config = {
      disease: simulationConfig.disease,
      mode: simulationConfig.mode,
      difficulty: simulationConfig.difficulty,
      avatarId: simulationConfig.avatarId,
      environmentId: simulationConfig.environmentId,
      sessionId: Date.now().toString(),
    };

    console.log('[Player] Sending config to Unity:', config);

    try {
      // Send message to Unity
      unityInstance.SendMessage(
        'SimulationManager',      // GameObject name in Unity scene
        'InitializeFromBrowser',  // C# method name
        JSON.stringify(config)    // JSON string
      );
      console.log('[Player] Config sent successfully');
    } catch (err) {
      console.error('[Player] Error sending config to Unity:', err);
      setError('Failed to communicate with Unity');
    }
  };

  const handleExit = () => {
    if (window.confirm('Are you sure you want to exit the simulation?')) {
      navigate('/poc/demo');
    }
  };

  // Error state
  if (error) {
    return (
      <Box style={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        background: '#f8fafc'
      }}>
        <Paper shadow="md" p="xl" style={{ maxWidth: '500px' }}>
          <Text size="xl" weight={700} color="red" mb="md">
            ⚠️ Error Loading Simulation
          </Text>
          <Text color="dimmed" mb="xl">
            {error}
          </Text>
          <Text size="sm" color="dimmed" mb="xl">
            Make sure Unity WebGL build exists in <code>/public/unity/Build/</code>
          </Text>
          <Button 
            onClick={() => navigate('/poc/demo')}
            fullWidth
            variant="outline"
          >
            Back to Demo
          </Button>
        </Paper>
      </Box>
    );
  }

  return (
    <Box style={{ 
      position: 'relative',
      width: '100vw',
      height: '100vh',
      background: '#000',
      overflow: 'hidden'
    }}>
      {/* Loading Overlay */}
      {loading && (
        <Box style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.9)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10
        }}>
          <Loader size="xl" color="blue" mb="xl" />
          <Text size="xl" weight={600} style={{ color: 'white' }} mb="sm">
            Loading Simulation...
          </Text>
          <Text size="lg" style={{ color: '#94a3b8' }}>
            {loadingProgress}%
          </Text>
        </Box>
      )}

      {/* Unity Canvas */}
      <canvas 
        ref={canvasRef}
        id="unity-canvas"
        style={{
          width: '100%',
          height: '100%',
          display: 'block'
        }}
      />

      {/* Exit Button */}
      <Button
        onClick={handleExit}
        color="red"
        size="md"
        style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          zIndex: 20
        }}
      >
        Exit Simulation
      </Button>

      {/* Debug Info (bottom-left corner) */}
      <Box style={{
        position: 'absolute',
        bottom: '20px',
        left: '20px',
        background: 'rgba(0, 0, 0, 0.7)',
        padding: '12px 16px',
        borderRadius: '8px',
        zIndex: 20
      }}>
        <Text size="xs" style={{ color: '#94a3b8', fontFamily: 'monospace' }}>
          Config: {simulationConfig.avatarId} + {simulationConfig.environmentId}
        </Text>
        <Text size="xs" style={{ color: '#94a3b8', fontFamily: 'monospace' }}>
          Mode: {simulationConfig.mode} | Difficulty: {simulationConfig.difficulty}
        </Text>
      </Box>
    </Box>
  );
}