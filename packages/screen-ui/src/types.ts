import type { MessageKey, Translator } from "./i18n";

export type Status = Record<string, unknown>;

export interface Action {
  method: string;
  title: string;
  request?: Record<string, unknown>;
}

export interface AppConfig {
  extension: string;
  title: string;
  icon: string;
  statusMethod: string;
  kind: "network" | "wake" | "power";
  actions: readonly Action[];
  /** Service state machine decides which commands are currently available. */
  actionEnabled?(state: Status, action: Action): boolean;
  /** Label a state-dependent operation such as cancelling an unfinished login. */
  actionLabel?(state: Status, action: Action): MessageKey | undefined;
  /** Business rules belong to the extension; return a localized error key. */
  validateAction?(state: Status, action: Action): MessageKey | undefined;
}

export interface StatusPresentation {
  statusLabel(state: Status, translate: Translator): string;
  summary(state: Status, translate: Translator): string;
  /** Only the contributor knows whether its current browser login is active. */
  authorization?(state: Status): Authorization;
}

export interface Authorization {
  state: "idle" | "starting" | "pending" | "connecting" | "expired" | "timed-out" | "failed";
  url?: string;
  code?: string;
}
