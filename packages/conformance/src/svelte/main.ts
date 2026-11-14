import { mount } from "svelte";
import App from "./App.svelte";
import "./zubra";
import "../shared/styles.css";

mount(App, { target: document.getElementById("app")! });
