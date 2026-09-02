import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { queryClient } from "./lib/query";
import { I18nProvider } from "./i18n";
import { BRAND } from "./brand";
import "./index.css";

document.title = BRAND.name;



ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <MotionConfig reducedMotion="user">
            <App />
          </MotionConfig>
        </QueryClientProvider>
      </I18nProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
