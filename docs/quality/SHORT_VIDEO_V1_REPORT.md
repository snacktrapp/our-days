# Short video v1 (PD-004)

Date: 2026-09-07

Status: live composer + Home timeline wiring on the existing Phase 4E private video foundation. This is not a transcode, poster, export, or physical-iPhone completion claim.

## Decision

PD-004 is accepted: one short clip per moment, about 60 seconds, MP4/MOV/M4V/WebM, at most 100 MB. Video is a memory type on the center-line timeline, not a social feed.

## What shipped

- Live Add Moment keeps the existing **Photo or video** media card (Activity sheet chrome: handle + title, Save commits). Choosing a clip switches the draft to a video moment; one clip only.
- Save does not wait for iPhone decode. Select → Save returns to Home immediately; poster/duration inspect and upload continue from the toast. Composer hard-blocks only real rejects (type, size, already-known duration over ~60s).
- Connected upload reuses `reserve_video_moment` → direct TUS to `our-days-videos` → `finalize_video_moment`. Local journal uses `/api/media/local/video` and now carries the same Just Me / family audience as photos.
- Timeline cards show a captured first-frame poster (or a dark mat) plus a play badge — never a black `<video>` void. Scrolling does not autoplay. One tap opens the lightbox and starts playback.
- Fullscreen **Done** sits in a top safe-area chrome/scrim above the video, not floating over the picture.
- Circle and Just Me visibility follow the same moment-audience rules as photos.

## Out of scope (unchanged)

Reels/stories chrome, autoplay feeds, multi-clip albums, trimmer/editor UI, People/Memories redesign, multi-group changes, transcoded derivatives/posters, and video export/purge.

## Remaining gates

- Physical current iPhone Safari and installed-PWA playback, 4K/HDR/HEVC input, and poor-connectivity TUS recovery.
- Server-side poster/derivative generation and metadata stripping for recorded clips. The client now captures a first-frame JPEG during prep for the current session.
- Export of original video bytes and verified purge of originals, resumable state, and cache copies.

The isolated `/quality/video-feasibility` route remains a local inspection preview. It is not the product path.
