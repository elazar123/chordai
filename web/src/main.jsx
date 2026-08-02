import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import App from "./App.jsx";
import { IS_STATIC } from "./lib/api.js";
import "./styles/global.css";
import "./styles/sheet.css";

const saved = localStorage.getItem("chordai-theme");
if (saved) document.documentElement.dataset.theme = saved;

// A static host has no server to rewrite /song/<id> back to index.html, so the
// published bundle keeps its routes in the URL hash instead.
const Router = IS_STATIC ? HashRouter : BrowserRouter;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Router>
      <App />
    </Router>
  </React.StrictMode>
);
