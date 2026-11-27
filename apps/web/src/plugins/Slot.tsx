import type { SlotName } from '@diovanibmotta/plantao365-web-sdk';
import { PluginBoundary } from './PluginBoundary';
import { usePlugins } from './PluginContext';
import './plugins.css';

/**
 * Ponto nomeado de uma tela nativa onde plugins inserem conteúdo. O host dá a moldura
 * (espaçamento) e o isolamento de erro; o plugin fornece só o conteúdo.
 */
export function Slot({ name }: { name: SlotName }) {
  const { plugins } = usePlugins();
  const entries = plugins.flatMap((p) => {
    const Content = p.module?.slots?.[name];
    return Content ? [{ id: p.id, name: p.name, Content }] : [];
  });
  if (entries.length === 0) return null;
  return (
    <>
      {entries.map(({ id, name: pluginName, Content }) => (
        <div key={id} className={`plugin-slot plg-${id}`} data-plugin={id} data-slot={name}>
          <PluginBoundary name={pluginName}>
            <Content />
          </PluginBoundary>
        </div>
      ))}
    </>
  );
}
