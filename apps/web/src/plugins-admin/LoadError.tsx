import { useNavigate } from 'react-router';
import { Breadcrumb, type Crumb } from '@diovanibmotta/plantao365-web-sdk';

/** Formulário que não carregou: mensagem e volta para a listagem. */
export function LoadError({
  crumbs,
  message,
  back,
}: {
  crumbs: Crumb[];
  message: string;
  back: string;
}) {
  const navigate = useNavigate();
  return (
    <section>
      <Breadcrumb crumbs={crumbs} />
      <p className="alert" role="alert">
        {message}
      </p>
      <button type="button" className="btn" onClick={() => void navigate(back)}>
        Voltar para a listagem
      </button>
    </section>
  );
}
