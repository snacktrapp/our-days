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
import {
  MomentComposer,
  type ComposerEditDraft,
  type SaveFamilyMomentAction,
} from "./moment-composer";

type ComposerSessionValue = Readonly<{
  openCreate: (trigger?: HTMLButtonElement | null) => void;
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
  children,
}: Readonly<{
  model: MomentComposerViewModel;
  createMomentAction?: SaveFamilyMomentAction;
  children: ReactNode;
}>) {
  const [open, setOpen] = useState(false);
  const [editDraft, setEditDraft] = useState<ComposerEditDraft | null>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);

  const openCreate = useCallback((trigger?: HTMLButtonElement | null) => {
    setEditDraft(null);
    returnFocusRef.current = trigger ?? null;
    setOpen(true);
  }, []);

  const openEdit = useCallback(
    (draft: ComposerEditDraft, trigger?: HTMLButtonElement | null) => {
      setEditDraft(draft);
      returnFocusRef.current = trigger ?? null;
      setOpen(true);
    },
    [],
  );

  const value = useMemo(
    () => ({ openCreate, openEdit }),
    [openCreate, openEdit],
  );

  return (
    <ComposerSessionContext.Provider value={value}>
      {children}
      <MomentComposer
        key={editDraft ? `edit:${editDraft.momentId}` : "create"}
        model={model}
        open={open}
        editDraft={editDraft}
        returnFocusRef={returnFocusRef}
        onRequestClose={() => {
          setOpen(false);
          setEditDraft(null);
        }}
        saveFamilyMoment={createMomentAction}
      />
    </ComposerSessionContext.Provider>
  );
}
