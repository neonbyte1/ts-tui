import type { TUI } from "../../mod.ts";
import { createContext, useContext } from "./signal.ts";

/** The TUI a component tree is mounted on; set by `mount`. */
export const TUIContext = createContext<TUI | undefined>(undefined);

/** What redraws after a reactive update: the mounted TUI, or nothing outside `mount`. */
export interface Host {
  requestRender(): void;
}

const DETACHED: Host = { requestRender() {} };

/** The host of the current owner, captured once by components that redraw later. */
export function useHost(): Host {
  return useContext(TUIContext) ?? DETACHED;
}
