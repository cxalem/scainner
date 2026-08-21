import { defineConfig } from "vitest/config";
import path from "path";

// Separate from vite.config.ts on purpose: that file carries Tauri-dev-only
// server settings (fixed port, HMR host) that tests have no business
// touching. Vitest only needs the same "@" -> src alias so test files can
// import with the same paths the app code uses.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
  },
});
