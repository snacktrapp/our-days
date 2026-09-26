-- One set-based read for a timeline page, plus one photo-delivery read
-- for the signed-URL batch. Both stay security invoker on top of the
-- existing live-moment checks. They never raise serialization_failure.

create function public.enrich_timeline_page(moment_ids uuid[])
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  requested uuid[];
begin
  if coalesce(cardinality(moment_ids), 0) > 100 then
    raise exception 'Timeline page is too large' using errcode = '22023';
  end if;
  requested := coalesce(moment_ids, '{}'::uuid[]);

  return jsonb_build_object(
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', photo.id,
        'moment_id', photo.moment_id,
        'sort_order', photo.sort_order,
        'display_width', photo.display_width,
        'display_height', photo.display_height
      ) order by photo.moment_id, photo.sort_order, photo.id)
      from public.moment_photos as photo
      where photo.moment_id = any (requested)
    ), '[]'::jsonb),
    'videos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'moment_id', video.moment_id,
        'mime_type', video.mime_type,
        'duration_ms', video.duration_ms
      ) order by video.moment_id)
      from public.moment_videos as video
      where video.moment_id = any (requested)
    ), '[]'::jsonb),
    'posters', coalesce((
      select jsonb_agg(jsonb_build_object(
        'moment_id', poster.moment_id,
        'size_bytes', poster.size_bytes,
        'width_px', poster.width_px,
        'height_px', poster.height_px
      ) order by poster.moment_id)
      from public.moment_video_posters as poster
      where poster.moment_id = any (requested)
    ), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', note.id,
        'moment_id', note.moment_id,
        'author_membership_id', note.author_membership_id,
        'body', note.body,
        'revision', note.revision,
        'created_at', note.created_at
      ) order by note.created_at, note.id)
      from public.moment_notes as note
      where note.moment_id = any (requested)
        and note.trashed_at is null
    ), '[]'::jsonb),
    'reactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', reaction.id,
        'moment_id', reaction.moment_id,
        'author_membership_id', reaction.author_membership_id,
        'reaction_type', reaction.reaction_type,
        'created_at', reaction.created_at
      ) order by reaction.created_at, reaction.id)
      from public.moment_reactions as reaction
      where reaction.moment_id = any (requested)
        and reaction.removed_at is null
    ), '[]'::jsonb),
    'hearts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', heart.id,
        'note_id', heart.note_id,
        'moment_id', heart.moment_id,
        'author_membership_id', heart.author_membership_id,
        'created_at', heart.created_at
      ) order by heart.created_at, heart.id)
      from public.moment_note_reactions as heart
      where heart.moment_id = any (requested)
        and heart.removed_at is null
    ), '[]'::jsonb),
    'mentions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'mentioned_user_id', mention.mentioned_user_id,
        'start_offset', mention.start_offset,
        'end_offset', mention.end_offset,
        'display_name', mention.display_name,
        'active', mention.active,
        'moment_id', mention.moment_id,
        'note_id', mention.note_id
      ))
      from public.list_visible_content_mentions(requested) as mention
    ), '[]'::jsonb),
    'authors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'membership_id', author.membership_id,
        'display_name', author.display_name,
        'accent_token', author.accent_token,
        'person_id', author.person_id
      ))
      from public.visible_moment_authors((
        select coalesce(array_agg(distinct author_membership_id), '{}'::uuid[])
        from (
          select note.author_membership_id
            from public.moment_notes as note
           where note.moment_id = any (requested)
             and note.trashed_at is null
          union
          select reaction.author_membership_id
            from public.moment_reactions as reaction
           where reaction.moment_id = any (requested)
             and reaction.removed_at is null
          union
          select heart.author_membership_id
            from public.moment_note_reactions as heart
           where heart.moment_id = any (requested)
             and heart.removed_at is null
        ) as author_ids
      )) as author
    ), '[]'::jsonb)
  );
end;
$$;

create function public.get_photo_moments_delivery(moment_ids uuid[])
returns table (
  moment_id uuid,
  photo_id uuid,
  sort_order integer,
  bucket_id text,
  object_path text,
  output_mime_type text,
  output_size_bytes bigint,
  output_sha256_hex text,
  output_width integer,
  output_height integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if coalesce(cardinality(moment_ids), 0) > 100 then
    raise exception 'Timeline page is too large' using errcode = '22023';
  end if;

  return query
  select requested.moment_id,
    delivery.photo_id,
    delivery.sort_order,
    delivery.bucket_id,
    delivery.object_path,
    delivery.output_mime_type,
    delivery.output_size_bytes,
    delivery.output_sha256_hex,
    delivery.output_width,
    delivery.output_height
  from (
    select distinct requested_id as moment_id
      from unnest(coalesce(moment_ids, '{}'::uuid[])) as requested_id
  ) as requested
  cross join lateral private.get_photo_moment_delivery(requested.moment_id)
    as delivery;
end;
$$;

revoke all on function public.enrich_timeline_page(uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.get_photo_moments_delivery(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.enrich_timeline_page(uuid[]) to authenticated;
grant execute on function public.get_photo_moments_delivery(uuid[])
  to authenticated;
