import { TIME_ZONE } from '@plantao365/shared';
import type { jsPDF } from 'jspdf';
import { formatHours, formatPeriod } from '../schedule/format';
import {
  SCHEDULE_STATUS_LABEL,
  coverage,
  dayLabel,
  memberLabel,
  memberTotals,
  reportFileName,
} from './schedule-report';
import type { ReportContext } from './schedule-report';
import { formatDate } from './types';
import type { ScheduleDetail } from './types';

type Rgb = [number, number, number];

const INK: Rgb = [28, 29, 33];
const MUTED: Rgb = [110, 113, 122];
const RULE: Rgb = [222, 224, 228];
const WEEKEND: Rgb = [243, 244, 246];
const HOLIDAY: Rgb = [252, 244, 224];
const DANGER: Rgb = [180, 35, 24];
const MARGIN = 14;

const formatDateTime = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIME_ZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));

/** Ícone do app (mesma geometria de public/favicon.svg, grade 32×32) desenhado em vetor. */
function drawIcon(doc: jsPDF, x: number, y: number, size: number) {
  const u = size / 32;
  doc.setFillColor(17, 17, 19);
  doc.roundedRect(x, y, size, size, 7 * u, 7 * u, 'F');
  doc.setDrawColor(245, 246, 247);
  doc.setLineWidth(3.4 * u);
  doc.line(x + 8.8 * u, y + 5.1 * u, x + 8.8 * u, y + 27 * u);
  doc.circle(x + 16 * u, y + 14 * u, 7.2 * u, 'S');
  doc.setLineWidth(1.2 * u);
  doc.setLineCap('round');
  doc.line(x + 16 * u, y + 14 * u, x + 13.7 * u, y + 12.7 * u);
  doc.line(x + 16 * u, y + 14 * u, x + 19.4 * u, y + 12 * u);
  doc.setLineCap('butt');
  doc.setFillColor(245, 246, 247);
  doc.circle(x + 16 * u, y + 14 * u, 1.2 * u, 'F');
}

