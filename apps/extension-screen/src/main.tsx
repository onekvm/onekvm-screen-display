import { mount } from "@pocketjs/framework/vue-vapor";
import App from "./App";
import Power from "./Power";
import { CONFIG } from "./config";
mount(() => CONFIG.kind === "power" ? <Power /> : <App />);
