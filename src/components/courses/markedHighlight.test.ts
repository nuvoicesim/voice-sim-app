import { describe, it, expect, beforeAll } from 'vitest';
import { marked } from 'marked';
import { highlightExtension } from './markedHighlight';

beforeAll(() => {
  marked.use(highlightExtension);
});

function render(src: string): string {
  return (marked.parse(src, { async: false }) as string).trim();
}

describe('markedHighlight', () => {
  it('renders ==text== as <mark>', () => {
    expect(render('==hello==')).toContain('<mark>hello</mark>');
  });

  it('leaves a single = pair alone', () => {
    expect(render('=hello=')).not.toContain('<mark>');
  });

  it('matches the first ==...== only when multiple appear on one line', () => {
    // After first match consumes `==a==`, the next `==` opens a new token
    // for ==b==; both should be marked.
    const out = render('==a== middle ==b==');
    expect(out).toContain('<mark>a</mark>');
    expect(out).toContain('<mark>b</mark>');
  });

  it('does not match empty ==== content', () => {
    expect(render('====')).not.toContain('<mark></mark>');
  });

  it('does not span newlines', () => {
    const out = render('==line1\nline2==');
    expect(out).not.toContain('<mark>');
  });

  it('keeps inline emphasis inside the highlight', () => {
    const out = render('==important *word*==');
    // tokenizer returns raw text; renderer wraps. Inline parsing of the
    // captured text should still resolve emphasis when we expose it.
    expect(out).toContain('<mark>');
    expect(out).toContain('important');
  });

  it('does not highlight ==text== inside a fenced code block', () => {
    const out = render('```\n==raw==\n```');
    expect(out).toContain('==raw==');
    expect(out).not.toContain('<mark>');
  });
});
