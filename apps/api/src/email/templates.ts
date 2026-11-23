import {
  formatDate,
  formatDateRange,
  formatHours,
  formatShift,
  type ShiftSummary,
} from './format.js';

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
  /** Linhas de lista já formatadas, exibidas após os plantões. */
  lines?: string[];
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

  if (content.lines && content.lines.length > 0) {
    htmlParts.push(
      `<ul style="margin:0 0 16px;padding-left:20px;">${content.lines
        .map((i) => `<li style="margin:0 0 8px;">${escapeHtml(i)}</li>`)
        .join('')}</ul>`,
    );
    textParts.push(content.lines.map((i) => `- ${i}`).join('\n'));
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

/** Plantão em e-mail de evento; sem horário definido, mostra só a data e as horas. */
export interface EventShift {
  date: string;
  startsAt: Date | null;
  endsAt: Date | null;
  hours: number;
}

export function formatEventShift(shift: EventShift): string {
  if (shift.startsAt && shift.endsAt) {
    return formatShift({ ...shift, startsAt: shift.startsAt, endsAt: shift.endsAt });
  }
  return `${formatDate(shift.date)}, ${formatHours(shift.hours)}`;
}

export interface SchedulePublishedEmailInput {
  startDate: string;
  endDate: string;
  shifts: EventShift[];
  appUrl?: string | undefined;
}

/** Escala publicada: os plantões do membro no período (Req. 12.1). */
export function renderSchedulePublishedEmail(input: SchedulePublishedEmailInput): RenderedEmail {
  const period = formatDateRange(input.startDate, input.endDate);
  return renderEmail({
    subject: `Escala publicada: ${period}`,
    paragraphs: [`A escala de ${period} foi publicada. Seus plantões no período:`],
    lines: input.shifts.map(formatEventShift),
    ...(input.appUrl ? { action: { label: 'Abrir minha escala', url: input.appUrl } } : {}),
  });
}

export type ShiftChangeKind = 'lost' | 'received' | 'updated';

export interface ShiftChangedEmailInput {
  kind: ShiftChangeKind;
  shift: EventShift;
  /** Horas antes da alteração (apenas para `updated`). */
  previousHours?: number | null | undefined;
  reason: string | null;
  appUrl?: string | undefined;
}

/** Alteração de plantão em escala publicada, com o motivo (Req. 12.2). */
export function renderShiftChangedEmail(input: ShiftChangedEmailInput): RenderedEmail {
  const day = formatDate(input.shift.date);
  const short = formatDateRange(input.shift.date, input.shift.date);
  const recalculated =
    input.previousHours != null
      ? `As horas do seu plantão de ${day} foram recalculadas (de ${formatHours(input.previousHours)} para ${formatHours(input.shift.hours)}).`
      : `As horas do seu plantão de ${day} foram recalculadas.`;
  const intro = {
    lost: `Você deixou de ser responsável pelo plantão de ${day}.`,
    received: `Você passou a ser responsável pelo plantão de ${day}.`,
    updated: recalculated,
  }[input.kind];
  const subject = {
    lost: `Plantão removido: ${short}`,
    received: `Novo plantão: ${short}`,
    updated: `Plantão atualizado: ${short}`,
  }[input.kind];
  const paragraphs = [intro];
  if (input.reason) paragraphs.push(`Motivo: ${input.reason}`);
  return renderEmail({
    subject,
    paragraphs,
    lines: [formatEventShift(input.shift)],
    ...(input.appUrl ? { action: { label: 'Abrir minha escala', url: input.appUrl } } : {}),
  });
}

export type SwapEmailEvent =
  'requested' | 'accepted' | 'declined' | 'cancelled' | 'approved' | 'rejected';
export type SwapEmailAudience = 'requester' | 'counterpart' | 'manager';

export interface SwapEmailInput {
  event: SwapEmailEvent;
  audience: SwapEmailAudience;
  swapKind: 'swap' | 'cession';
  requesterName: string;
  counterpartName: string;
  /** Plantão do solicitante. */
  requesterShift: EventShift;
  /** Plantão do colega (só em permuta). */
  counterpartShift: EventShift | null;
  /** Motivo da rejeição pelo gestor (só usado em `rejected`). */
  reason?: string | null | undefined;
  appUrl?: string | undefined;
  actionLabel?: string | undefined;
}

/** Linhas dos plantões sob a ótica de quem lê. */
function swapLines(input: SwapEmailInput): string[] {
  const mine = formatEventShift(input.requesterShift);
  const theirs = input.counterpartShift ? formatEventShift(input.counterpartShift) : null;
  if (input.audience === 'requester') {
    return [`Você entrega: ${mine}`, ...(theirs ? [`Você assume: ${theirs}`] : [])];
  }
  if (input.audience === 'counterpart') {
    return [`Você assume: ${mine}`, ...(theirs ? [`Você entrega: ${theirs}`] : [])];
  }
  return [
    `${input.requesterName} entrega: ${mine}`,
    ...(theirs ? [`${input.counterpartName} entrega: ${theirs}`] : []),
  ];
}

/**
 * Eventos de troca de plantão (Req. 12.3 e 12.8): solicitação, aceite, recusa, cancelamento,
 * aprovação e rejeição. Mostra data, período e horas dos plantões; nunca cita exceções do colega.
 */
export function renderSwapEmail(input: SwapEmailInput): RenderedEmail {
  const noun = input.swapKind === 'swap' ? 'troca' : 'cessão';
  const Noun = `${noun[0]!.toUpperCase()}${noun.slice(1)}`;
  const date = formatDateRange(input.requesterShift.date, input.requesterShift.date);
  const { requesterName: req, counterpartName: other } = input;
  const paragraphs: string[] = [];
  let subject: string;

  switch (input.event) {
    case 'requested':
      subject = `Pedido de ${noun} de plantão: ${date}`;
      paragraphs.push(
        input.swapKind === 'swap'
          ? `${req} pediu uma permuta de plantão com você. Responda ao pedido no Plantão360.`
          : `${req} pediu que você assuma um plantão (cessão). Responda ao pedido no Plantão360.`,
      );
      break;
    case 'accepted':
      if (input.audience === 'manager') {
        subject = `Troca aguardando aprovação: ${date}`;
        paragraphs.push(
          `Há uma ${noun} de plantão aguardando aprovação: ${other} aceitou o pedido de ${req}.`,
        );
      } else {
        subject = `Pedido de ${noun} aceito: ${date}`;
        paragraphs.push(
          `${other} aceitou o seu pedido de ${noun}. Agora ele aguarda a aprovação do gestor.`,
        );
      }
      break;
    case 'declined':
      subject = `Pedido de ${noun} recusado: ${date}`;
      paragraphs.push(`${other} recusou o seu pedido de ${noun}. A escala não foi alterada.`);
      break;
    case 'cancelled':
      subject = `Pedido de ${noun} cancelado: ${date}`;
      paragraphs.push(`${req} cancelou o pedido de ${noun} de plantão feito a você.`);
      break;
    case 'approved':
      subject = `${Noun} aprovada: ${date}`;
      paragraphs.push(`O gestor aprovou a ${noun} de plantão. A escala já foi atualizada.`);
      break;
    case 'rejected':
      subject = `${Noun} rejeitada: ${date}`;
      paragraphs.push(`O gestor rejeitou a ${noun} de plantão. A escala não foi alterada.`);
      if (input.reason) paragraphs.push(`Motivo: ${input.reason}`);
      break;
  }

  return renderEmail({
    subject,
    paragraphs,
    lines: swapLines(input),
    ...(input.appUrl
      ? { action: { label: input.actionLabel ?? 'Abrir minha escala', url: input.appUrl } }
      : {}),
  });
}
