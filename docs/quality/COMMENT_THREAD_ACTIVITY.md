# Comment-thread activity — 2026-09-20

After the separate header-resume fix (#105), later comments notify both the
post author and people who previously commented on the still-accessible post.
The existing authenticated Activity loader handles this; no schema change,
privileged key, push subscription, or new service is involved.

## Behavior

- Own comments are excluded across all of the viewer's memberships.
- An author who also commented receives one item, not two.
- Thread participation starts at the earliest remaining live comment. Earlier
  replies and unrelated posts do not become comment notifications.
- Existing row-level access rules exclude deleted or inaccessible parents.
- Links choose a currently joined circle, including for old shared posts.
- The shared header checks Activity every 30 seconds while visible. Its first
  successful check, background resume, and reconnection establish a silent
  baseline. Server timestamps prevent old newly-visible items replaying.
- Later comments produce one brief, tappable banner with a dismiss button;
  it expires after seven seconds. New banners do not appear over open dialogs.
- Activity and the unread heart dot update from the same response. Opening the
  drawer still performs its existing explicit refresh and error/retry flow.
- These are in-app banners, not phone/lock-screen push notifications.

## Verification

- 159 focused shell/data/local-journal/route tests passed.
- Mobile Chromium: new banner plus Activity refresh/retry tests passed.
- Browser test caught and fixed the header intercepting banner dismissal.
- Authenticated local PostgREST query verified the exact composite parent join
  with a non-empty synthetic comment fixture under existing RLS.
- Production build and private-artifact scan passed.
- Installed-iPhone background/resume behavior is not certified by these tests.

No polling runs while hidden; requests are abortable and failures are silent
outside the explicitly opened Activity drawer. No historical notification
backlog is presented as banners.
