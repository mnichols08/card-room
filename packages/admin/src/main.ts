import { provideBrowserGlobalErrorListeners } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { App } from "./app/app";

bootstrapApplication(App, { providers: [provideBrowserGlobalErrorListeners()] }).catch((error) => console.error(error));
