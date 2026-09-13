-- Family photo delivery signs a short-lived URL the same way videos do.
-- Display SELECT used to require storage.allow_any_operation(object.get_authenticated,
-- object.get_authenticated_info, object.upload). createSignedUrl is
-- storage.object.sign, so that allow-list denied the mint even when the
-- blob existed and get_photo_moment_delivery succeeded. Videos never gated
-- family SELECT on an operation name. Keep the operation allow-list on
-- originals (validator reads) and on INSERT/upload.

drop policy our_days_display_select_exact_active_derivative_lease
  on storage.objects;

create policy our_days_display_select_exact_active_derivative_lease
on storage.objects
for select
to authenticated
using (
  bucket_id = 'our-days-display'
  and (select private.photo_display_path_is_readable(name))
);

drop policy our_days_storage_objects_closed_until_media_phase
  on storage.objects;

create policy our_days_storage_objects_closed_until_media_phase
on storage.objects
as restrictive
for all
to anon, authenticated
using (
  bucket_id not in ('our-days-originals', 'our-days-display')
  or (
    bucket_id = 'our-days-originals'
    and (select storage.allow_any_operation(array[
      'object.get_authenticated', 'object.get_authenticated_info',
      'object.upload'
    ]::text[]))
    and (
      (select private.photo_original_path_is_readable(name))
      or (select private.photo_derivative_source_is_readable(
        name, id, version
      ))
    )
  )
  or (
    bucket_id = 'our-days-display'
    and (select private.photo_display_path_is_readable(name))
  )
)
with check (
  bucket_id not in ('our-days-originals', 'our-days-display')
  or (
    bucket_id = 'our-days-originals'
    and (select storage.allow_any_operation(array['object.upload']::text[]))
    and (select private.photo_original_path_is_uploadable(
      name, owner_id, user_metadata
    ))
  )
  or (
    bucket_id = 'our-days-display'
    and (select storage.allow_any_operation(array['object.upload']::text[]))
    and (select private.photo_display_path_is_uploadable(
      name, owner_id, user_metadata
    ))
  )
);
