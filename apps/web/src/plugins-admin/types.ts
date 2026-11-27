export type PluginStatus = 'installed' | 'enabled' | 'disabled' | 'failed';

export interface SettingsField {
  type: 'string' | 'number' | 'integer' | 'boolean';
  title: string;
  description?: string;
  enum?: (string | number)[];
  default?: string | number | boolean;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  format?: 'email' | 'uri';
}

export interface SettingsSchema {
  type: 'object';
  properties: Record<string, SettingsField>;
  required?: string[];
}

export interface PluginSummary {
  id: string;
  name: string;
  version: string;
  description: string | null;
  status: PluginStatus;
  error: string | null;
  settings: Record<string, unknown>;
  settingsSchema: SettingsSchema | null;
  active: boolean;
  installedAt: string;
  updatedAt: string;
}

export const STATUS_LABELS: Record<PluginStatus, string> = {
  installed: 'Instalado',
  enabled: 'Habilitado',
  disabled: 'Desabilitado',
  failed: 'Com falha',
};

/** Valores do formulário: texto como o input entrega; boolean como checkbox. */
export type SettingsValues = Record<string, string | boolean>;

export function toFormValues(schema: SettingsSchema | null, settings: Record<string, unknown>) {
  const values: SettingsValues = {};
  for (const [key, field] of Object.entries(schema?.properties ?? {})) {
    const v = settings[key] ?? field.default;
    values[key] = field.type === 'boolean' ? v === true : v === undefined ? '' : String(v);
  }
  return values;
}

/** Converte para o JSON da API; campo vazio não é enviado. */
export function toSettings(schema: SettingsSchema | null, values: SettingsValues) {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema?.properties ?? {})) {
    const v = values[key];
    if (field.type === 'boolean') out[key] = v === true;
    else if (typeof v === 'string' && v.trim() !== '') {
      out[key] = field.type === 'string' ? v.trim() : Number(v);
    }
  }
  return out;
}

/** Regras visíveis no formulário; a API valida de novo contra o mesmo schema. */
export function validateValues(schema: SettingsSchema | null, values: SettingsValues) {
  const errors: Record<string, string> = {};
  for (const [key, field] of Object.entries(schema?.properties ?? {})) {
    const v = values[key];
    if (field.type === 'boolean' || typeof v !== 'string') continue;
    if (v.trim() === '') {
      if (schema?.required?.includes(key)) errors[key] = 'Obrigatório.';
      continue;
    }
    if (field.type === 'string') {
      if (field.maxLength !== undefined && v.trim().length > field.maxLength) {
        errors[key] = `Use no máximo ${field.maxLength} caracteres.`;
      }
      continue;
    }
    const n = Number(v);
    if (!Number.isFinite(n)) errors[key] = 'Informe um número.';
    else if (field.type === 'integer' && !Number.isInteger(n)) errors[key] = 'Informe um inteiro.';
    else if (field.minimum !== undefined && n < field.minimum) {
      errors[key] = `Mínimo ${field.minimum}.`;
    } else if (field.maximum !== undefined && n > field.maximum) {
      errors[key] = `Máximo ${field.maximum}.`;
    }
  }
  return errors;
}
