import { describe, expect, it, vi } from 'vitest';
import { registerRemotes } from '@module-federation/runtime';
import { loadFederatedPlugins } from './loader';

vi.mock('@module-federation/runtime', () => ({
  registerRemotes: vi.fn(),
  loadRemote: vi.fn(() => Promise.resolve({ default: {} })),
}));

describe('loadFederatedPlugins', () => {
  it('força o novo registro só quando a entry do remote muda', async () => {
    const load = (version: string) =>
      loadFederatedPlugins([
        {
          id: 'demo',
          name: 'Demo',
          version,
          web: { remote: 'plugin_demo', entry: `/plugins-assets/demo/${version}/remoteEntry.js` },
        },
      ]);
    await load('1.0.0');
    await load('1.0.0');
    await load('1.1.0');
    expect(vi.mocked(registerRemotes).mock.calls.map(([, options]) => options?.force)).toEqual([
      false,
      false,
      true,
    ]);
  });
});
