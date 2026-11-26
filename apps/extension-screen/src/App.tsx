import { ExtensionApp, type Status, type Translator } from "../../../packages/screen-ui/src";
import { CONFIG } from "./config";

function statusLabel(state: Status, t: Translator) {
  return t(state.online === true ? "online" : "offline");
}

export default function App() {
  return <ExtensionApp config={CONFIG} statusLabel={statusLabel} summary={statusLabel} />;
}
