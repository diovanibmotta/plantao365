/*
 * Lint de estilo dos plugins: garante que o CSS do plugin só consome a identidade visual do host.
 * Usado pela CLI no build/pack (grava `styleCheck: "passed"` no manifesto) e pelo kernel no install.
 * shortcut: parser por chaves, sem tratar `{`/`}`/`;` dentro de strings; troque por postcss se
 * algum plugin real precisar disso.
 */

export interface StyleViolation {
  file: string;
  line: number;
  message: string;
}

const RAW_COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
const REMOTE_URL = /url\(\s*['"]?\s*(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const KEYFRAMES = /^@(?:-[a-z]+-)?keyframes\b/i;

/** Separa a lista de seletores nas vírgulas de topo (ignora as de `:is(a, b)`). */
function splitSelectors(prelude: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < prelude.length; i++) {
    const ch = prelude[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(prelude.slice(start, i));
      start = i + 1;
    }
  }
  out.push(prelude.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * Regras: seletor começa por classe (CSS Modules ou prefixo `.plg-<id>`) ou `&`; sem `!important`;
 * sem `@import`, `@font-face` nem `url()` remoto; cores só via `var(--…)` dos tokens; propriedades
 * customizadas próprias só com prefixo `--plg-` (nunca redefinir tokens do host).
 */
export function checkPluginStyles(css: string, file = 'style.css'): StyleViolation[] {
  // Comentários viram espaços para manter o número das linhas.
  const src = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const violations: StyleViolation[] = [];
  const stack: Array<'rule' | 'at' | 'keyframes' | 'frame'> = [];
  let segStart = 0;

  const lineAt = (index: number) => src.slice(0, index).split('\n').length;
  const report = (index: number, message: string) =>
    violations.push({ file, line: lineAt(index), message });

  const declaration = (text: string, index: number) => {
    const colon = text.indexOf(':');
    if (colon < 0) return;
    const prop = text.slice(0, colon).trim();
    const value = text.slice(colon + 1);
    if (prop.startsWith('--') && !prop.startsWith('--plg-')) {
      report(index, `Propriedade "${prop}" redefine token do host; use o prefixo --plg-.`);
    }
    if (/!\s*important/i.test(value)) report(index, `"!important" não é permitido (${prop}).`);
    if (RAW_COLOR.test(value)) {
      report(index, `Cor fixa em "${prop}"; use os tokens semânticos (var(--…)).`);
    }
    if (REMOTE_URL.test(value)) report(index, `url() remoto em "${prop}" não é permitido.`);
  };

  const atStatement = (text: string, index: number) => {
    if (/^@import\b/i.test(text)) report(index, '"@import" não é permitido; empacote o CSS.');
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch !== '{' && ch !== '}' && ch !== ';') continue;
    const raw = src.slice(segStart, i);
    const text = raw.trim();
    const at = segStart + raw.length - raw.trimStart().length;
    const top = stack[stack.length - 1];

    if (ch === '{') {
      if (text.startsWith('@')) {
        if (/^@font-face\b/i.test(text))
          report(at, '"@font-face" não é permitido; use a fonte do host.');
        stack.push(KEYFRAMES.test(text) ? 'keyframes' : 'at');
      } else if (top === 'keyframes') {
        stack.push('frame');
      } else {
        for (const sel of splitSelectors(text)) {
          if (!sel.startsWith('.') && !sel.startsWith('&')) {
            report(at, `Seletor global "${sel}"; comece por uma classe do plugin (.plg-<id>).`);
          }
        }
        stack.push('rule');
      }
    } else if (text) {
      if (top === 'rule' || top === 'frame') declaration(text, at);
      else if (text.startsWith('@')) atStatement(text, at);
    }
    if (ch === '}') stack.pop();
    segStart = i + 1;
  }
  return violations;
}
