import React from 'react';
import { Box, Text } from '@mantine/core';

interface StepItemProps {
  step: {
    name: string;
    path: string;
  };
  stepNumber: number;
  isCompleted: boolean;
  isClickable: boolean;
  isActive: boolean;
  isSelected: boolean;
  onClick: () => void;
}

const StepItem: React.FC<StepItemProps> = ({
  step,
  stepNumber,
  isCompleted,
  isClickable,
  isActive,
  isSelected,
  onClick
}) => {
  let backgroundColor = 'transparent';
  let color = '#4d4c48';
  let fontWeight = 400;
  let opacity = 1;
  let cursor = 'pointer';

  if (isActive) {
    backgroundColor = '#4f46e5'; // Blue for current step
    color = 'white';
    fontWeight = 600;
  } else if (isSelected) {
    backgroundColor = '#059669'; // Dark green for selected step
    color = 'white';
    fontWeight = 700;
  } else if (isCompleted) {
    backgroundColor = '#10b981'; // Light green for completed steps
    color = 'white';
  } else if (!isClickable) {
    color = 'gray';
    cursor = 'not-allowed';
    opacity = 0.5;
  }

  return (
    <Box
      style={{
        padding: '10px',
        borderRadius: '5px',
        backgroundColor,
        color,
        fontWeight,
        opacity,
        cursor,
        transition: 'all 0.2s ease'
      }}
      onClick={onClick}
    >
      <Text
        size="sm"
        style={{
          color: 'inherit',
          fontWeight: 'inherit'
        }}
      >
        {stepNumber === 8 ? "Completion" : `Step ${stepNumber}: ${step.name}`}
      </Text>
    </Box>
  );
};

export default StepItem; 