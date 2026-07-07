import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { PetOverlay } from "./PetOverlay";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const Root = params.get("view") === "pet" ? PetOverlay : App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
