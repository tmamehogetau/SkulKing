import { h, render } from "preact";
import { App } from "./app.js";

const root = document.getElementById("root");
if (root) render(h(App, {}), root);
