import type { MarkedExtension, TokenizerAndRendererExtension } from 'marked';

interface HighlightToken {
  type: 'highlight';
  raw: string;
  text: string;
  tokens: any[];
}

const highlight: TokenizerAndRendererExtension = {
  name: 'highlight',
  level: 'inline',
  start(src: string) {
    const idx = src.indexOf('==');
    return idx < 0 ? undefined : idx;
  },
  tokenizer(src: string) {
    const m = /^==([^=\n][^\n]*?)==/.exec(src);
    if (!m) return undefined;
    const text = m[1];
    const token: HighlightToken = {
      type: 'highlight',
      raw: m[0],
      text,
      tokens: [],
    };
    // @ts-expect-error — `this.lexer` is the runtime lexer marked supplies
    this.lexer.inline(text, token.tokens);
    return token;
  },
  renderer(token: any) {
    // @ts-expect-error — `this.parser` is the runtime parser marked supplies
    return `<mark>${this.parser.parseInline(token.tokens)}</mark>`;
  },
};

export const highlightExtension: MarkedExtension = {
  extensions: [highlight],
};
