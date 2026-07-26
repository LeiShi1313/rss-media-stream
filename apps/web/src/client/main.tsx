import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./i18n.js";
import "./styles/app.css";
import "./styles/shell.css";
import { TooltipProvider } from "./components/ui/index.js";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </React.StrictMode>
);
