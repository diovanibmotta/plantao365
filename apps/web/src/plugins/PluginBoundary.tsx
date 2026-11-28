import { Component, type ReactNode } from 'react';

/** Isola a falha de render de um plugin: mostra um aviso no lugar, o resto da tela segue. */
export class PluginBoundary extends Component<
  { name: string; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    console.error(`Plugin ${this.props.name}: erro de renderização`, error);
  }

  override render() {
    if (this.state.failed) {
      return (
        <p className="alert" role="alert">
          A extensão {this.props.name} não pôde ser exibida.
        </p>
      );
    }
    return this.props.children;
  }
}
