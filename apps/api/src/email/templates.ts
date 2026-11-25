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

export type EmailTone = 'info' | 'success' | 'warning' | 'danger';

export interface LayoutInput {
  title: string;
  /** Corpo já em HTML seguro (use escapeHtml nos textos dinâmicos). */
  bodyHtml: string;
  bodyText: string;
  footer?: string;
  /** URL absoluta do logo (PNG). Sem ela, o cabeçalho usa só o nome do produto. */
  logoUrl?: string | undefined;
  /** Selo curto acima do título (ex.: "Aprovada"). */
  badge?: { label: string; tone: EmailTone } | undefined;
}

export const DEFAULT_FOOTER = 'Plantão365 · mensagem automática, não responda este e-mail.';

/** Paleta do app (neutros frios + azul de destaque), em hex para compatibilidade com clientes de e-mail. */
const THEME = {
  bg: '#f6f7f9',
  card: '#ffffff',
  border: '#e5e7eb',
  text: '#16181d',
  muted: '#6b7280',
  accent: '#2f5bd6',
  panel: '#f3f4f6',
  buttonBg: '#16181d',
  buttonText: '#ffffff',
  tones: {
    info: { fg: '#2f5bd6', bg: '#eaf0ff' },
    success: { fg: '#1d7a45', bg: '#e6f6ec' },
    warning: { fg: '#9a6400', bg: '#fdf3dc' },
    danger: { fg: '#b42318', bg: '#fdecea' },
  },
} as const;

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Tema escuro para clientes que respeitam prefers-color-scheme (os demais ficam no claro). */
const DARK_CSS = `
:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme: dark){
  .p365-bg{background:#0f1115 !important}
  .p365-card{background:#171a20 !important;border-color:#2a2f38 !important}
  .p365-text{color:#f3f4f6 !important}
  .p365-muted{color:#9aa3b2 !important}
  .p365-panel{background:#1f232b !important}
  .p365-btn{background:#f3f4f6 !important;color:#16181d !important}
  .p365-link{color:#8fb0ff !important}
}`;

/** Layout base minimalista: cabeçalho com logo, cartão central, botão de ação e rodapé. */
export function renderLayout(input: LayoutInput): { html: string; text: string } {
  const footer = input.footer ?? DEFAULT_FOOTER;
  const logo = input.logoUrl
    ? `<img src="${escapeHtml(input.logoUrl)}" width="28" height="28" alt="" style="display:block;border:0;border-radius:7px;">`
    : '';
  const badge = input.badge
    ? `<p style="margin:0 0 12px;"><span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${THEME.tones[input.badge.tone].bg};color:${THEME.tones[input.badge.tone].fg};font-size:12px;font-weight:600;letter-spacing:0.02em;">${escapeHtml(input.badge.label)}</span></p>`
    : '';
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(input.title)}</title>
<style>${DARK_CSS}</style>
</head>
<body class="p365-bg" style="margin:0;padding:0;background:${THEME.bg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="p365-bg" style="background:${THEME.bg};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr><td style="padding:0 4px 16px;font-family:${FONT};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
${logo ? `<td style="padding-right:10px;vertical-align:middle;">${logo}</td>` : ''}
<td class="p365-text" style="vertical-align:middle;font-family:${FONT};font-size:16px;font-weight:600;letter-spacing:-0.01em;color:${THEME.text};">Plantão365</td>
</tr></table>
</td></tr>
<tr><td class="p365-card" style="background:${THEME.card};border:1px solid ${THEME.border};border-radius:12px;padding:28px;font-family:${FONT};font-size:15px;line-height:1.6;color:${THEME.text};">
${badge}
<h1 class="p365-text" style="margin:0 0 16px;font-size:20px;line-height:1.3;font-weight:600;letter-spacing:-0.01em;color:${THEME.text};">${escapeHtml(input.title)}</h1>
${input.bodyHtml}
</td></tr>
<tr><td class="p365-muted" style="padding:16px 4px 0;font-family:${FONT};font-size:12px;line-height:1.5;color:${THEME.muted};">${escapeHtml(footer)}</td></tr>
</table>
</td></tr>
</table>
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
  badge?: { label: string; tone: EmailTone };
}

const listHtml = (items: string[]): string =>
  `<div class="p365-panel" style="margin:0 0 20px;padding:12px 16px;background:${THEME.panel};border-radius:8px;">${items
    .map(
      (i, idx) =>
        `<p class="p365-text" style="margin:0;padding:${idx === 0 ? '0' : '8px'} 0 0;font-size:14px;line-height:1.5;color:${THEME.text};">${escapeHtml(i)}</p>`,
    )
    .join('')}</div>`;

const originOf = (url: string | undefined): string | undefined => {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
};

/**
 * Monta um e-mail em pt-BR no layout base. Plantões listados saem com data, período e horas.
 * O logo vem do mesmo host do link de ação (`/icon-192.png`, servido pelo web).
 */
