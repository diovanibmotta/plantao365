import { describe, expect, it } from 'vitest';
import { NAV_GROUP_LABELS, navItemsFor } from './nav';

describe('menu', () => {
  it('Plugins fica na seção Configuração, só para gestor', () => {
    const plugins = navItemsFor('manager').find((i) => i.to === '/plugins');
    expect(NAV_GROUP_LABELS[plugins!.group]).toBe('Configuração');
    expect(navItemsFor('member').some((i) => i.to === '/plugins')).toBe(false);
  });
});
