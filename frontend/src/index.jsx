// src/index.jsx - React app entry point
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Only register service worker on web — not in Capacitor native APK
// The SW intercepts fetch requests inside the WebView and causes login failures
const isNativeApp = !!(window.Capacitor?.isNativePlatform?.()) || 
  document.URL.indexOf('capacitor://') === 0 ||
  document.URL.indexOf('https://localhost') === 0;

if ("serviceWorker" in navigator && !isNativeApp) {
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
