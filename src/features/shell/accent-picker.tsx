"use client";

import { useSyncExternalStore } from "react";
import { SettingsRowCopy } from "@/features/family-settings/settings-directory";
import {
  accentPresets,
  applyAccent,
  readAccent,
  resetAccent,
  subscribeAccent,
} from "./terminal-accent";

export function AccentPicker() {
  const current = useSyncExternalStore(
    subscribeAccent,
    readAccent,
    () => "orange",
  );

  return (
    <div className="settings-row is-plain accent-picker-row">
      <SettingsRowCopy title="Accent" subtitle="This device only" />
      <button
        type="button"
        className="accent-reset"
        onClick={() => resetAccent()}
      >
        Reset
      </button>
      <div className="accent-swatches" role="radiogroup" aria-label="Accent">
        {accentPresets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            role="radio"
            className={`accent-swatch accent-swatch-${preset.id}`}
            aria-checked={current === preset.id}
            aria-label={preset.name}
            onClick={() => applyAccent(preset.id)}
          />
        ))}
      </div>
    </div>
  );
}
