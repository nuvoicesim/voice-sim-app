import type { ReactNode } from 'react';
import { MantineProvider } from '@mantine/core';

export function MantineTestWrapper({ children }: { children: ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}
