/**
 * Preferências do membro. São restrições BRANDAS: o rodízio as atende quando possível, sem
 * violar regras rígidas nem o equilíbrio, e informa as violações.
 */
export interface PreferencesDto {
  /** Dias da semana a evitar: 0 = domingo ... 6 = sábado, sem repetição. */
  avoidWeekdays: number[];
  /** Máximo de plantões consecutivos desejado (1 a 14) ou null para sem preferência. */
  maxConsecutiveShifts: number | null;
}

export interface UserPreferencesDto extends PreferencesDto {
  userId: string;
}

export const MAX_CONSECUTIVE_LIMIT = 14;

export const emptyPreferences = (): PreferencesDto => ({
  avoidWeekdays: [],
  maxConsecutiveShifts: null,
});