const lastY = (doc: jsPDF) =>
  (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

/** Monta o relatório A4 da escala: cabeçalho, plantões e totalização por membro. */
export async function buildSchedulePdf(
  schedule: ScheduleDetail,
  ctx: ReportContext,
  now: Date = new Date(),
): Promise<jsPDF> {
  // Carregado sob demanda: o jsPDF só baixa quando alguém gera o relatório.
  const [{ jsPDF: JsPdf }, { autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new JsPdf({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const period = `${formatDate(schedule.startDate)} a ${formatDate(schedule.endDate)}`;

  // Cabeçalho
  drawIcon(doc, MARGIN, 12, 13);
  doc.setTextColor(...MUTED);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('PLANTÃO365', MARGIN + 17, 16.5);
  doc.setTextColor(...INK);
  doc.setFontSize(16);
  doc.text('Escala de plantão', MARGIN + 17, 23);
  doc.setFontSize(9);
  doc.text(SCHEDULE_STATUS_LABEL[schedule.status], pageW - MARGIN, 16.5, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...MUTED);
  const statusDetail = schedule.publishedAt
    ? `em ${formatDateTime(schedule.publishedAt)}`
    : schedule.createdAt
      ? `gerado em ${formatDateTime(schedule.createdAt)}`
      : '';
  if (statusDetail) doc.text(statusDetail, pageW - MARGIN, 21, { align: 'right' });
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, 29, pageW - MARGIN, 29);

  // Dados da geração
  const cov = coverage(schedule.shifts);
  const meta: Array<[string, string]> = [
    ['EQUIPE', ctx.teamName || '—'],
    ['PERÍODO', period],
    ['GESTOR', ctx.managerName || '—'],
    ['COBERTURA', `${cov.covered}/${cov.total} dias`],
  ];
  const cellW = (pageW - 2 * MARGIN) / meta.length;
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.3);
  doc.roundedRect(MARGIN, 34, pageW - 2 * MARGIN, 14, 1.5, 1.5, 'S');
  meta.forEach(([label, value], i) => {
    const x = MARGIN + i * cellW;
    if (i > 0) doc.line(x, 34, x, 48);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(label, x + 3, 39);
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    const [first = ''] = doc.splitTextToSize(value, cellW - 6) as string[];
    doc.text(first, x + 3, 44.5);
  });

  const sectionTitle = (title: string, y: number) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(title, MARGIN, y);
  };
  const tableStyle = {
    theme: 'plain' as const,
    margin: { left: MARGIN, right: MARGIN, top: 16, bottom: 16 },
    styles: { fontSize: 8.5, cellPadding: 1.6, textColor: INK, lineColor: RULE },
    headStyles: { fontStyle: 'bold' as const, fontSize: 7.5, textColor: MUTED },
    bodyStyles: { lineWidth: { bottom: 0.2 } },
  };

  // Plantões; matrícula é opcional no cadastro: a coluna só aparece se alguém tiver.
  const withBadge = schedule.shifts.some((s) => s.userBadgeNumber);
  const badgeCell = (badge: string | null | undefined) => (withBadge ? [badge ?? '—'] : []);
  const memberColumn = withBadge ? 3 : 2;
  sectionTitle('PLANTÕES', 57);
  autoTable(doc, {
    ...tableStyle,
    startY: 60,
    head: [
      [
        'Data',
        'Dia',
        ...(withBadge ? ['Matrícula'] : []),
        'Responsável',
        'Horário',
        { content: 'Horas', styles: { halign: 'right' } },
      ],
    ],
    body: schedule.shifts.map((s) => {
      const vacation = s.dayType === 'collective_vacation';
      return [
        formatDate(s.date),
        dayLabel(s),
        ...badgeCell(s.userBadgeNumber),
        memberLabel(s),
        vacation ? '—' : formatPeriod(s).replace('–', ' - '),
        { content: vacation ? '—' : formatHours(s.hours), styles: { halign: 'right' } },
      ];
    }),
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      const s = schedule.shifts[data.row.index];
      if (!s) return;
      if (s.dayType === 'holiday') data.cell.styles.fillColor = HOLIDAY;
      else if (s.dayType !== 'weekday') data.cell.styles.fillColor = WEEKEND;
      if (data.column.index === memberColumn && !s.userId && s.dayType !== 'collective_vacation') {
        data.cell.styles.textColor = DANGER;
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  // Totalização por membro
  const totals = memberTotals(schedule.shifts);
  const totalHours = totals.reduce((sum, t) => sum + t.hours, 0);
  const share = (hours: number) =>
    totalHours > 0 ? `${((hours / totalHours) * 100).toFixed(1).replace('.', ',')}%` : '—';
  let y = lastY(doc) + 10;
  if (y > pageH - 40) {
    doc.addPage();
    y = 20;
  }
  sectionTitle('TOTALIZAÇÃO POR MEMBRO', y);
  const right = { halign: 'right' as const };
  autoTable(doc, {
    ...tableStyle,
    startY: y + 3,
    head: [
      [
        ...(withBadge ? ['Matrícula'] : []),
        'Membro',
        { content: 'Plantões', styles: right },
        { content: 'Fins de semana e feriados', styles: right },
        { content: 'Horas', styles: right },
        { content: 'Participação', styles: right },
      ],
    ],
    body: totals.map((t) => [
      ...badgeCell(t.badge),
      t.name,
      { content: String(t.shifts), styles: right },
      { content: String(t.weekendHolidayShifts), styles: right },
      { content: formatHours(t.hours), styles: right },
      { content: share(t.hours), styles: right },
    ]),
    foot: [
      [
        { content: 'Total', colSpan: withBadge ? 2 : 1 },
        { content: String(totals.reduce((sum, t) => sum + t.shifts, 0)), styles: right },
        {
          content: String(totals.reduce((sum, t) => sum + t.weekendHolidayShifts, 0)),
          styles: right,
        },
        { content: formatHours(totalHours), styles: right },
        { content: totalHours > 0 ? '100%' : '—', styles: right },
      ],
    ],
    footStyles: { fontStyle: 'bold', lineWidth: { top: 0.4 }, lineColor: INK },
  });

  // Rodapé em todas as páginas
  const pages = doc.getNumberOfPages();
  const issued = `Emitido em ${formatDateTime(now.toISOString())} · ${period}`;
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, pageH - 11, pageW - MARGIN, pageH - 11);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(issued, MARGIN, pageH - 7);
    doc.text(`Página ${page} de ${pages}`, pageW - MARGIN, pageH - 7, { align: 'right' });
  }
  return doc;
}

/** Gera e baixa o PDF da escala. */
export async function downloadSchedulePdf(
  schedule: ScheduleDetail,
  ctx: ReportContext,
): Promise<void> {
  const doc = await buildSchedulePdf(schedule, ctx);
  doc.save(reportFileName(schedule, ctx, 'pdf'));
}
