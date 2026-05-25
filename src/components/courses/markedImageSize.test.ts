import { describe, it, expect, beforeAll } from 'vitest';
import { marked } from 'marked';
import { imageSizeExtension } from './markedImageSize';

beforeAll(() => {
  marked.use(imageSizeExtension);
});

function render(src: string): string {
  return (marked.parse(src, { async: false }) as string).trim();
}

describe('imageSizeExtension', () => {
  it('renders ![pic|400](url) with width=400', () => {
    const out = render('![pic|400](https://cdn/x.png)');
    expect(out).toContain('<img');
    expect(out).toContain('src="https://cdn/x.png"');
    expect(out).toContain('alt="pic"');
    expect(out).toContain('width="400"');
  });

  it('renders ![pic](url) without width', () => {
    const out = render('![pic](https://cdn/x.png)');
    expect(out).toContain('<img');
    expect(out).toContain('alt="pic"');
    expect(out).not.toContain('width="');
  });

  it('treats |abc as part of alt when not numeric', () => {
    const out = render('![pic|abc](https://cdn/x.png)');
    expect(out).toContain('alt="pic|abc"');
    expect(out).not.toContain('width="');
  });

  it('handles empty alt with size', () => {
    const out = render('![|400](https://cdn/x.png)');
    expect(out).toContain('alt=""');
    expect(out).toContain('width="400"');
  });

  it('handles dimension at end of compound alt with spaces', () => {
    // "My nice photo|600" → alt "My nice photo", width 600
    const out = render('![My nice photo|600](https://cdn/x.png)');
    expect(out).toContain('alt="My nice photo"');
    expect(out).toContain('width="600"');
  });
});
