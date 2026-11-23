import { formatShift, type ShiftSummary } from './format.js';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export interface LayoutInput {
  title: string;
  /** Corpo já em HTML seguro (use escapeHtml nos textos dinâmicos). */
  bodyHtml: string;
  bodyText: string;
  footer?: string;
}

export const DEFAULT_FOOTER = 'Plantão360 · mensagem automática, não responda este e-mail.';

/** Layout base minimalista: fonte do sistema, poucos elementos. */
export function renderLayout(input: LayoutInput): { html: string; text: string } {
  const footer = input.footer ?? DEFAULT_FOOTER;
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
</head>
<body style="margin:0;padding:24px;background:#f6f7f8;color:#1c1f23;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e5e9;border-radius:8px;padding:24px;">
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#1c1f23;">${escapeHtml(input.title)}</h1>
${input.bodyHtml}
</div>
<p style="max-width:560px;margin:16px auto 0;font-size:12px;color:#6b7280;">${escapeHtml(footer)}</p>
</body>
</html>`;
  const text = `${input.title}\n\n${input.bodyText}\n\n--\n${footer}\n`;
  return { html, text };
}

export interface EmailContent {
  subject: string;
  heading?: string;
  paragraphs: string[];
  shifts?: ShiftSummary[];
  action?: { label: string; url: string };
}

/**
 * Monta um e-mail em pt-BR no layout base. Plantões listados saem com data, período e horas.
 * Templates de evento (escala publicada, troca, lembrete) devem apenas montar um EmailContent.
 */
export function renderEmail(content: EmailContent): RenderedEmail {
  const title = content.heading ?? content.subject;
  const htmlParts: string[] = [];
  const textParts: string[] = [];

  for (const p of content.paragraphs) {
    htmlParts.push(`<p style="margin:0 0 16px;">${escapeHtml(p)}</p>`);
    textParts.push(p);
  }

  if (content.shifts && content.shifts.length > 0) {
    const items = content.shifts.map((s) => formatShift(s));
    htmlParts.push(
      `<ul style="margin:0 0 16px;padding-left:20px;">${items
        .map((i) => `<li style="margin:0 0 8px;">${escapeHtml(i)}</li>`)
        .join('')}</ul>`,
    );
    textParts.push(items.map((i) => `- ${i}`).join('\n'));
  }

  if (content.action) {
    const { label, url } = content.action;
    htmlParts.push(
      `<p style="margin:0;"><a href="${escapeHtml(url)}" style="color:#2563eb;">${escapeHtml(label)}</a></p>`,
    );
    textParts.push(`${label}: ${url}`);
  }

  const { html, text } = renderLayout({
    title,
    bodyHtml: htmlParts.join('\n'),
    bodyText: textParts.join('\n\n'),
  });
  return { subject: content.subject, html, text };
}
