import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import "./index.css";

// Follow the OS dark-mode preference.
const mq = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => document.documentElement.classList.toggle("dark", mq.matches);
applyTheme();
mq.addEventListener("change", applyTheme);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