export function renderEmail(content: EmailContent): RenderedEmail {
  const title = content.heading ?? content.subject;
  const htmlParts: string[] = [];
  const textParts: string[] = [];

  for (const p of content.paragraphs) {
    htmlParts.push(
      `<p class="p365-text" style="margin:0 0 16px;color:${THEME.text};">${escapeHtml(p)}</p>`,
    );
    textParts.push(p);
  }

  if (content.shifts && content.shifts.length > 0) {
    const items = content.shifts.map((s) => formatShift(s));
    htmlParts.push(listHtml(items));
    textParts.push(items.map((i) => `- ${i}`).join('\n'));
  }

  if (content.lines && content.lines.length > 0) {
    htmlParts.push(listHtml(content.lines));
    textParts.push(content.lines.map((i) => `- ${i}`).join('\n'));
  }

  if (content.action) {
    const { label, url } = content.action;
    htmlParts.push(
      `<p style="margin:8px 0 0;"><a href="${escapeHtml(url)}" class="p365-btn" style="display:inline-block;padding:10px 20px;border-radius:8px;background:${THEME.buttonBg};color:${THEME.buttonText};font-size:14px;font-weight:600;text-decoration:none;">${escapeHtml(label)}</a></p>`,
    );
    textParts.push(`${label}: ${url}`);
  }

  const origin = originOf(content.action?.url);
  const { html, text } = renderLayout({
    title,
    bodyHtml: htmlParts.join('\n'),
    bodyText: textParts.join('\n\n'),
    logoUrl: origin ? `${origin}/icon-192.png` : undefined,
    badge: content.badge,
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
    badge: { label: 'Escala publicada', tone: 'success' },
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
  const badge: EmailContent['badge'] = {
    lost: { label: 'Plantão removido', tone: 'warning' as const },
    received: { label: 'Novo plantão', tone: 'info' as const },
    updated: { label: 'Plantão atualizado', tone: 'info' as const },
  }[input.kind];
  return renderEmail({
    subject,
    badge,
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
          ? `${req} pediu uma permuta de plantão com você. Responda ao pedido no Plantão365.`
          : `${req} pediu que você assuma um plantão (cessão). Responda ao pedido no Plantão365.`,
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

  const badge: EmailContent['badge'] = {
    requested: { label: 'Ação necessária', tone: 'warning' as const },
    accepted:
      input.audience === 'manager'
        ? { label: 'Aprovação pendente', tone: 'warning' as const }
        : { label: 'Pedido aceito', tone: 'info' as const },
    declined: { label: 'Pedido recusado', tone: 'danger' as const },
    cancelled: { label: 'Pedido cancelado', tone: 'warning' as const },
    approved: { label: 'Aprovada', tone: 'success' as const },
    rejected: { label: 'Rejeitada', tone: 'danger' as const },
  }[input.event];
  return renderEmail({
    subject,
    badge,
    paragraphs,
    lines: swapLines(input),
    ...(input.appUrl
      ? { action: { label: input.actionLabel ?? 'Abrir minha escala', url: input.appUrl } }
      : {}),
  });
}

export interface UnavailabilityConflictEmailInput {
  memberName: string;
  startDate: string;
  endDate: string;
  /** Datas (AAAA-MM-DD) com plantão publicado em conflito. */
  dates: string[];
  appUrl?: string | undefined;
}

/**
 * Aviso ao gestor: exceção de membro sobre dia com plantão publicado (Req. 5.6). Traz só membro,
 * período e datas em conflito; nunca o tipo nem a observação da exceção.
 */
export function renderUnavailabilityConflictEmail(
  input: UnavailabilityConflictEmailInput,
): RenderedEmail {
  const period = formatDateRange(input.startDate, input.endDate);
  return renderEmail({
    subject: `Exceção conflita com plantão publicado: ${input.memberName}`,
    badge: { label: 'Atenção', tone: 'warning' },
    paragraphs: [
      `${input.memberName} registrou uma exceção de disponibilidade (${period}) que conflita com plantões já publicados. Ajuste a escala, se necessário.`,
      'Datas em conflito:',
    ],
    lines: input.dates.map(formatDate),
    ...(input.appUrl ? { action: { label: 'Abrir o Plantão365', url: input.appUrl } } : {}),
  });
}

export interface InviteEmailInput {
  name: string;
  appUrl?: string | undefined;
}

/** Convite enviado quando o gestor cadastra o usuário: avisa do acesso e leva ao login SSO. */
export function renderInviteEmail(input: InviteEmailInput): RenderedEmail {
  return renderEmail({
    subject: 'Você foi convidado para o Plantão365',
    badge: { label: 'Convite', tone: 'info' },
    paragraphs: [
      `Olá, ${input.name}. Você foi convidado para o Plantão365.`,
      'Entre com sua conta corporativa (Microsoft) para acessar a escala de plantão.',
    ],
    ...(input.appUrl ? { action: { label: 'Entrar no Plantão365', url: input.appUrl } } : {}),
  });
}
