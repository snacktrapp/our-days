import type { EntryDraftActions } from "./entry-drafts";

export function createConnectedEntryDraftActions(): EntryDraftActions {
  return {
    async list() {
      try {
        const { listEntryDraftsAction } = await import("./entry-draft-actions");
        return listEntryDraftsAction();
      } catch {
        return [];
      }
    },
    async load(id) {
      try {
        const { loadEntryDraftAction } = await import("./entry-draft-actions");
        return loadEntryDraftAction(id);
      } catch {
        return null;
      }
    },
    async save(input) {
      try {
        const { saveEntryDraftAction } = await import("./entry-draft-actions");
        return saveEntryDraftAction(input);
      } catch {
        return { ok: false, message: "That draft could not be saved." };
      }
    },
    async remove(id) {
      try {
        const { deleteEntryDraftAction } =
          await import("./entry-draft-actions");
        return deleteEntryDraftAction(id);
      } catch {
        return { ok: false, message: "That draft could not be deleted." };
      }
    },
  };
}
