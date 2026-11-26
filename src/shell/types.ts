export type AppView = "icons" | "list";

/** Launcher metadata only. The host loads that app's own PocketJS bundle. */
export interface ScreenApp {
  id: string;
  title: string;
  icon: string;
  controls: string[];
}

/** Icon pages are columns×rows; machines override via machine.json. */
export interface LauncherLayout {
  iconColumns: number;
  iconRows: number;
  iconSize: number;
  listRows: number;
}

export const DEFAULT_LAUNCHER: LauncherLayout = {
  iconColumns: 3,
  iconRows: 3,
  iconSize: 52,
  listRows: 4,
};

export function parseLauncher(raw: string): LauncherLayout {
  const next = { ...DEFAULT_LAUNCHER };
  if (!raw.trim()) return next;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const columns = Number(parsed.icon_columns);
    const rows = Number(parsed.icon_rows);
    const size = Number(parsed.icon_size);
    const listRows = Number(parsed.list_rows);
    if (columns >= 1 && columns <= 5) next.iconColumns = Math.floor(columns);
    if (rows >= 1 && rows <= 5) next.iconRows = Math.floor(rows);
    if (size >= 24 && size <= 96) next.iconSize = Math.floor(size);
    if (listRows >= 1 && listRows <= 8) next.listRows = Math.floor(listRows);
  } catch {
    /* keep defaults */
  }
  return next;
}

export function launcherPageSize(list: boolean, layout: LauncherLayout): number {
  return list ? layout.listRows : layout.iconColumns * layout.iconRows;
}

export function launcherAppPages(count: number, list: boolean, layout: LauncherLayout): number {
  const size = Math.max(1, launcherPageSize(list, layout));
  return Math.max(1, Math.ceil(count / size));
}
