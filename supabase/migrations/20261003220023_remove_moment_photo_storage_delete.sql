-- Removing a photo from a post failed with 42501 "Direct deletion from storage
-- tables is not allowed" after Supabase added storage.protect_delete. The web
-- Edit "Remove photo" and the iOS edit both call remove_moment_photo. This keeps
-- the same checks and only allows this function's own storage.objects deletes
-- for the rest of the transaction.
create or replace function private.remove_moment_photo(
  requested_moment_id uuid,
  requested_photo_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_moment public.moments%rowtype;
  target_photo public.moment_photos%rowtype;
  remaining integer;
  target_original private.photo_originals%rowtype;
  target_derivative private.photo_display_derivatives%rowtype;
begin
  if current_user_id is null or requested_moment_id is null
    or requested_photo_id is null then
    raise exception using errcode = '22023',
      message = 'That photo could not be removed';
  end if;

  select moment.* into target_moment
    from public.moments as moment
   where moment.id = requested_moment_id
     and moment.kind = 'photo'
     and moment.trashed_at is null
   for update;
  if target_moment.id is null
    or not (select private.current_family_session_is_live())
    or not (select private.can_manage_person(
      target_moment.circle_id, target_moment.journal_person_id
    )) then
    raise exception using errcode = '42501',
      message = 'That photo could not be removed';
  end if;

  select photo.* into target_photo
    from public.moment_photos as photo
   where photo.id = requested_photo_id
     and photo.moment_id = requested_moment_id
   for update;
  if target_photo.id is null then
    raise exception using errcode = '22023',
      message = 'That photo could not be removed';
  end if;

  select count(*)::integer into remaining
    from public.moment_photos as photo
   where photo.moment_id = requested_moment_id;
  if remaining <= 1 then
    raise exception using errcode = '22023',
      message = 'A photo entry needs at least one photo';
  end if;

  select original.* into target_original
    from private.photo_originals as original
   where original.id = target_photo.original_id;
  select derivative.* into target_derivative
    from private.photo_display_derivatives as derivative
   where derivative.id = target_photo.display_derivative_id;

  perform set_config('our_days.allow_moment_photo_delete', 'on', true);
  delete from public.moment_photos
   where id = target_photo.id
     and moment_id = requested_moment_id;

  perform set_config('storage.allow_delete_query', 'true', true);

  if target_derivative.storage_object_id is not null then
    delete from storage.objects as object
     where object.id = target_derivative.storage_object_id
        or (
          object.bucket_id = target_derivative.bucket_id
          and object.name = target_derivative.object_path
        );
  end if;
  if target_original.storage_object_id is not null then
    delete from storage.objects as object
     where object.id = target_original.storage_object_id
        or (
          object.bucket_id = target_original.bucket_id
          and object.name = target_original.object_path
        );
  end if;
end;
$$;

