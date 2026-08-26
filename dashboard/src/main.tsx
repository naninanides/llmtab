import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import "./theme.css";

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
function applySystemTheme(): void {
  document.documentElement.classList.toggle("dark", systemDark.matches);
}
applySystemTheme();
systemDark.addEventListener("change", applySystemTheme);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
