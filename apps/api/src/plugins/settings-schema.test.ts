import { describe, expect, it } from 'vitest';
import { settingsSchemaSchema, validateSettings, type SettingsSchema } from './settings-schema.js';

const schema: SettingsSchema = {
  type: 'object',
  properties: {
    phone: { type: 'string', title: 'Telefone', maxLength: 20 },
    email: { type: 'string', title: 'E-mail', format: 'email' },
    retries: { type: 'integer', title: 'Tentativas', minimum: 1, maximum: 5 },
    mode: { type: 'string', title: 'Modo', enum: ['a', 'b'] },
    active: { type: 'boolean', title: 'Ativo' },
  },
  required: ['phone'],
};

describe('validateSettings', () => {
  it('aceita configuração válida e campos opcionais vazios', () => {
    expect(validateSettings(schema, { phone: '123', retries: 3, mode: 'a', active: true })).toEqual(
      [],
    );
    expect(validateSettings(schema, { phone: '1', email: '' })).toEqual([]);
  });

  it('aponta obrigatório, tipo, faixa, formato, opções e campo desconhecido', () => {
    expect(
      validateSettings(schema, {
        email: 'x',
        retries: 2.5,
        mode: 'c',
        active: 'sim',
        extra: 1,
      }),
    ).toEqual([
      'Campo desconhecido: extra.',
      'Telefone: obrigatório.',
      'E-mail: deve ser um e-mail válido.',
      'Tentativas: deve ser um número inteiro.',
      'Modo: valor fora das opções.',
      'Ativo: deve ser sim/não.',
    ]);
    expect(validateSettings(schema, { phone: '1', retries: 9 })).toEqual(['Tentativas: máximo 5.']);
  });

  it('sem schema só aceita configuração vazia', () => {
    expect(validateSettings(undefined, {})).toEqual([]);
    expect(validateSettings(undefined, { a: 1 })).toEqual(['Campo desconhecido: a.']);
  });

  it('recusa schema fora do subconjunto suportado', () => {
    expect(settingsSchemaSchema.safeParse(schema).success).toBe(true);
    const nested = { type: 'object', properties: { a: { type: 'object', title: 'A' } } };
    expect(settingsSchemaSchema.safeParse(nested).success).toBe(false);
  });
});
