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

describe('MarkdownToolbar — Link', () => {
  it('wraps selection as [sel](url) when user enters a URL', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    vi.spyOn(window, 'prompt').mockReturnValue('https://x.test');
    render(<Harness initial="click here" onChange={onChange} />);
    const ta = screen.getByTestId('ta') as HTMLTextAreaElement;
    setSelection(ta, 0, 5); // "click"

    await user.click(screen.getByRole('button', { name: /link/i }));

    expect(onChange).toHaveBeenCalledWith('[click](https://x.test) here');
  });

  it('inserts [link](url) when nothing is selected', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    vi.spyOn(window, 'prompt').mockReturnValue('https://y.test');
    render(<Harness initial="" onChange={onChange} />);
    const ta = screen.getByTestId('ta') as HTMLTextAreaElement;
    setSelection(ta, 0, 0);

    await user.click(screen.getByRole('button', { name: /link/i }));

    expect(onChange).toHaveBeenCalledWith('[link](https://y.test)');
  });

  it('does nothing when prompt is cancelled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    render(<Harness initial="x" onChange={onChange} />);
    const ta = screen.getByTestId('ta') as HTMLTextAreaElement;
    setSelection(ta, 0, 1);

    await user.click(screen.getByRole('button', { name: /link/i }));

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('MarkdownToolbar — List', () => {
  it('prepends "- " to every selected line', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={"apple\nbanana\ncherry"} onChange={onChange} />);
    const ta = screen.getByTestId('ta') as HTMLTextAreaElement;
    // select "apple\nbanana"
    setSelection(ta, 0, 12);

    await user.click(screen.getByRole('button', { name: /list/i }));

    expect(onChange).toHaveBeenCalledWith('- apple\n- banana\ncherry');
  });

  it('prepends "- " to current line when nothing selected', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={"one\ntwo\nthree"} onChange={onChange} />);
    const ta = screen.getByTestId('ta') as HTMLTextAreaElement;
    setSelection(ta, 5, 5); // inside "two"

    await user.click(screen.getByRole('button', { name: /list/i }));

    expect(onChange).toHaveBeenCalledWith('one\n- two\nthree');
  });
});

describe('MarkdownToolbar — Heading', () => {
  it('prepends "# " to the current line', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={"one\ntwo\nthree"} onChange={onChange} />);
    const ta = screen.getByTestId('ta') as HTMLTextAreaElement;
    setSelection(ta, 5, 5); // inside "two"

    await user.click(screen.getByRole('button', { name: /heading/i }));

    expect(onChange).toHaveBeenCalledWith('one\n# two\nthree');
  });
});
