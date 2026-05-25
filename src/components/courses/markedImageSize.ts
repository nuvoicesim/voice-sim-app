import type { MarkedExtension, Tokens } from 'marked';

/**
 * marked extension: overrides the default image renderer to interpret an
 * optional `|WIDTH` suffix on the alt text as an HTML width attribute.
 *
 * - ![pic|400](url) → <img src="url" alt="pic" width="400" />
 * - ![pic](url)     → <img src="url" alt="pic" />
 * - ![pic|abc](url) → <img src="url" alt="pic|abc" />  (non-numeric: ignored)
 *
 * The storage format remains Markdown; only rendering is affected.
 */
export const imageSizeExtension: MarkedExtension = {
  renderer: {
    image(token: Tokens.Image): string {
      const { href, text } = token;
      const match = /^(.*)\|(\d+)$/.exec(text);
      if (match) {
        const alt = match[1];
        const width = match[2];
        return `<img src="${href}" alt="${alt}" width="${width}" />`;
      }
      return `<img src="${href}" alt="${text}" />`;
    },
  },
};
