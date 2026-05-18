import { createTheme, rem, type MantineColorsTuple } from '@mantine/core';

const terracotta: MantineColorsTuple = [
  '#fdf3ee', '#f8dccd', '#efb89e', '#e69570', '#df7a51',
  '#d97757', '#c96442', '#a8512f', '#88401f', '#6b3015',
];

const parchment: MantineColorsTuple = [
  '#faf9f5', '#f5f4ed', '#f0eee6', '#e8e6dc', '#d1cfc5',
  '#c2c0b6', '#b0aea5', '#87867f', '#5e5d59', '#4d4c48',
];

// No pure-black on purpose — even the darkest tone is dark-surface charcoal.
const ink: MantineColorsTuple = [
  '#f5f4ed', '#e8e6dc', '#b0aea5', '#87867f', '#5e5d59',
  '#4d4c48', '#3d3d3a', '#3d3d3a', '#30302e', '#30302e',
];

export const theme = createTheme({
  primaryColor: 'terracotta',
  primaryShade: { light: 6, dark: 5 },
  defaultRadius: 'md',
  white: '#faf9f5',
  black: '#5e5d59',
  colors: { terracotta, parchment, ink, gray: parchment },
  fontFamily: 'Georgia, "Times New Roman", system-ui, -apple-system, "Segoe UI", Arial, sans-serif',
  fontFamilyMonospace: 'ui-monospace, "JetBrains Mono", Menlo, monospace',
  headings: {
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontWeight: '500',
    sizes: {
      h1: { fontSize: rem(52), lineHeight: '1.20' },
      h2: { fontSize: rem(36), lineHeight: '1.30' },
      h3: { fontSize: rem(25), lineHeight: '1.20' },
      h4: { fontSize: rem(20.8), lineHeight: '1.20' },
      h5: { fontSize: rem(17), lineHeight: '1.30' },
      h6: { fontSize: rem(15), lineHeight: '1.30' },
    },
  },
  radius: {
    xs: rem(4),
    sm: rem(6),
    md: rem(8),
    lg: rem(12),
    xl: rem(16),
  },
  shadows: {
    xs: '0 0 0 1px #d1cfc5',
    sm: '0 0 0 1px #e8e6dc',
    md: 'rgba(0,0,0,0.05) 0 4px 24px',
    lg: 'rgba(0,0,0,0.08) 0 8px 32px',
    xl: 'rgba(0,0,0,0.10) 0 12px 40px',
  },
  components: {
    Button: { defaultProps: { radius: 'md' } },
    Paper: { defaultProps: { radius: 'lg', bg: 'parchment.0' } },
    Card: { defaultProps: { radius: 'lg', bg: 'parchment.0' } },
    TextInput: { defaultProps: { radius: 'lg' } },
    Textarea: { defaultProps: { radius: 'lg' } },
    Select: { defaultProps: { radius: 'lg' } },
    NumberInput: { defaultProps: { radius: 'lg' } },
    PasswordInput: { defaultProps: { radius: 'lg' } },
    MultiSelect: { defaultProps: { radius: 'lg' } },
    Title: { defaultProps: { fw: 500, c: 'ink.4' } },
    Badge: { defaultProps: { radius: 'xl', variant: 'light' } },
    ThemeIcon: { defaultProps: { variant: 'light', color: 'terracotta' } },
    Anchor: { defaultProps: { c: 'terracotta.6' } },
    Tabs: { defaultProps: { color: 'terracotta' } },
  },
});
