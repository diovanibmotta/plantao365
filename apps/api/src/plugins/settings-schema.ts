import { z } from 'zod';

/*
 * Subconjunto de JSON Schema para a configuração de um plugin: objeto plano de campos escalares.
 * É o que a tela /plugins/:id sabe desenhar como formulário e o que o kernel valida no PUT.
 */

const fieldSchema = z.object({
  type: z.enum(['string', 'number', 'integer', 'boolean']),
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().max(300).optional(),
  enum: z
    .array(z.union([z.string(), z.number()]))
    .min(1)
    .max(50)
    .optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  maxLength: z.number().int().positive().max(5000).optional(),
  format: z.enum(['email', 'uri']).optional(),
});

export const settingsSchemaSchema = z.object({
  type: z.literal('object'),
  properties: z
    .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,59}$/), fieldSchema)
    .refine((p) => Object.keys(p).length <= 50, 'no máximo 50 campos'),
  required: z.array(z.string()).optional(),
});

export type SettingsSchema = z.infer<typeof settingsSchemaSchema>;
type Field = SettingsSchema['properties'][string];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fieldError(field: Field, value: unknown): string | null {
  if (field.type === 'boolean') return typeof value === 'boolean' ? null : 'deve ser sim/não';
  if (field.type === 'string') {
    if (typeof value !== 'string') return 'deve ser texto';
    if (field.maxLength !== undefined && value.length > field.maxLength) {
      return `deve ter no máximo ${field.maxLength} caracteres`;
    }
    if (field.format === 'email' && !EMAIL.test(value)) return 'deve ser um e-mail válido';
    if (field.format === 'uri' && !URL.canParse(value)) return 'deve ser uma URL válida';
  } else {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'deve ser um número';
    if (field.type === 'integer' && !Number.isInteger(value)) return 'deve ser um número inteiro';
    if (field.minimum !== undefined && value < field.minimum) return `mínimo ${field.minimum}`;
    if (field.maximum !== undefined && value > field.maximum) return `máximo ${field.maximum}`;
  }
  if (field.enum && !field.enum.includes(value as string | number)) return 'valor fora das opções';
  return null;
}

/**
 * Erros (pt-BR) da configuração contra o schema; vazio = válida. Sem schema, só aceita objeto vazio:
 * o plugin que quer configuração declara os campos.
 */
export function validateSettings(
  schema: SettingsSchema | undefined,
  settings: Record<string, unknown>,
): string[] {
  const properties = schema?.properties ?? {};
  const errors: string[] = [];
  for (const key of Object.keys(settings)) {
    if (!(key in properties)) errors.push(`Campo desconhecido: ${key}.`);
  }
  for (const [key, field] of Object.entries(properties)) {
    const value = settings[key];
    if (value === undefined || value === null || value === '') {
      if (schema?.required?.includes(key)) errors.push(`${field.title}: obrigatório.`);
      continue;
    }
    const error = fieldError(field, value);
    if (error) errors.push(`${field.title}: ${error}.`);
  }
  return errors;
}
