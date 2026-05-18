import { Box } from '@mantine/core';

interface WarmDividerProps {
  /** Vertical margin in px or Mantine spacing. */
  my?: number | string;
}

/**
 * 1px Border Cream horizontal rule — the warm-tone divider used between
 * editorial sections and list rows.
 */
export default function WarmDivider({ my = 0 }: WarmDividerProps) {
  return <Box style={{ height: 1, background: 'var(--claude-border-cream)', margin: `${typeof my === 'number' ? `${my}px` : my} 0` }} />;
}
