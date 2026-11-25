import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { Avatar } from '../layout/Avatar';

interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  badgeNumber: string | null;
}

interface ContactCardModalProps {
  userId: string;
  name: string;
  onClose: () => void;
}

type State = { userId: string; contact: Contact } | { userId: string; error: string } | null;

/** Cartão de visita de quem está de plantão: foto, nome, e-mail e telefone (se cadastrado). */
export function ContactCardModal({ userId, name, onClose }: ContactCardModalProps) {
  const [state, setState] = useState<State>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<Contact>(`/api/users/${userId}/contact`, controller.signal)
      .then((contact) => setState({ userId, contact }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const error = err instanceof Error ? err.message : 'Não foi possível carregar o contato.';
        setState({ userId, error });
      });
    return () => controller.abort();
  }, [userId]);

  useEffect(() => closeRef.current?.focus(), []);

  const current = state?.userId === userId ? state : null;
  const contact = current && 'contact' in current ? current.contact : null;
  const error = current && 'error' in current ? current.error : null;

  return (
    <div
      className="contact-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        className="contact-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-card-title"
      >
        <Avatar userId={userId} name={name} className="avatar contact-avatar" />
        <h2 id="contact-card-title">{contact?.name ?? name}</h2>
        {current === null && (
          <p className="status" role="status">
            Carregando…
          </p>
        )}
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        {contact && (
          <dl className="contact-facts">
            <dt>E-mail</dt>
            <dd>
              <a href={`mailto:${contact.email}`}>{contact.email}</a>
            </dd>
            <dt>Crachá</dt>
            <dd>{contact.badgeNumber ?? <span className="muted">Não cadastrado</span>}</dd>
            <dt>Telefone</dt>
            <dd>
              {contact.phone ? (
                <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`}>{contact.phone}</a>
              ) : (
                <span className="muted">Não cadastrado</span>
              )}
            </dd>
          </dl>
        )}
        <button type="button" className="btn" ref={closeRef} onClick={onClose}>
          Fechar
        </button>
      </div>
    </div>
  );
}
