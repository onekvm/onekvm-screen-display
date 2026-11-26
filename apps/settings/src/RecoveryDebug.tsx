import { AdbDialog } from "../../../src/init/AdbDialog";
import { DiagnosticsDialog } from "../../../src/init/DiagnosticsDialog";
import { screenSize } from "./device";
import type { RecoveryDebugControls } from "./useRecoveryDebug";

/** The recovery page reuses the initialization dialogs and their translations. */
export function RecoveryDebug(props: { controls: RecoveryDebugControls; lang: string; rotary: boolean }) {
  const c = props.controls;
  return <>
    {c.diagnostics.value ? <DiagnosticsDialog
      width={screenSize().w} height={screenSize().h} lang={props.lang}
      state={c.diagnostics.value} error={c.error.value} focus={c.focus.value}
      rotary={props.rotary} onStart={c.start} onClose={c.close}
    /> : null}
    {c.adb.visible.value ? <AdbDialog
      width={screenSize().w} height={screenSize().h} lang={props.lang}
      state={c.adb.state.value} focus={c.adb.focus.value} rotary={props.rotary}
      onPrimary={c.adb.primary} onSecondary={c.adb.secondary} onClose={c.adb.close}
    /> : null}
  </>;
}
