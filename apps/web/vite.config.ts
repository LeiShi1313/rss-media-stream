import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const apiProxyTarget = process.env.API_PROXY_TARGET ?? "http://localhost:4000";

export default defineConfig({
  root: "src/client",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    allowedHosts: ["rsszug.leishi.xyz"],
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
