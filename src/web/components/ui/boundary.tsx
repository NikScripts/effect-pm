import * as React from "react";

interface State {
  readonly error: Error | null;
}

/**
 * Catch a render error in one widget so it shows the message inline instead of
 * blanking the whole screen. Wrap each detail widget while we stabilise.
 */
export class Boundary extends React.Component<{ readonly label: string; readonly children: React.ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override render(): React.ReactNode {
    if (this.state.error !== null) {
      return (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
          <strong>{this.props.label} failed:</strong> {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}
