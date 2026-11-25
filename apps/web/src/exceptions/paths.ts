/** Contexto em que a tela de ausências aparece: Férias do gestor ou Exceções do próprio membro (Perfil). */
export type UnavailabilityMode = 'member' | 'vacations';

export interface UnavailabilityScope {
  listPath: string;
  newPath: string;
  itemPath: (id: string) => string;
}

export const VACATIONS_PATH = '/vacations';
export const PROFILE_EXCEPTIONS_PATH = '/profile?tab=exceptions';

export const SCOPES: Record<UnavailabilityMode, UnavailabilityScope> = {
  vacations: {
    listPath: VACATIONS_PATH,
    newPath: `${VACATIONS_PATH}/new`,
    itemPath: (id) => `${VACATIONS_PATH}/${id}`,
  },
  member: {
    listPath: PROFILE_EXCEPTIONS_PATH,
    newPath: '/profile/exceptions/new',
    itemPath: (id) => `/profile/exceptions/${id}`,
  },
};
