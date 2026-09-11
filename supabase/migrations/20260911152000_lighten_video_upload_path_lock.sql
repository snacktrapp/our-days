-- Video TUS checks this helper on every part. Row-locking the request on each
-- chunk adds avoidable latency under flaky mobile networks without buying extra
-- safety: the request row is not mutated here, and object_path is unique.

create or replace function private.video_upload_path_is_uploadable(
  requested_object_path text,
  requested_owner_id text,
  requested_user_metadata jsonb
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  target private.video_upload_requests%rowtype;
begin
  if (select auth.uid()) is null
    or requested_owner_id is distinct from (select auth.uid()::text) then
    return false;
  end if;

  select request.* into target
    from private.video_upload_requests as request
   where request.object_path = requested_object_path;

  return target.id is not null
    and target.state = 'upload_claimed'
    and target.upload_expires_at > statement_timestamp()
    and requested_user_metadata = jsonb_build_object(
      'video_request_id', target.id::text,
      'request_key', target.request_key::text,
      'expected_mime_type', target.expected_mime_type,
      'expected_size_bytes', target.expected_size_bytes,
      'duration_ms', target.duration_ms
    )
    and (select private.video_requester_is_authorized(target.id));
end;
$function$;

revoke all on function private.video_upload_path_is_uploadable(
  text,
  text,
  jsonb
) from public, anon, authenticated, service_role;

grant execute on function private.video_upload_path_is_uploadable(
  text,
  text,
  jsonb
) to authenticated, service_role;
