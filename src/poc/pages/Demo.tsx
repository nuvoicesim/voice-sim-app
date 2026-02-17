// src/poc/pages/Demo.tsx
import { useNavigate } from 'react-router-dom';
import { Container, Paper, Title, Text, Button, Grid, Box, Badge } from '@mantine/core';
import { simulationConfig } from '../config/simulation';

export default function Demo() {
  const navigate = useNavigate();

  const handleLaunch = () => {
    console.log('Launching simulation with config:', simulationConfig);
    navigate('/poc/player');
  };

  return (
    <Box style={{ 
      minHeight: '100vh', 
      background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
      padding: '40px 20px'
    }}>
      <Container size="lg">
        {/* Header */}
        <Box style={{ textAlign: 'center', marginBottom: '40px' }}>
          <Title order={1} style={{ color: '#1e293b', marginBottom: '10px' }}>
            {simulationConfig.title}
          </Title>
        </Box>

        {/* Main Card */}
        <Paper shadow="xl" p="xl" radius="lg">
          {/* Simulation Title */}
          <Box mb="xl">
            <Box style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
              <Text size="xl">🗣️</Text>
              <Title order={2}>{simulationConfig.title}</Title>
            </Box>
            <Text color="dimmed" style={{ marginLeft: '44px' }}>
              {simulationConfig.description}
            </Text>
          </Box>

          {/* Configuration Details */}
          <Paper 
            p="lg" 
            mb="xl"
            style={{ 
              background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
              border: '1px solid #bae6fd'
            }}
          >
            <Box style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <Text size="sm">⚙️</Text>
              <Text weight={600}>Simulation Configuration</Text>
            </Box>
            
            <Grid gutter="md">
              {/* Patient Info */}
              <Grid.Col span={6}>
                <Paper p="md" style={{ background: 'white' }}>
                  <Text size="xs" color="dimmed" mb={4}>Patient</Text>
                  <Text weight={600}>{simulationConfig.patientName}</Text>
                  <Text size="sm" color="dimmed">Age {simulationConfig.patientAge}</Text>
                </Paper>
              </Grid.Col>

              {/* Environment */}
              <Grid.Col span={6}>
                <Paper p="md" style={{ background: 'white' }}>
                  <Text size="xs" color="dimmed" mb={4}>Environment</Text>
                  <Text weight={600}>{simulationConfig.environmentName}</Text>
                </Paper>
              </Grid.Col>

              {/* Disease */}
              <Grid.Col span={6}>
                <Paper p="md" style={{ background: 'white' }}>
                  <Text size="xs" color="dimmed" mb={4}>Disease Type</Text>
                  <Text weight={600} transform="capitalize">
                    {simulationConfig.disease.replace('-', ' ')}
                  </Text>
                </Paper>
              </Grid.Col>

              {/* Mode */}
              <Grid.Col span={6}>
                <Paper p="md" style={{ background: 'white' }}>
                  <Text size="xs" color="dimmed" mb={4}>Mode</Text>
                  <Box style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Badge color="blue" variant="light" style={{ textTransform: 'capitalize' }}>
                      {simulationConfig.mode}
                    </Badge>
                    {simulationConfig.mode === 'practice' && (
                      <Text size="xs" color="dimmed">(hints enabled)</Text>
                    )}
                  </Box>
                </Paper>
              </Grid.Col>

              {/* Difficulty */}
              <Grid.Col span={6}>
                <Paper p="md" style={{ background: 'white' }}>
                  <Text size="xs" color="dimmed" mb={4}>Difficulty</Text>
                  <Text weight={600} transform="capitalize">
                    {simulationConfig.difficulty}
                  </Text>
                </Paper>
              </Grid.Col>

              {/* Avatar ID */}
              <Grid.Col span={6}>
                <Paper p="md" style={{ background: 'white' }}>
                  <Text size="xs" color="dimmed" mb={4}>Avatar Asset</Text>
                  <Text size="xs" style={{ fontFamily: 'monospace' }} color="dimmed">
                    {simulationConfig.avatarId}
                  </Text>
                </Paper>
              </Grid.Col>
            </Grid>
          </Paper>

          {/* Launch Button */}
          <Button
            onClick={handleLaunch}
            size="xl"
            fullWidth
            style={{
              background: '#3b82f6',
              height: '60px',
              fontSize: '18px',
              fontWeight: 600
            }}
          >
            🚀 Launch Simulation
          </Button>

          {/* Back Link */}
          <Box style={{ marginTop: '16px', textAlign: 'center' }}>
            <Text 
              component="a" 
              href="/"
              size="sm" 
              color="dimmed"
              style={{ cursor: 'pointer', textDecoration: 'none' }}
            >
              ← Back to Main App
            </Text>
          </Box>
        </Paper>
      </Container>
    </Box>
  );
}