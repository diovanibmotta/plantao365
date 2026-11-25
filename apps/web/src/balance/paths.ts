export const BALANCE_PATH = '/balance';

export type BalanceTab = 'mine' | 'team' | 'adjustments';

/** Listagem de cada aba; a aba padrão (meu saldo) fica na raiz. O ano só vai na URL quando informado. */
export const tabPath = (tab: BalanceTab, year?: number) => {
  const params = new URLSearchParams();
  if (tab !== 'mine') params.set('tab', tab);
  if (year !== undefined) params.set('year', String(year));
  const query = params.toString();
  return query ? `${BALANCE_PATH}?${query}` : BALANCE_PATH;
};

export const adjustmentsListPath = (year?: number) => tabPath('adjustments', year);
export const ADJUSTMENTS_NEW_PATH = `${BALANCE_PATH}/adjustments/new`;
export const adjustmentPath = (id: string) => `${BALANCE_PATH}/adjustments/${id}`;
