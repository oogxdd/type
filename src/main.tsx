import { register } from "@inkibra/tauri-plugin-ota";
import { mountApp } from "./mainApp";

register(() => {
  mountApp();
});
