export const SCHEDULE_ADMIN_PATH = '/schedule-admin';

export type ScheduleAdminTab = 'schedules' | 'times' | 'exceptions' | 'work-hours';

/** Listagem de cada aba; a aba padrão (escalas) fica na raiz. */
export const tabPath = (tab: ScheduleAdminTab) =>
  tab === 'schedules' ? SCHEDULE_ADMIN_PATH : `${SCHEDULE_ADMIN_PATH}?tab=${tab}`;

export const SCHEDULE_NEW_PATH = `${SCHEDULE_ADMIN_PATH}/schedules/new`;
export const schedulePath = (id: string) => `${SCHEDULE_ADMIN_PATH}/schedules/${id}`;

export const SHIFT_TIMES_NEW_PATH = `${SCHEDULE_ADMIN_PATH}/shift-times/new`;
/** Chave: dia da semana (0 = domingo … 6 = sábado) ou `holiday`. */
export const shiftTimePath = (key: string | number) => `${SCHEDULE_ADMIN_PATH}/shift-times/${key}`;
export const WORK_HOURS_NEW_PATH = `${SCHEDULE_ADMIN_PATH}/work-hours/new`;
/** Posição do período na jornada, em ordem cronológica (0 = primeiro). */
export const workHoursPath = (position: number) => `${SCHEDULE_ADMIN_PATH}/work-hours/${position}`;

export const EXCEPTIONS_NEW_PATH = `${SCHEDULE_ADMIN_PATH}/exceptions/new`;
export const exceptionPath = (date: string) => `${SCHEDULE_ADMIN_PATH}/exceptions/${date}`;
export const EXCEPTIONS_LIST_PATH = tabPath('exceptions');
