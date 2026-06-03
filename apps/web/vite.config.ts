import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiProxyTarget = process.env.API_PROXY_TARGET ?? "http://localhost:4000";

export default defineConfig({
  root: "src/client",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "^/api(?:/|$)": apiProxyTarget,
      "^/events(?:/|$)": apiProxyTarget
    }
  },
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true
  }
});
