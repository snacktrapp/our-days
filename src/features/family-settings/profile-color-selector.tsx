"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  profileColors,
  type ProfileColorToken,
} from "@/features/profile-color";
import type { AccentToken } from "@/features/accent-token";
import type { ProfileColorResult } from "./profile-color-action";
import { SettingsDisclosure } from "./settings-disclosure";

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
  return (
    <section
      className="settings-section profile-color-settings"
      aria-labelledby="profile-color-heading"
    >
      <div className="settings-heading">
        <span>Profile</span>
        <h2 id="profile-color-heading">Your profile</h2>
      </div>
      <div className="profile-color-preview">
        <span
          className={`person-avatar dot-${color?.accent ?? accent}`}
          aria-hidden="true"
        >
          {initial}
        </span>
        <strong>{name}</strong>
        <span>{color?.name ?? "Current color"}</span>
      </div>
      <SettingsDisclosure
        className="profile-color-disclosure"
        label="Change color"
      >
        <fieldset className="profile-color-options" disabled={pending}>
          <legend className="sr-only">Profile color</legend>
          {profileColors.map((option) => (
            <label key={option.token}>
              <input
                type="radio"
                name="profile-color"
                value={option.token}
                checked={selected === option.token}
                onChange={() => {
                  setSelected(option.token);
                  setMessage("");
                }}
              />
              <span
                className={`profile-color-swatch dot-${option.accent}`}
                aria-hidden="true"
              >
                {selected === option.token ? "✓" : ""}
              </span>
              <span>{option.name}</span>
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
      </SettingsDisclosure>
      {message ? (
        <p role={failed ? "alert" : "status"} className="profile-color-hint">
          {message}
        </p>
      ) : null}
    </section>
  );
}
