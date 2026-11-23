import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { ExceptionsSection } from '../exceptions/ExceptionsSection';
import { PreferencesSection } from '../exceptions/PreferencesSection';
import { PersonalDataSection } from '../profile/PersonalDataSection';
import type { Profile } from '../profile/types';

type Loaded = { profile: Profile } | { error: string } | null;

export function ProfilePage() {
  const [loaded, setLoaded] = useState<Loaded>(null);

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
          <PersonalDataSection
            profile={loaded.profile}
            onSaved={(profile) => setLoaded({ profile })}
          />
          <PreferencesSection />
          <ExceptionsSection />
        </>
      )}
    </section>
  );
}
