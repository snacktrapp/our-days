-- Tighten video reserves to fit Supabase Free storage pressure:
-- - duration cap: 60 seconds (60000 ms)
-- - stored size backstop: 32 MiB
--
-- Keep the existing private.reserve_video_moment contract unchanged and enforce
-- the cap at the public upload entry point used by web clients.

create or replace function public.reserve_video_moment(
  circle_id uuid,
  journal_person_id uuid,
  body text,
  place_name text,
  tagged_person_ids uuid[],
  occurred_on date,
  expected_mime_type text,
  expected_size_bytes bigint,
  duration_ms integer,
  occurred_at timestamptz default null,
  occurred_timezone text default null,
  request_key uuid default null,
  audience text default null,
  circle_ids uuid[] default null,
  existing_moment_id uuid default null,
  mentioned_user_ids uuid[] default null,
  mention_starts integer[] default null,
  mention_ends integer[] default null
)
returns table (
  request_id uuid,
  moment_id uuid,
  bucket_id text,
  object_path text,
  state text,
  upload_expires_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  reserved record;
begin
  if duration_ms is null
    or duration_ms not between 1 and 60000
    or expected_size_bytes is null
    or expected_size_bytes not between 1 and 33554432 then
    raise exception using errcode = '22023',
      message = 'Video moment could not be prepared';
  end if;

  select * into reserved
  from private.reserve_video_moment(
    circle_id, journal_person_id, body, place_name, tagged_person_ids,
    occurred_on, expected_mime_type, expected_size_bytes, duration_ms,
    occurred_at, occurred_timezone, request_key, audience, existing_moment_id
  );
  if reserved.request_id is not null and existing_moment_id is null then
    perform private.store_media_request_circle_ids(
      'video', reserved.request_id, circle_ids
    );
  end if;
  if mentioned_user_ids is not null
    and existing_moment_id is null
    and reserved.moment_id is not null then
    perform private.apply_content_mentions(
      reserved.moment_id, null, mentioned_user_ids, mention_starts, mention_ends, btrim(body)
    );
  end if;
  return query
  select reserved.request_id, reserved.moment_id, reserved.bucket_id,
    reserved.object_path, reserved.state, reserved.upload_expires_at;
end;
$$;

revoke all on function public.reserve_video_moment(
  uuid, uuid, text, text, uuid[], date, text, bigint, integer, timestamptz,
  text, uuid, text, uuid[], uuid, uuid[], integer[], integer[]
) from public, anon;

grant execute on function public.reserve_video_moment(
  uuid, uuid, text, text, uuid[], date, text, bigint, integer, timestamptz,
  text, uuid, text, uuid[], uuid, uuid[], integer[], integer[]
) to authenticated;

notify pgrst, 'reload schema';
