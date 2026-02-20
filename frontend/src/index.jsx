// src/index.jsx - React app entry point
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Register service worker for offline clock in/out support
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js")
      .then(reg => {
        console.log("[SW] Registered:", reg.scope);
        reg.sync?.register("sync-queue").catch(() => {});
      })
      .catch(err => console.warn("[SW] Registration failed:", err));
  });
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
