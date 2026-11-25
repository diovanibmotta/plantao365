import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../api/client';
import { ExceptionsSection } from '../exceptions/ExceptionsSection';
import { PreferencesSection } from '../exceptions/PreferencesSection';
import { PersonalDataSection } from '../profile/PersonalDataSection';
import type { Profile } from '../profile/types';

import '../schedule-admin/schedule-admin.css';

type Loaded = { profile: Profile } | { error: string } | null;
type Tab = 'profile' | 'preferences' | 'exceptions';

const TABS: { id: Tab; label: string }[] = [
  { id: 'profile', label: 'Perfil' },
  { id: 'preferences', label: 'Preferências' },
  { id: 'exceptions', label: 'Exceções' },
];

export function ProfilePage() {
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: Tab = TABS.find((t) => t.id === tabParam)?.id ?? 'profile';
  const setTab = (next: Tab) => setParams(next === 'profile' ? {} : { tab: next });

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<Profile>('/api/me', controller.signal)
      .then((profile) => setLoaded({ profile }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoaded({
          error: err instanceof Error ? err.message : 'Não foi possível carregar o perfil.',
        });
      });
    return () => controller.abort();
  }, []);

  return (
    <section>
      <h1>Perfil</h1>
      {loaded === null && (
        <p className="status" role="status">
          Carregando…
        </p>
      )}
      {loaded !== null && 'error' in loaded && (
        <p className="alert" role="alert">
          {loaded.error}
        </p>
      )}
      {loaded !== null && 'profile' in loaded && (
        <>
          <div className="sad-tabs" role="tablist" aria-label="Seções do perfil">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`profile-tab-${t.id}`}
                className="sad-tab"
                aria-selected={tab === t.id}
                aria-controls="profile-panel"
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div id="profile-panel" role="tabpanel" aria-labelledby={`profile-tab-${tab}`}>
            {tab === 'profile' && (
              <PersonalDataSection
                profile={loaded.profile}
                onSaved={(profile) => setLoaded({ profile })}
              />
            )}
            {tab === 'preferences' && <PreferencesSection />}
            {tab === 'exceptions' && <ExceptionsSection />}
          </div>
        </>
      )}
    </section>
  );
}
