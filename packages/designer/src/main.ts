import { mount } from "svelte";
import App from "./App.svelte";
import "./zubra";
import "./styles.css";

export default mount(App, { target: document.getElementById("app")! });
