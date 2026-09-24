"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import { momentSubmitHref } from "@/features/composer/post-to";
import {
  emptyOptimisticMediaUploadSnapshot,
  optimisticMediaUploadSnapshot,
  subscribeToOptimisticMediaUploads,
  type OptimisticMediaUpload,
} from "@/features/composer/optimistic-media-upload";
import {
  emptyOptimisticMomentSaveSnapshot,
  optimisticMomentSaveSnapshot,
  removeOptimisticMomentSave,
  retryOptimisticMomentSave,
  subscribeToOptimisticMomentSaves,
  type OptimisticMomentSave,
} from "@/features/composer/optimistic-moment-save";

export function pendingMomentVisible(
  input: Readonly<{
    audience: "family" | "just_me";
    journalPersonId: string;
    circleId: string | null;
    created: boolean;
    pathname: string;
    circleQuery: string | null;
  }>,
) {
  if (!input.created) return false;
  if (input.audience === "just_me") {
    return input.pathname === `/people/${input.journalPersonId}`;
  }
  if (input.pathname !== "/family") return false;
  if (!input.circleQuery) return true;
  return input.circleQuery === input.circleId;
}

function circleQuery() {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("circle");
}

function dateLabel(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function PendingMomentArticle({
  articleId,
  accent,
  initial,
  name,
  occurredOn,
  occurredTime,
  children,
}: Readonly<{
  articleId: string;
  accent: string;
  initial: string;
  name: string;
  occurredOn: string;
  occurredTime: string;
  children: React.ReactNode;
}>) {
  return (
    <article id={articleId} className="moment optimistic-written-moment">
      <div className="connection">
        <span className={`avatar-node dot-${accent}`} aria-hidden="true">
          {initial}
        </span>
        <span className="moment-meta">
          <strong>{name}</strong>
          <span>
            {dateLabel(occurredOn)}
            {occurredTime ? ` | ${occurredTime}` : ""}
          </span>
        </span>
      </div>
      {children}
    </article>
  );
}

function MediaPending({ upload }: Readonly<{ upload: OptimisticMediaUpload }>) {
  const articleId = upload.momentId
    ? `moment-${upload.momentId}`
    : `pending-${upload.id}`;
  return (
    <PendingMomentArticle
      articleId={articleId}
      accent={upload.journalPersonAccent}
      initial={upload.journalPersonInitial}
      name={upload.journalPersonName}
      occurredOn={upload.occurredOn}
      occurredTime={upload.occurredTime}
    >
      <div className="moment-card photo-card optimistic-media-card" aria-busy>
        <div className="photo-frame">
          {upload.kind === "video" ? (
            <video
              src={upload.previewUrl}
              muted
              playsInline
              preload="metadata"
            />
          ) : (
            // Device-local preview. It never leaves this browser.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={upload.previewUrl} alt="" />
          )}
        </div>
        <div className="card-copy">
          {upload.body ? <p>{upload.body}</p> : null}
          {upload.stage.state === "uploading" ? (
            <progress max={1} value={upload.stage.progress} />
          ) : null}
        </div>
      </div>
    </PendingMomentArticle>
  );
}

function WrittenPending({ save }: Readonly<{ save: OptimisticMomentSave }>) {
  const momentId =
    save.stage.state === "published" ? save.stage.momentId : undefined;
  const articleId = momentId ? `moment-${momentId}` : `pending-${save.id}`;
  const failed = save.stage.state === "failed";
  return (
    <PendingMomentArticle
      articleId={articleId}
      accent={save.journalPersonAccent}
      initial={save.journalPersonInitial}
      name={save.journalPersonName}
      occurredOn={save.occurredOn}
      occurredTime={save.occurredTime}
    >
      <div
        className="moment-card optimistic-written-card"
        aria-busy={save.stage.state === "saving"}
      >
        {save.title ? <h3>{save.title}</h3> : null}
        {save.body ? <p>{save.body}</p> : null}
        {failed ? (
          <div className="optimistic-written-actions">
            <button
              type="button"
              onClick={() => retryOptimisticMomentSave(save.id)}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => removeOptimisticMomentSave(save.id)}
            >
              Dismiss
            </button>
          </div>
        ) : null}
      </div>
    </PendingMomentArticle>
  );
}

export function PendingTimelineEntries() {
  const pathname = usePathname();
  const router = useRouter();
  const announced = useRef(new Set<string>());
  const scrolled = useRef(new Set<string>());
  const uploads = useSyncExternalStore(
    subscribeToOptimisticMediaUploads,
    optimisticMediaUploadSnapshot,
    emptyOptimisticMediaUploadSnapshot,
  );
  const saves = useSyncExternalStore(
    subscribeToOptimisticMomentSaves,
    optimisticMomentSaveSnapshot,
    emptyOptimisticMomentSaveSnapshot,
  );
  const query = circleQuery();
  const visibleUploads = uploads.filter(
    (upload) =>
      upload.stage.state !== "failed" &&
      pendingMomentVisible({
        audience: upload.audience,
        journalPersonId: upload.journalPersonId,
        circleId: upload.circleId,
        created: upload.created,
        pathname,
        circleQuery: query,
      }),
  );
  const visibleSaves = saves.filter((save) =>
    pendingMomentVisible({
      audience: save.audience,
      journalPersonId: save.journalPersonId,
      circleId: save.circleId,
      created: true,
      pathname,
      circleQuery: query,
    }),
  );

  useEffect(() => {
    const ids = [
      ...visibleUploads.map((upload) => upload.id),
      ...visibleSaves.map((save) => save.id),
    ];
    const fresh = ids.filter((id) => !scrolled.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) scrolled.current.add(id);
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [visibleSaves, visibleUploads]);

  useEffect(() => {
    const targets = [
      ...visibleUploads.flatMap((upload) =>
        upload.audience === "family" && upload.momentId
          ? [upload.momentId]
          : [],
      ),
      ...visibleSaves.flatMap((save) =>
        save.audience === "family" &&
        save.stage.state === "published" &&
        save.stage.momentId
          ? [save.stage.momentId]
          : [],
      ),
    ];
    for (const momentId of targets) {
      if (announced.current.has(momentId)) continue;
      if (!document.getElementById(`moment-${momentId}`)) continue;
      announced.current.add(momentId);
      const next = momentSubmitHref({
        editing: false,
        audience: "family",
        journalPersonId: "",
        stayHref: pathname,
        momentId,
      });
      const here = `${window.location.pathname}${window.location.search}`;
      if (here !== next) router.replace(next);
    }
  }, [pathname, router, visibleSaves, visibleUploads]);

  if (visibleUploads.length === 0 && visibleSaves.length === 0) return null;
  return (
    <>
      {visibleUploads.map((upload) => (
        <MediaPending key={upload.id} upload={upload} />
      ))}
      {visibleSaves.map((save) => (
        <WrittenPending key={save.id} save={save} />
      ))}
    </>
  );
}
