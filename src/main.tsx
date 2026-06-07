import { register } from "@inkibra/tauri-plugin-ota";
import { mountApp } from "./app/main-app";

register(() => {
  mountApp();
});
