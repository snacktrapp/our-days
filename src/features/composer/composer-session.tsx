"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { MomentComposerViewModel } from "./composer-view-model";
import { createConnectedEntryDraftActions } from "./entry-draft-client";
import {
  MomentComposer,
  type ComposerEditDraft,
  type SaveFamilyMomentAction,
} from "./moment-composer";
import type { CreatePostToHomeContext, CreatePostToIntent } from "./post-to";
import { createPreviewEntryDraftActions } from "./preview-entry-drafts";

type ComposerSessionValue = Readonly<{
  openCreate: (
    trigger?: HTMLButtonElement | null,
    intent?: CreatePostToIntent | null,
  ) => void;
  toggleCreate: (
    trigger?: HTMLButtonElement | null,
    intent?: CreatePostToIntent | null,
  ) => void;
  isOpen: boolean;
  openEdit: (
    draft: ComposerEditDraft,
    trigger?: HTMLButtonElement | null,
  ) => void;
}>;

const ComposerSessionContext = createContext<ComposerSessionValue | null>(null);

export function useComposerSession() {
  return useContext(ComposerSessionContext);
}

export function ComposerSessionProvider({
  model,
  createMomentAction,
  homeContext,
  children,
}: Readonly<{
  model: MomentComposerViewModel;
  createMomentAction?: SaveFamilyMomentAction;
  homeContext?: CreatePostToHomeContext;
  children: ReactNode;
}>) {
  const [open, setOpen] = useState(false);
  const [editDraft, setEditDraft] = useState<ComposerEditDraft | null>(null);
  const [createIntent, setCreateIntent] = useState<CreatePostToIntent | null>(
    null,
  );
  const draftActions = useMemo(
    () =>
      model.experience === "connected-family" ||
      model.experience === "connected-written"
        ? createConnectedEntryDraftActions()
        : createPreviewEntryDraftActions(),
    [model.experience],
  );
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const dismissRef = useRef<(() => void) | null>(null);
  const loadDraftsRef = useRef<(() => void) | null>(null);

  const openCreate = useCallback(
    (
      trigger?: HTMLButtonElement | null,
      intent?: CreatePostToIntent | null,
    ) => {
      setEditDraft(null);
      setCreateIntent(intent ?? null);
      returnFocusRef.current = trigger ?? null;
      setOpen(true);
      queueMicrotask(() => loadDraftsRef.current?.());
    },
    [],
  );

  const toggleCreate = useCallback(
    (
      trigger?: HTMLButtonElement | null,
      intent?: CreatePostToIntent | null,
    ) => {
      if (open) {
        dismissRef.current?.();
        return;
      }
      openCreate(trigger, intent);
    },
    [open, openCreate],
  );

  const openEdit = useCallback(
    (draft: ComposerEditDraft, trigger?: HTMLButtonElement | null) => {
      setEditDraft(draft);
      returnFocusRef.current = trigger ?? null;
      setOpen(true);
    },
    [],
  );

  const registerDismiss = useCallback((dismiss: (() => void) | null) => {
    dismissRef.current = dismiss;
  }, []);

  const registerDraftsLoad = useCallback((load: (() => void) | null) => {
    loadDraftsRef.current = load;
  }, []);

  const value = useMemo(
    () => ({ openCreate, toggleCreate, isOpen: open, openEdit }),
    [open, openCreate, openEdit, toggleCreate],
  );

  return (
    <ComposerSessionContext.Provider value={value}>
      {children}
      <MomentComposer
        key={
          editDraft
            ? `edit:${editDraft.momentId}`
            : `create:${createIntent?.defaultAudience ?? "home"}:${homeContext?.kind ?? "none"}:${homeContext?.circleId ?? model.circleId ?? ""}`
        }
        model={model}
        homeContext={homeContext}
        createIntent={createIntent}
        open={open}
        editDraft={editDraft}
        returnFocusRef={returnFocusRef}
        registerDismiss={registerDismiss}
        registerDraftsLoad={registerDraftsLoad}
        onRequestClose={() => {
          setOpen(false);
          setEditDraft(null);
        }}
        saveFamilyMoment={createMomentAction}
        draftActions={draftActions}
      />
    </ComposerSessionContext.Provider>
  );
}
