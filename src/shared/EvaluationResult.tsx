import React from 'react';
import { Box, Text, Paper, Stack, Group, Title, Divider, Badge, Center } from '@mantine/core';

// 定义评估数据的类型
interface Criterion {
  explanation: string;
  maxScore: number;
  name: string;
  score: number;
}

interface EvaluationReportData {
  criteriaDetails: Criterion[];
  overallExplanation: string;
  performanceLevel: string;
  totalScore: number;
}

const EvaluationResult: React.FC<{ 
  evaluationData: EvaluationReportData | null, 
  level: number, 
  patientBackground: string 
}> = ({ evaluationData, level, patientBackground }) => {
  // 如果evaluationData为null，显示loading状态
  if (!evaluationData) {
    return (
      <Box style={{ 
        maxWidth: '1200px', 
        margin: '0 auto', 
        padding: '20px', 
        backgroundColor: 'white'
      }}>
        <Paper shadow="sm" p="xl" radius="md" style={{ backgroundColor: 'white' }}>
          <Center style={{ height: '200px' }}>
            <Text size="lg" c="dimmed">Loading evaluation data...</Text>
          </Center>
        </Paper>
      </Box>
    );
  }

  // 计算总分和满分
  const maxTotalScore = evaluationData.criteriaDetails.reduce((sum, criterion) => {
    return sum + (Number(criterion.maxScore) || 0);
  }, 0);
  
  // 验证totalScore
  const calculatedTotalScore = evaluationData.criteriaDetails.reduce((sum, criterion) => {
    return sum + (Number(criterion.score) || 0);
  }, 0);
  
  const getOverallColor = (score: number, maxScore: number) => {
    const percentage = score / maxScore;
    if (percentage >= 0.8) return 'green';
    if (percentage >= 0.6) return 'blue';
    if (percentage >= 0.4) return 'orange';
    return 'red';
  };

  return (
    <Box style={{ 
      maxWidth: '1200px', 
      margin: '0 auto',
      marginTop: '1.5rem', 
      padding: '20px', 
      backgroundColor: 'white'
    }}>
      <Paper shadow="sm" p="xl" radius="md" style={{ backgroundColor: 'white' }}>
        {/* 页面标题 */}
        <Center style={{ marginBottom: '40px' }}>
          <Box ta="center">
            <Title
              order={1}
              c='#4f46e5'
              mb="md"
              style={{
                fontSize: '36px',
                fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
                letterSpacing: '1.5px',
                fontWeight: 'bold'
              }}
            >
              Level {level} Evaluation Report
            </Title>
          </Box>
        </Center>

        <Text
            size="lg"
            c="dimmed"
            style={{
              maxWidth: '1200px',
              margin: '0 auto',
              marginBottom: '40px',
              lineHeight: '1.6'
            }}
          >
            <strong>Patient Background:</strong> {patientBackground}
          </Text>

        {/* 总体评分概览 */}
        <Paper 
          shadow="xs" 
          p="xl" 
          radius="md" 
          style={{ 
            backgroundColor: '#f0f8ff', 
            border: '2px solid #4f46e5',
            marginBottom: '40px'
          }}
        >
          <Group justify="space-between" align="center">
            <Box>
              <Text size="xl" fw={600} c="#4f46e5">Overall Performance</Text>
              <Text size="sm" c="dimmed">Comprehensive evaluation summary</Text>
            </Box>
            <Group gap="xl">
              <Box ta="center">
                <Badge 
                  size="xl" 
                  variant="filled" 
                  color={getOverallColor(calculatedTotalScore, maxTotalScore)}
                  style={{ fontSize: '16px', padding: '12px 20px' }}
                >
                  {evaluationData.performanceLevel}
                </Badge>
                <Text size="sm" c="dimmed" mt="xs">Performance Level</Text>
              </Box>
              <Box ta="center">
                <Badge 
                  size="xl" 
                  variant="filled" 
                  color={getOverallColor(calculatedTotalScore, maxTotalScore)}
                  style={{ fontSize: '16px', padding: '12px 20px' }}
                >
                  Hidden
                </Badge>
                <Text size="sm" c="dimmed" mt="xs">Score</Text>
              </Box>
            </Group>
          </Group>
        </Paper>

        {/* 详细评估标准 */}
        <Title order={2} mb="lg" c="#2c3e50">Detailed Assessment Criteria</Title>
        <Stack gap="lg" mb="xl">
          {evaluationData.criteriaDetails.map((criterion, index) => (
            <Paper 
              key={index} 
              shadow="sm" 
              p="lg" 
              radius="md" 
              style={{ 
                backgroundColor: 'white',
                border: '1px solid #e9ecef',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
              }}
            >
              <Group justify="space-between" align="flex-start" mb="md">
                <Box style={{ flex: 1 }}>
                  <Text fw={600} size="lg" c="#2c3e50" mb="xs">
                    {criterion.name}
                  </Text>
                </Box>
              </Group>
              
              <Box style={{ 
                backgroundColor: '#f8f9fa', 
                padding: '16px', 
                borderRadius: '8px', 
                border: '1px solid #e9ecef'
              }}>
                <Text size="sm" fw={500} c="#495057" mb="xs">Detailed Feedback:</Text>
                <Text size="sm" style={{ lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                  {criterion.explanation}
                </Text>
              </Box>
            </Paper>
          ))}
        </Stack>

        <Divider my="xl" />

        {/* 总体解释 */}
        <Title order={2} mb="lg" c="#2c3e50">Overall Assessment Summary</Title>
        <Paper 
          shadow="sm" 
          p="lg" 
          radius="md" 
          style={{ 
            backgroundColor: '#f8f9fa',
            border: '1px solid #e9ecef'
          }}
        >
          <Text size="sm" fw={500} c="#495057" mb="xs">Comprehensive Evaluation:</Text>
          <Text size="sm" style={{ lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
            {evaluationData.overallExplanation}
          </Text>
        </Paper>

      </Paper>
    </Box>
  );
};

export default EvaluationResult;
