/*
 * Regressão visual do plugin de referência (claro/escuro, desktop/mobile) e comparação de estilos
 * computados com telas nativas equivalentes: o plugin tem de parecer parte do app.
 */
import { expect, test, type Page } from '@playwright/test';
import { PLUGIN_ID } from './env.js';

const LIST = `/ext/${PLUGIN_ID}`;
/** Formulário nativo da equipe criada pela migração 0015. */
const TEAM_FORM = '/teams/00000000-0000-0000-0000-000000000001';
const SLOT = `[data-slot="profile.sections"][data-plugin="${PLUGIN_ID}"]`;

const PROPS = [
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'color',
  'background-color',
  'border-top-color',
  'border-top-width',
  'border-bottom-color',
  'border-bottom-width',
  'border-top-left-radius',
  'padding-top',
  'padding-left',
  'padding-bottom',
  'margin-top',
  'margin-bottom',
];

async function openList(page: Page) {
  await page.goto(LIST);
  await expect(page.getByRole('table')).toBeVisible();
}

async function openForm(page: Page) {
  await openList(page);
  await page.getByRole('link', { name: 'Editar Ana Souza' }).click();
  await expect(page.getByLabel('Nome')).toHaveValue('Ana Souza');
  // Tira o hover do clique antes de fotografar ou medir.
  await page.mouse.move(0, 0);
}

async function openProfileSlot(page: Page) {
  await page.goto('/profile');
  await expect(page.locator(SLOT).getByText('Bruno Lima')).toBeVisible();
}

async function stylesOf(page: Page, selectors: Record<string, string>) {
  // Cor em transição (ex.: borda depois do blur) mudaria a medição.
  await page.addStyleTag({ content: '* { transition: none !important; }' });
  const result: Record<string, Record<string, string>> = {};
  for (const [name, selector] of Object.entries(selectors)) {
    result[name] = await page
      .locator(selector)
      .first()
      .evaluate(
        (el, props) =>
          Object.fromEntries(props.map((p) => [p, getComputedStyle(el).getPropertyValue(p)])),
        PROPS,
      );
  }
  return result;
}

test('listagem', async ({ page }) => {
  await openList(page);
  await expect(page.locator('main')).toHaveScreenshot('list.png');
});

test('formulário', async ({ page }) => {
  await openForm(page);
  await expect(page.locator('main')).toHaveScreenshot('form.png');
});

test('slot no perfil', async ({ page }) => {
  await openProfileSlot(page);
  await expect(page.locator(SLOT)).toHaveScreenshot('profile-slot.png');
});

test('listagem usa os mesmos estilos de uma listagem nativa', async ({ page }) => {
  const selectors = {
    title: 'main .ui-header h2',
    description: 'main .ui-header p',
    primaryButton: 'main .ui-header .btn.primary',
    search: 'main input[type="search"]',
    th: 'main .ui-table thead th',
    // A última linha não tem borda: compara a mesma posição nos dois lados.
    td: 'main .ui-table tbody tr:last-child td',
    rowButton: 'main .ui-table .btn.sm',
  };
  await page.goto('/teams');
  await expect(page.getByRole('table')).toBeVisible();
  const native = await stylesOf(page, selectors);
  await openList(page);
  expect(await stylesOf(page, selectors)).toEqual(native);
});

test('formulário e slot usam os mesmos estilos de um formulário nativo', async ({ page }) => {
  const selectors = {
    breadcrumb: 'main .ui-breadcrumb',
    title: 'main .ui-form-head h2',
    section: 'main .ui-section',
    sectionTitle: 'main .ui-section h3',
    input: 'main .ui-field input',
    actions: 'main .ui-actions',
    save: 'main .ui-actions .btn.primary',
    remove: 'main .ui-actions .btn.ui-danger',
  };
  await page.goto(TEAM_FORM);
  await expect(page.getByLabel('Nome da equipe')).toBeFocused();
  // O campo nativo tem autofocus; compara os dois sem foco.
  await page.getByLabel('Nome da equipe').blur();
  const native = await stylesOf(page, selectors);

  await openForm(page);
  expect(await stylesOf(page, selectors)).toEqual(native);

  await openProfileSlot(page);
  const slot = await stylesOf(page, {
    section: `${SLOT} .ui-section`,
    sectionTitle: `${SLOT} .ui-section h3`,
  });
  expect(slot).toEqual({ section: native.section, sectionTitle: native.sectionTitle });
});
