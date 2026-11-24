import { Component, ErrorInfo, ReactNode } from 'react';
import { BrandMark } from './BrandMark';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

const STORAGE_KEY = 'thock-lab:v1';

/**
 * Last line of defence: if anything in the React tree throws, show a calm
 * recovery card instead of an empty page. "Reload" keeps saved builds;
 * "Reset studio" clears local data in case corrupted state is the cause.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep a trace for debugging without surfacing a console error loop
    (window as unknown as { __thockLastError?: unknown }).__thockLastError = {
      message: error.message,
      stack: info.componentStack,
    };
  }

  private reload = () => {
    try {
      window.history.replaceState(null, '', window.location.pathname);
    } catch {
      // ignore
    }
    window.location.reload();
  };

  private reset = () => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    this.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="crash-screen" role="alert" data-testid="crash-screen">
        <div className="crash-card">
          <BrandMark size={44} />
          <h1 className="crash-title">A keycap popped off.</h1>
          <p className="crash-body">
            Something unexpected happened in the studio. Reload to pick up where you left off —
            your Shelf is saved on this device.
          </p>
          <div className="crash-actions">
            <button type="button" className="primary-pill-btn" onClick={this.reload}>
              Reload Thock Lab
            </button>
            <button type="button" className="secondary-pill-btn" onClick={this.reset}>
              Reset studio data
            </button>
          </div>
        </div>
      </main>
    );
  }
}
