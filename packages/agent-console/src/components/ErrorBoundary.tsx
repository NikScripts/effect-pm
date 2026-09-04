/**
 * Top-level crash guard. React only offers this via a class component (no
 * hook equivalent as of React 19) — without it, an uncaught render error
 * anywhere in the tree unmounts the whole app to a blank page with nothing
 * in the UI explaining why, only a console error the user can't see on a
 * phone.
 *
 * @internal
 */
import * as React from "react";

type Props = { readonly children: React.ReactNode };
type State = { readonly error: Error | undefined };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: undefined };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("agent-console crashed", error, info.componentStack);
  }

  override render(): React.ReactNode {
    const { error } = this.state;
    if (error === undefined) return this.props.children;
    return (
      <div className="crash-screen">
        <p>Something broke.</p>
        <pre>{error.message}</pre>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
