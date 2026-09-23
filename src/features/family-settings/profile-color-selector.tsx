"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  profileColors,
  type ProfileColorToken,
} from "@/features/profile-color";
import type { AccentToken } from "@/features/accent-token";
import type { ProfileColorResult } from "./profile-color-action";
import {
  SettingsAvatar,
  SettingsChevron,
  SettingsGroup,
  SettingsRowCopy,
  SettingsRowTrail,
  SettingsSection,
} from "./settings-directory";

export function ProfileColorSelector({
  name,
  initial,
  accent,
  saveColor,
  preview = false,
}: {
  name: string;
  initial: string;
  accent: AccentToken;
  saveColor: (color: unknown) => Promise<ProfileColorResult>;
  preview?: boolean;
}) {
  const router = useRouter();
  const original =
    profileColors.find((color) => color.accent === accent)?.token ?? null;
  const [saved, setSaved] = useState(original);
  const [selected, setSelected] = useState<ProfileColorToken | null>(original);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const color = profileColors.find((item) => item.token === selected);
  const colorName = color?.name ?? "Current color";

  return (
    <SettingsSection aria-label="Your profile">
      <SettingsGroup>
        <details className="profile-color-details">
          <summary className="settings-row profile-color-summary">
            <SettingsAvatar
              accent={color?.accent ?? accent}
              initial={initial}
            />
            <SettingsRowCopy
              title={name}
              subtitle={`Your color · ${colorName}`}
            />
            <SettingsRowTrail>
              <SettingsChevron />
            </SettingsRowTrail>
          </summary>
          <div className="profile-color-expanded">
            <fieldset className="profile-color-swatch-grid" disabled={pending}>
              <legend className="sr-only">Profile color</legend>
              {profileColors.map((option) => (
                <label
                  key={option.token}
                  className="profile-color-swatch-label"
                >
                  <input
                    type="radio"
                    name="profile-color"
                    value={option.token}
                    checked={selected === option.token}
                    aria-label={option.name}
                    onChange={() => {
                      setSelected(option.token);
                      setMessage("");
                    }}
                  />
                  <span
                    className={`profile-color-swatch dot-${option.accent}${selected === option.token ? " is-selected" : ""}`}
                    aria-hidden="true"
                  >
                    {selected === option.token ? "✓" : ""}
                  </span>
                </label>
              ))}
            </fieldset>
            {preview ? (
              <p className="profile-color-hint">
                Design preview only. Your account is unchanged.
              </p>
            ) : null}
            <button
              type="button"
              className="profile-color-save"
              disabled={pending || !selected || selected === saved}
              onClick={() => {
                if (!selected) return;
                const choice = selected;
                setMessage("");
                startTransition(async () => {
                  try {
                    const result = await saveColor(choice);
                    setFailed(!result.ok);
                    setMessage(result.message);
                    if (result.ok) {
                      setSaved(choice);
                      if (!preview) router.refresh();
                    }
                  } catch {
                    setFailed(true);
                    setMessage("Your color couldn’t be saved. Try again.");
                  }
                });
              }}
            >
              {pending ? "Saving…" : "Save color"}
            </button>
          </div>
        </details>
      </SettingsGroup>
      {message ? (
        <p role={failed ? "alert" : "status"} className="profile-color-hint">
          {message}
        </p>
      ) : null}
    </SettingsSection>
  );
}
