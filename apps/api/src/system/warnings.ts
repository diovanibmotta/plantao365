export interface ConfigWarning {
  /** Identificador estável do aviso (usado para dispensar o banner no front). */
  code: 'email_disabled' | 'sso_disabled';
  /** Texto exibido ao gestor (pt-BR, sem termos técnicos). */
  message: string;
  /** Link da documentação de implantação. */
  docsUrl: string;
}

export interface WarningsInput {
  DOCS_URL: string;
  SMTP_HOST?: string | undefined;
  SMTP_FROM?: string | undefined;
  OIDC_ISSUER?: string | undefined;
  OIDC_CLIENT_ID?: string | undefined;
  OIDC_CLIENT_SECRET?: string | undefined;
  OIDC_REDIRECT_URI?: string | undefined;
}

/** Recursos desativados por falta de configuração na implantação (nunca expõe nomes nem valores). */
export function computeConfigWarnings(env: WarningsInput): ConfigWarning[] {
  const warnings: ConfigWarning[] = [];
  const docsUrl = env.DOCS_URL;

  if (!env.SMTP_HOST || !env.SMTP_FROM) {
    warnings.push({
      code: 'email_disabled',
      message:
        'A funcionalidade de envio de e-mails não está ativa, pois não foi configurada. Notificações, lembretes e convites não serão enviados.',
      docsUrl,
    });
  }

  if (
    !env.OIDC_ISSUER ||
    !env.OIDC_CLIENT_ID ||
    !env.OIDC_CLIENT_SECRET ||
    !env.OIDC_REDIRECT_URI
  ) {
    warnings.push({
      code: 'sso_disabled',
      message:
        'O login corporativo não está ativo, pois não foi configurado. Só é possível entrar com a conta master.',
      docsUrl,
    });
  }

  return warnings;
}
