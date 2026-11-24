import { describe, expect, it } from 'vitest';
import { computeConfigWarnings } from './warnings.js';

const DOCS_URL = 'https://wiki.exemplo.com/implantacao';
const oidc = {
  OIDC_ISSUER: 'https://idp.exemplo.com',
  OIDC_CLIENT_ID: 'id',
  OIDC_CLIENT_SECRET: 'segredo',
  OIDC_REDIRECT_URI: 'https://app.exemplo.com/auth/callback',
};
const smtp = { SMTP_HOST: 'smtp.exemplo.com', SMTP_FROM: 'a@exemplo.com' };

describe('computeConfigWarnings', () => {
  it('sem avisos quando e-mail e SSO estão configurados', () => {
    expect(computeConfigWarnings({ DOCS_URL, ...smtp, ...oidc })).toEqual([]);
  });

  it('avisa que o e-mail está desativado, com link da documentação', () => {
    const warnings = computeConfigWarnings({ DOCS_URL, ...oidc });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: 'email_disabled', docsUrl: DOCS_URL });
  });

  it('avisa que o SSO está desativado quando falta qualquer variável OIDC', () => {
    const warnings = computeConfigWarnings({
      DOCS_URL,
      ...smtp,
      OIDC_ISSUER: oidc.OIDC_ISSUER,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: 'sso_disabled' });
  });

  it('nunca inclui valores nem nomes de variáveis no aviso', () => {
    const json = JSON.stringify(
      computeConfigWarnings({ DOCS_URL, OIDC_CLIENT_SECRET: 'segredo-x' }),
    );
    expect(json).not.toContain('segredo-x');
    expect(json).not.toMatch(/SMTP_|OIDC_/);
  });
});
