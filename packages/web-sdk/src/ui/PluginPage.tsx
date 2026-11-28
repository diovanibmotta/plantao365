import type { ReactNode } from 'react';
import { Breadcrumb, type Crumb } from './FormPage.js';
import { PageHeader } from './PageHeader.js';

/**
 * Moldura de tela de plugin: breadcrumb (opcional), título, descrição e CTA no mesmo cabeçalho
 * das listagens nativas. O plugin preenche só o conteúdo.
 */
export function PluginPage({
  title,
  description,
  crumbs,
  action,
  children,
}: {
  title: string;
  description?: string;
  crumbs?: Crumb[];
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      {crumbs && crumbs.length > 0 && <Breadcrumb crumbs={crumbs} />}
      <PageHeader title={title} description={description} action={action} />
      {children}
    </section>
  );
}
