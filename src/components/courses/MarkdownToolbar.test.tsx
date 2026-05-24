import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { MarkdownToolbar } from './MarkdownToolbar';
import { MantineTestWrapper } from '../../test-utils/renderWithMantine';

function Harness({
  initial,
  onChange,
}: {
  initial: string;
  onChange: (next: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <MantineTestWrapper>
      <div>
        <MarkdownToolbar textareaRef={ref} value={initial} onChange={onChange} />
        <textarea ref={ref} defaultValue={initial} data-testid="ta" />
      </div>
    </MantineTestWrapper>
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
    setSelection(ta, 0, 5);
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

describe('MarkdownToolbar — Italic', () => {
  it('wraps selected text with *...*', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial="hello world" onChange={onChange} />);
    const ta = screen.getByTestId('ta') as HTMLTextAreaElement;
    setSelection(ta, 6, 11); // "world"

    await user.click(screen.getByRole('button', { name: /italic/i }));

    expect(onChange).toHaveBeenCalledWith('hello *world*');
  });
});

describe('MarkdownToolbar — Highlight', () => {
  it('wraps selected text with ==...==', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial="hello world" onChange={onChange} />);
    const ta = screen.getByTestId('ta') as HTMLTextAreaElement;
    setSelection(ta, 0, 5); // "hello"

    await user.click(screen.getByRole('button', { name: /highlight/i }));

    expect(onChange).toHaveBeenCalledWith('==hello== world');
  });
});
