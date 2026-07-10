import { registerRootComponent } from "expo";
import { AppRegistry } from "react-native";

import App from "./src/App";
import { NativeMenuRoot } from "./src/native/native-menu-root";

AppRegistry.registerComponent("NativeMenu", () => NativeMenuRoot);
registerRootComponent(App);
