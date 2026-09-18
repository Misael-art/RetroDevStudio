import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/index.css";

declare global {
  interface Window {
    __RDS_BUILD_COMMIT__?: string;
  }
}

window.__RDS_BUILD_COMMIT__ = import.meta.env.VITE_RDS_BUILD_COMMIT ?? "unknown";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
