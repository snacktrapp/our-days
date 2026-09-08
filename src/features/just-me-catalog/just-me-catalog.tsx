"use client";

import { useState } from "react";
import { setJustMeCatalogPreferenceAction } from "./catalog-actions";
import type { JustMeCatalogViewModel } from "./catalog-items";

export function JustMeCatalog({
  model,
}: Readonly<{
  model: JustMeCatalogViewModel;
}>) {
  const [items, setItems] = useState(model.items);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (items.length === 0) return null;

  const toggle = async (itemId: (typeof items)[number]["id"]) => {
    const current = items.find((item) => item.id === itemId);
    if (!current || busyId) return;
    const nextEnabled = !current.enabled;
    setMessage(null);
    setItems((rows) =>
      rows.map((row) =>
        row.id === itemId ? { ...row, enabled: nextEnabled } : row,
      ),
    );
    if (!model.persist) return;
    setBusyId(itemId);
    const result = await setJustMeCatalogPreferenceAction({
      itemId,
      enabled: nextEnabled,
    });
    if (!result.ok) {
      setItems((rows) =>
        rows.map((row) =>
          row.id === itemId ? { ...row, enabled: current.enabled } : row,
        ),
      );
      setMessage(result.message);
    }
    setBusyId(null);
  };

  return (
    <section
      className="settings-section just-me-catalog"
      aria-labelledby="just-me-catalog-heading"
    >
      <div className="settings-heading">
        <span>Just me</span>
        <h2 id="just-me-catalog-heading">Timeline add-ons</h2>
        <p>
          Choose what can appear on your personal journal. Off means it stays
          locked and nothing new is delivered.
        </p>
      </div>
      {items.map((item) => (
        <button
          key={item.id}
          className="notification-preference-row just-me-catalog-row"
          type="button"
          role="switch"
          aria-checked={item.enabled}
          aria-label={item.title}
          disabled={busyId === item.id}
          onClick={() => {
            void toggle(item.id);
          }}
        >
          <span>
            <strong>{item.title}</strong>
            <small>{item.description}</small>
          </span>
          <span className="notification-switch" aria-hidden="true" />
        </button>
      ))}
      {message ? (
        <p className="notification-preference-message" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
