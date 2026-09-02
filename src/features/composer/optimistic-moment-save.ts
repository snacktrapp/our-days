"use client";

import type { AccentToken } from "@/features/accent-token";
import type {
  EditableMomentKind,
  MomentActionResult,
} from "@/features/moments/moment-action-types";

export type OptimisticMomentMode = EditableMomentKind | "bible-verse";

export type OptimisticMomentSave = Readonly<{
  id: string;
  circleId: string | null;
  mode: OptimisticMomentMode;
  title: string;
  body: string;
  placeName: string;
  taggedPeopleLabel: string;
  occurredOn: string;
  occurredTime: string;
  journalPersonName: string;
  journalPersonInitial: string;
  journalPersonAccent: AccentToken;
  stage:
    | Readonly<{ state: "saving" }>
    | Readonly<{ state: "failed"; message: string }>;
}>;

type StartOptimisticMomentSaveInput = Readonly<{
  circleId: string | null;
  mode: OptimisticMomentMode;
  title: string;
  body: string;
  placeName: string;
  taggedPeopleLabel: string;
  occurredOn: string;
  occurredTime: string;
  person: Readonly<{
    name: string;
    initial: string;
    accent: AccentToken;
  }>;
  save: () => Promise<MomentActionResult>;
  onPublished: () => void;
}>;

let saves: readonly OptimisticMomentSave[] = [];
const emptySaves: readonly OptimisticMomentSave[] = [];
const listeners = new Set<() => void>();
const tasks = new Map<
  string,
  Pick<StartOptimisticMomentSaveInput, "save" | "onPublished">
>();

function emit() {
  for (const listener of listeners) listener();
}

function updateSave(id: string, stage: OptimisticMomentSave["stage"]) {
  if (!tasks.has(id)) return;
  saves = saves.map((save) => (save.id === id ? { ...save, stage } : save));
  emit();
}

async function runSave(id: string) {
  const task = tasks.get(id);
  if (!task) return;
  updateSave(id, { state: "saving" });
  try {
    const result = await task.save();
    if (!tasks.has(id)) return;
    if (!result.ok) {
      updateSave(id, { state: "failed", message: result.message });
      return;
    }
    removeOptimisticMomentSave(id);
    task.onPublished();
  } catch {
    updateSave(id, {
      state: "failed",
      message: "That moment could not be saved. Try again.",
    });
  }
}

export function startOptimisticMomentSave(
  input: StartOptimisticMomentSaveInput,
) {
  const id = crypto.randomUUID();
  saves = [
    {
      id,
      circleId: input.circleId,
      mode: input.mode,
      title: input.title,
      body: input.body,
      placeName: input.placeName,
      taggedPeopleLabel: input.taggedPeopleLabel,
      occurredOn: input.occurredOn,
      occurredTime: input.occurredTime,
      journalPersonName: input.person.name,
      journalPersonInitial: input.person.initial,
      journalPersonAccent: input.person.accent,
      stage: { state: "saving" },
    },
    ...saves,
  ];
  tasks.set(id, { save: input.save, onPublished: input.onPublished });
  emit();
  void runSave(id);
  return id;
}

export function optimisticMomentSaveSnapshot() {
  return saves;
}

export function emptyOptimisticMomentSaveSnapshot() {
  return emptySaves;
}

export function subscribeToOptimisticMomentSaves(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function retryOptimisticMomentSave(id: string) {
  if (tasks.has(id)) void runSave(id);
}

export function removeOptimisticMomentSave(id: string) {
  tasks.delete(id);
  saves = saves.filter((save) => save.id !== id);
  emit();
}

export function clearOptimisticMomentSaves() {
  tasks.clear();
  saves = [];
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener(
    "our-days:clear-private-state",
    clearOptimisticMomentSaves,
  );
}
