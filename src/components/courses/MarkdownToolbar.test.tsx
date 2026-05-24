import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { MantineProvider } from '@mantine/core';
import { MarkdownToolbar } from './MarkdownToolbar';

beforeAll(() => {
  if (typeof window !== 'undefined' && !window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});

function Harness({
  initial,
  onChange,
}: {
  initial: string;
  onChange: (next: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <MantineProvider>
      <div>
        <MarkdownToolbar textareaRef={ref} value={initial} onChange={onChange} />
        <textarea ref={ref} defaultValue={initial} data-testid="ta" />
      </div>
    </MantineProvider>
  );
}

function setSelection(ta: HTMLTextAreaElement, start: number, end: number) {
  ta.focus();
  ta.setSelectionRange(start, end);
}

describe('MarkdownToolbar — Bold', () => {
  it('wraps selected text with **...**', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial="hello world" onChange={onChange} />);
    const ta = screen.getByTestId('ta') as HTMLTextAreaElement;
    setSelection(ta, 0, 5); // "hello"

    await user.click(screen.getByRole('button', { name: /bold/i }));

    expect(onChange).toHaveBeenCalledWith('**hello** world');
  });

  it('inserts **bold** placeholder when no selection', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial="" onChange={onChange} />);
    const ta = screen.getByTestId('ta') as HTMLTextAreaElement;
    setSelection(ta, 0, 0);

    await user.click(screen.getByRole('button', { name: /bold/i }));

    expect(onChange).toHaveBeenCalledWith('**bold**');
  });
});
