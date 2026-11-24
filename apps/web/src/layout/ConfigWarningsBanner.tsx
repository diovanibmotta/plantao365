import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { Icon } from './icons';
import './config-warnings.css';

export interface ConfigWarning {
  code: string;
  message: string;
  docsUrl: string;
}

const STORAGE_KEY = 'p360_dismissed_warnings';

function readDismissed(): string[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function writeDismissed(codes: string[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(codes));
  } catch {
    // preferência opcional
  }
}

/** Faixa no topo da tela: recursos desativados por falta de configuração na implantação. */
export function ConfigWarningsBanner() {
  const [warnings, setWarnings] = useState<ConfigWarning[]>([]);
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<{ warnings?: ConfigWarning[] }>('/api/system/warnings', controller.signal)
      .then((body) => setWarnings(Array.isArray(body?.warnings) ? body.warnings : []))
      .catch(() => {
        // aviso é opcional: falha de rede não deve atrapalhar a tela
      });
    return () => controller.abort();
  }, []);

  const visible = warnings.filter((w) => !dismissed.includes(w.code));
  const hasBanner = visible.length > 0;

  // Sidebar e topbar fixos descem a altura do banner (--banner-h).
  useEffect(() => {
    const el = barRef.current;
    const root = document.documentElement;
    if (!hasBanner || !el) return;
    const update = () => root.style.setProperty('--banner-h', `${el.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--banner-h');
    };
  }, [hasBanner]);

  if (!hasBanner) return null;

  const dismiss = (code: string) => {
    const next = [...dismissed, code];
    setDismissed(next);
    writeDismissed(next);
  };

  return (
    <div ref={barRef} className="config-warnings" role="region" aria-label="Avisos de configuração">
      {visible.map((w) => (
        <div key={w.code} className="config-warning" role="alert">
          <Icon name="warning" size={18} />
          <p className="config-warning-text">
            {w.message}{' '}
            <a href={w.docsUrl} target="_blank" rel="noopener noreferrer">
              Consulte a documentação de implantação.
            </a>
          </p>
          <button
            type="button"
            className="icon-btn"
            aria-label="Dispensar aviso"
            onClick={() => dismiss(w.code)}
          >
            <Icon name="close" />
          </button>
        </div>
      ))}
    </div>
  );
}
