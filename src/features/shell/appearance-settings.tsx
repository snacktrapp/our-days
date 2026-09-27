"use client";

import { useSyncExternalStore } from "react";
import {
  SettingsRowCopy,
  SettingsRowTrail,
} from "@/features/family-settings/settings-directory";
import { AccentPicker } from "./accent-picker";
import {
  applyAppearance,
  readAppearance,
  subscribeAppearance,
  type AppearanceId,
} from "./retro-theme";

const options = [
  { id: "standard", name: "Standard" },
  { id: "retro", name: "Retro" },
] as const satisfies readonly { id: AppearanceId; name: string }[];

export function AppearanceSettings() {
  const appearance = useSyncExternalStore(
    subscribeAppearance,
    readAppearance,
    () => "standard" as const,
  );

  return (
    <>
      <div className="settings-row is-plain">
        <SettingsRowCopy title="Theme" subtitle="This device only" />
        <SettingsRowTrail>
          <div
            className="appearance-choices"
            role="radiogroup"
            aria-label="Theme"
          >
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={appearance === option.id}
                onClick={() => applyAppearance(option.id)}
              >
                {option.name}
              </button>
            ))}
          </div>
        </SettingsRowTrail>
      </div>
      {appearance === "retro" ? <AccentPicker /> : null}
    </>
  );
}
