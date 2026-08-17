"use client";

/**
 * UiVersionSwitch — the ONE place a real page branches between its legacy
 * and V2 presentation, given the SAME already-fetched data as props to
 * both (brief: "V2 should consume the SAME authoritative state as
 * legacy… do not duplicate reducers, API clients, game logic"). A Server
 * Component page fetches its data once, renders both `legacy` and `v2` as
 * already-built React nodes (each may itself be a Server Component — RSC
 * children can be handed to a Client Component as props without becoming
 * client components themselves), and this is the only client boundary that
 * decides which one actually reaches the DOM.
 *
 * Reads `useUiVersion()` — correct on the very first client render (see
 * `lib/ui-version.ts`), so there is no legacy-then-v2 flash for a visitor
 * who has already opted in.
 */

import type { ReactNode } from "react";
import { useUiVersion } from "@/lib/ui-version";

export interface UiVersionSwitchProps {
  legacy: ReactNode;
  v2: ReactNode;
}

export default function UiVersionSwitch({ legacy, v2 }: UiVersionSwitchProps) {
  const version = useUiVersion();
  return version === "v2" ? <>{v2}</> : <>{legacy}</>;
}
