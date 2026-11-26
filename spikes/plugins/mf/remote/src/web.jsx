import { useState } from 'react';
import { useLocation } from 'react-router';
import { useSdk } from '@spike/web-sdk';

/* global __PLUGIN_VERSION__ */
export default function DemoPlugin() {
  const [clicks, setClicks] = useState(0); // falha com "Invalid hook call" se houver 2 Reacts
  const location = useLocation(); // falha fora do Router do host se react-router não for singleton
  const sdk = useSdk(); // 'sem-host' se o web-sdk não for singleton
  return (
    <section data-testid="plugin">
      <p data-testid="version">plugin demo v{__PLUGIN_VERSION__}</p>
      <p data-testid="location">location={location.pathname}</p>
      <p data-testid="sdk">sdk={sdk}</p>
      <button onClick={() => setClicks((n) => n + 1)}>cliques: {clicks}</button>
    </section>
  );
}
