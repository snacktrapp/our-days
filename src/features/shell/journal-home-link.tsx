"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps, MouseEvent } from "react";
import {
  resolveJournalHref,
  useJournalNavigationMemory,
} from "./journal-navigation-memory";

export function JournalHomeLink({
  justMeHref,
  onJournalNavigate,
  ...props
}: Omit<ComponentProps<typeof Link>, "href" | "onClick"> & {
  justMeHref?: string;
  onJournalNavigate?: (href: string) => void;
}) {
  const router = useRouter();
  const { preferJustMe } = useJournalNavigationMemory();
  const href = preferJustMe ? resolveJournalHref(justMeHref) : "/family";
  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    // A streaming loading shell may paint the server's default before hydration
    // catches up. Resolve again at the click, never navigate using that default.
    const destination = resolveJournalHref(justMeHref);
    event.preventDefault();
    onJournalNavigate?.(destination);
    router.push(destination);
  }
  return <Link {...props} href={href} onClick={navigate} prefetch={false} />;
}
