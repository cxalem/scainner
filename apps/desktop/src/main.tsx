import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { queryClient } from "./lib/query";
import "./index.css";

// Deliberately NO dark-mode handling: the app is single-theme (light) by
// design — the whole redesign (paper background, the 3D scene's studio
// look) is built around one palette, and following the OS preference made
// the app look different per machine. If dark mode ever comes back, it
// needs designed dark values, not just re-enabling the old class toggle.

// No DevTools: dead weight in a shipped desktop bundle (decisions-plan.md).

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
