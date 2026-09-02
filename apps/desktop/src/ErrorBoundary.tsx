import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[scainner] UI crashed:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-lg font-semibold">Something broke in the interface</p>
        <p className="text-sm text-muted-foreground">
          The car connection and recording are unaffected — this is just a UI error.
        </p>
        <pre className="max-w-full overflow-auto rounded-md bg-muted p-3 text-left text-xs">
          {this.state.error.message}
        </pre>
        <button
          className="mt-2 h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          onClick={() => this.setState({ error: null })}
        >
          Try to recover
        </button>
      </div>
    );
  }
}
