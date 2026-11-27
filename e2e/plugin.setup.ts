import { main } from '@diovanibmotta/plantao365-plugin-sdk/cli';
import { expect, test as setup } from '@playwright/test';
import * as env from './env.js';

const CONTACTS = [
  { name: 'Ana Souza', phone: '+55 11 91234-5678', role: 'Coordenação' },
  { name: 'Bruno Lima', phone: '+55 11 98765-4321', role: 'Infraestrutura' },
];

setup(
  'instala o plugin assinado, habilita com a master key e cadastra contatos',
  async ({ page }) => {
    const install = ['install', env.PLUGIN_ARCHIVE, '--url', env.BASE_URL];
    expect(await main([...install, '--token', env.INSTALL_TOKEN])).toBe(0);

    await page.goto('/login');
    const login = page.getByRole('form', { name: 'Acesso master' });
    await login.getByLabel('Usuário').fill(env.MASTER.username);
    await login.getByLabel('Senha').fill(env.MASTER.password);
    await login.getByRole('button', { name: 'Entrar como master' }).click();
    await expect(page).not.toHaveURL(/\/login/);

    await page.goto(`/plugins/${env.PLUGIN_ID}`);
    await page.getByLabel('Habilitado').check();
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page).toHaveURL(/\/plugins$/);

    for (const contact of CONTACTS) {
      await page.goto(`/ext/${env.PLUGIN_ID}/new`);
      await page.getByLabel('Nome').fill(contact.name);
      await page.getByLabel('Telefone').fill(contact.phone);
      await page.getByLabel('Função').fill(contact.role);
      await page.getByRole('button', { name: 'Salvar' }).click();
      await expect(page.getByRole('cell', { name: contact.name, exact: true })).toBeVisible();
    }

    await page.context().storageState({ path: env.SESSION_FILE });
  },
);
