import { describe, expect, it } from 'vitest';
import { checkPluginStyles } from './style-check.js';

const messages = (css: string) => checkPluginStyles(css, 'contacts').map((v) => v.message);

describe('checkPluginStyles', () => {
  it('aceita CSS no escopo do plugin que só usa tokens', () => {
    const css = `
      /* contatos */
      .plg-contacts .card, .plg-contacts :is(h3, p) {
        color: var(--text);
        border: 1px solid var(--border);
        --plg-gap: var(--space);
        &:hover { background: var(--surface-2); }
        .btn { color: var(--accent); }
      }
      .plg-contacts.wide { padding: 0; }
      @media (max-width: 600px) { .plg-contacts { padding: 0; } }
      @keyframes plg-fade { from { opacity: 0; } to { opacity: 1; } }
      .plg-contacts .icon { fill: currentColor; background: transparent }
    `;
    expect(checkPluginStyles(css, 'contacts')).toEqual([]);
  });

  it.each([
    ['body { margin: 0; }', 'fora do escopo "body"'],
    [':root { color: red; }', 'fora do escopo ":root"'],
    ['.plg-contacts, h1 { margin: 0; }', 'fora do escopo "h1"'],
    ['* { box-sizing: border-box; }', 'fora do escopo "*"'],
    // classe do host ou de outro plugin: atingiria telas fora do plugin
    ['.btn { background: var(--danger); }', 'fora do escopo ".btn"'],
    ['.plg-contacts-x { margin: 0; }', 'fora do escopo ".plg-contacts-x"'],
    ['.plg-other .card { margin: 0; }', 'fora do escopo ".plg-other .card"'],
    ['& { color: var(--text); }', 'fora do escopo "&"'],
    ['@media print { .ui-table { display: none; } }', 'fora do escopo ".ui-table"'],
    ['.plg-contacts { color: var(--text) !important; }', '"!important"'],
    ['.plg-contacts { color: #fff; }', 'Cor fixa'],
    ['.plg-contacts { background: rgb(0 0 0 / 50%); }', 'Cor fixa'],
    ['.plg-contacts { border-color: oklch(0.5 0.1 200); }', 'Cor fixa'],
    ['.plg-contacts { --accent: red; }', 'redefine token'],
    ["@import url('https://fonts.googleapis.com/css2?family=Inter');", '"@import"'],
    ['@font-face { font-family: X; src: url(x.woff2); }', '"@font-face"'],
    ['.plg-contacts { background: url(https://cdn.example.com/x.png); }', 'url() remoto'],
  ])('recusa %s', (css, expected) => {
    expect(messages(css).some((m) => m.includes(expected))).toBe(true);
  });

  it('informa arquivo e linha da violação', () => {
    const css = '.plg-contacts {}\n/* x\n y */\nbody {}';
    expect(checkPluginStyles(css, 'contacts', 'web/a.css')).toEqual([
      expect.objectContaining({ file: 'web/a.css', line: 4 }),
    ]);
  });
});
