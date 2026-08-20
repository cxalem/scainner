import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import "./index.css";

// Deliberately NO dark-mode handling: the app is single-theme (light) by
// design — the whole redesign (paper background, the 3D scene's studio
// look) is built around one palette, and following the OS preference made
// the app look different per machine. If dark mode ever comes back, it
// needs designed dark values, not just re-enabling the old class toggle.

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
