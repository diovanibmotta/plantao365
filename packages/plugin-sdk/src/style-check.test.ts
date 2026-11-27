import { describe, expect, it } from 'vitest';
import { checkPluginStyles } from './style-check.js';

const messages = (css: string) => checkPluginStyles(css).map((v) => v.message);

describe('checkPluginStyles', () => {
  it('aceita CSS escopado que só usa tokens', () => {
    const css = `
      /* contatos */
      .plg-contacts .card, .plg-contacts :is(h3, p) {
        color: var(--text);
        border: 1px solid var(--border);
        --plg-gap: var(--space);
        &:hover { background: var(--surface-2); }
      }
      @media (max-width: 600px) { .plg-contacts { padding: 0; } }
      @keyframes plg-fade { from { opacity: 0; } to { opacity: 1; } }
      .plg-contacts .icon { fill: currentColor; background: transparent }
    `;
    expect(checkPluginStyles(css)).toEqual([]);
  });

  it.each([
    ['body { margin: 0; }', 'Seletor global "body"'],
    [':root { color: red; }', 'Seletor global ":root"'],
    ['.plg-a, h1 { margin: 0; }', 'Seletor global "h1"'],
    ['* { box-sizing: border-box; }', 'Seletor global "*"'],
    ['.plg-a { color: var(--text) !important; }', '"!important"'],
    ['.plg-a { color: #fff; }', 'Cor fixa'],
    ['.plg-a { background: rgb(0 0 0 / 50%); }', 'Cor fixa'],
    ['.plg-a { border-color: oklch(0.5 0.1 200); }', 'Cor fixa'],
    ['.plg-a { --accent: red; }', 'redefine token'],
    ["@import url('https://fonts.googleapis.com/css2?family=Inter');", '"@import"'],
    ['@font-face { font-family: X; src: url(x.woff2); }', '"@font-face"'],
    ['.plg-a { background: url(https://cdn.example.com/x.png); }', 'url() remoto'],
  ])('recusa %s', (css, expected) => {
    expect(messages(css).some((m) => m.includes(expected))).toBe(true);
  });

  it('informa arquivo e linha da violação', () => {
    expect(checkPluginStyles('.plg-a {}\n/* x\n y */\nbody {}', 'web/a.css')).toEqual([
      expect.objectContaining({ file: 'web/a.css', line: 4 }),
    ]);
  });
});
