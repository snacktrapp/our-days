-- New service-role-only helper for scripts/seed-app-review-demo.mjs.
-- Does not alter existing RLS policies or existing RPCs.
-- Writes only the fictional demo circle identified by demo_circle_id.

create function public.apply_app_review_demo(
  reviewer_user_id uuid,
  dry_run boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  demo_circle_id constant uuid := 'c1ec1e00-0000-4000-8000-a99e11e00001';
  organizer_membership_id constant uuid := 'c1ec1e00-0000-4000-8000-a99e11e00011';
  elena_person_id constant uuid := 'c1ec1e00-0000-4000-8000-a99e11e00021';
  andre_person_id constant uuid := 'c1ec1e00-0000-4000-8000-a99e11e00022';
  mateo_person_id constant uuid := 'c1ec1e00-0000-4000-8000-a99e11e00023';
  luz_person_id constant uuid := 'c1ec1e00-0000-4000-8000-a99e11e00024';
  demo_circle_name constant text := 'The Rivera Family (Demo)';
  reviewer_email text;
  existing_name text;
  demo_circle_exists boolean := false;
  foreign_membership boolean := false;
  demo_membership public.circle_memberships%rowtype;
  memberships jsonb := '[]'::jsonb;
  action_name text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'reason', 'service-role-required');
  end if;

  select users.email
    into reviewer_email
    from auth.users as users
   where users.id = reviewer_user_id;

  if reviewer_email is distinct from 'appreview@beelinetech.co' then
    return jsonb_build_object('ok', false, 'reason', 'reviewer-email');
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'circleId', membership.circle_id,
        'role', membership.role,
        'status', membership.status
      )
    ),
    '[]'::jsonb
  )
    into memberships
    from public.circle_memberships as membership
   where membership.user_id = reviewer_user_id;

  select exists (
    select 1
      from public.circle_memberships as membership
     where membership.user_id = reviewer_user_id
       and membership.circle_id is distinct from demo_circle_id
  )
    into foreign_membership;

  if foreign_membership then
    return jsonb_build_object(
      'ok', false,
      'reason', 'other-circle',
      'memberships', memberships
    );
  end if;

  select circle.name
    into existing_name
    from public.circles as circle
   where circle.id = demo_circle_id;
  demo_circle_exists := found;

  if demo_circle_exists and existing_name is distinct from demo_circle_name then
    return jsonb_build_object(
      'ok', false,
      'reason', 'marker-mismatch',
      'memberships', memberships
    );
  end if;

  if not demo_circle_exists and memberships <> '[]'::jsonb then
    return jsonb_build_object(
      'ok', false,
      'reason', 'marker-mismatch',
      'memberships', memberships
    );
  end if;

  if demo_circle_exists then
    select membership.*
      into demo_membership
      from public.circle_memberships as membership
     where membership.user_id = reviewer_user_id
       and membership.circle_id = demo_circle_id;
    if not found then
      return jsonb_build_object(
        'ok', false,
        'reason', 'reviewer-not-member',
        'memberships', memberships
      );
    end if;
    if demo_membership.role is distinct from 'organizer'
      or demo_membership.status is distinct from 'active' then
      return jsonb_build_object(
        'ok', false,
        'reason', 'reviewer-not-organizer',
        'memberships', memberships
      );
    end if;
    action_name := 'update';
  else
    action_name := 'create';
  end if;

  if coalesce(dry_run, false) then
    return jsonb_build_object(
      'ok', true,
      'action', action_name,
      'dryRun', true,
      'circleId', demo_circle_id,
      'memberships', memberships
    );
  end if;

  insert into public.circles (
    id, name, time_zone, created_by_membership_id
  )
  select
    demo_circle_id,
    demo_circle_name,
    'America/Los_Angeles',
    organizer_membership_id
  where not exists (
    select 1
      from public.circles as circle
     where circle.id = demo_circle_id
  );

  insert into public.people (
    id, circle_id, display_name, profile_kind, accent_token, created_by_membership_id
  )
  select
    seed.id,
    demo_circle_id,
    seed.display_name,
    seed.profile_kind,
    seed.accent_token,
    organizer_membership_id
  from (
    values
      (elena_person_id, 'Elena Rivera', 'account', 'clay'),
      (andre_person_id, 'Andre Rivera', 'managed', 'sage'),
      (mateo_person_id, 'Mateo Rivera', 'managed', 'gold'),
      (luz_person_id, 'Luz Rivera', 'managed', 'sky')
  ) as seed(id, display_name, profile_kind, accent_token)
  where not exists (
    select 1
      from public.people as person
     where person.id = seed.id
  );

  insert into public.circle_memberships (
    id, circle_id, user_id, person_id, role, status, directory_kind
  )
  select
    organizer_membership_id,
    demo_circle_id,
    reviewer_user_id,
    elena_person_id,
    'organizer',
    'active',
    'journal'
  where not exists (
    select 1
      from public.circle_memberships as membership
     where membership.circle_id = demo_circle_id
       and membership.user_id = reviewer_user_id
  );

  insert into public.person_guardians (
    id, circle_id, managed_person_id, guardian_membership_id, created_by_membership_id
  )
  select
    seed.id,
    demo_circle_id,
    seed.managed_person_id,
    organizer_membership_id,
    organizer_membership_id
  from (
    values
      ('c1ec1e00-0000-4000-8000-a99e11e00061'::uuid, andre_person_id),
      ('c1ec1e00-0000-4000-8000-a99e11e00062'::uuid, mateo_person_id),
      ('c1ec1e00-0000-4000-8000-a99e11e00063'::uuid, luz_person_id)
  ) as seed(id, managed_person_id)
  where not exists (
    select 1
      from public.person_guardians as guardian
     where guardian.id = seed.id
  );

  insert into public.moments (
    id, circle_id, journal_person_id, recorded_by_membership_id, kind, title, body,
    place_name, latitude, longitude, occurred_on, time_precision, audience
  )
  select
    seed.id,
    demo_circle_id,
    seed.journal_person_id,
    organizer_membership_id,
    seed.kind,
    seed.title,
    seed.body,
    seed.place_name,
    seed.latitude,
    seed.longitude,
    seed.occurred_on,
    'date',
    'family'
  from (
    values
      (
        'c1ec1e00-0000-4000-8000-a99e11e00031'::uuid,
        elena_person_id,
        'thought',
        null::text,
        'Sunday pancakes, a little burnt, and nobody minded.',
        null::text,
        null::double precision,
        null::double precision,
        '2026-09-07'::date
      ),
      (
        'c1ec1e00-0000-4000-8000-a99e11e00032'::uuid,
        mateo_person_id,
        'thought',
        null,
        'Mateo rode the whole block without the extra wheels.',
        null,
        null,
        null,
        '2026-09-12'::date
      ),
      (
        'c1ec1e00-0000-4000-8000-a99e11e00033'::uuid,
        luz_person_id,
        'thought',
        null,
        'Luz lost a tooth at breakfast and kept it in a blue cup.',
        null,
        null,
        null,
        '2026-09-14'::date
      ),
      (
        'c1ec1e00-0000-4000-8000-a99e11e00034'::uuid,
        elena_person_id,
        'thought',
        null,
        'Rain on the kitchen window while the soup finished.',
        null,
        null,
        null,
        '2026-09-18'::date
      ),
      (
        'c1ec1e00-0000-4000-8000-a99e11e00035'::uuid,
        mateo_person_id,
        'milestone',
        'Started kindergarten',
        'The first morning, with a blue backpack and a wave from the gate.',
        null,
        null,
        null,
        '2026-09-02'::date
      ),
      (
        'c1ec1e00-0000-4000-8000-a99e11e00036'::uuid,
        elena_person_id,
        'location',
        null,
        'We stayed until the shadows crossed the path.',
        'Riverside Park',
        34.0522,
        -118.2437,
        '2026-09-21'::date
      ),
      (
        'c1ec1e00-0000-4000-8000-a99e11e00037'::uuid,
        null,
        'insight',
        'Rosa Rivera',
        'Keep the ordinary days. They are the ones that stay.',
        null,
        null,
        null,
        '2026-09-28'::date
      )
  ) as seed(
    id, journal_person_id, kind, title, body, place_name, latitude, longitude, occurred_on
  )
  where not exists (
    select 1
      from public.moments as moment
     where moment.id = seed.id
  );

  insert into public.moment_notes (
    id, circle_id, moment_id, author_membership_id, body
  )
  select
    seed.id,
    demo_circle_id,
    seed.moment_id,
    organizer_membership_id,
    seed.body
  from (
    values
      (
        'c1ec1e00-0000-4000-8000-a99e11e00041'::uuid,
        'c1ec1e00-0000-4000-8000-a99e11e00032'::uuid,
        'We clapped the whole way down the block.'
      ),
      (
        'c1ec1e00-0000-4000-8000-a99e11e00042'::uuid,
        'c1ec1e00-0000-4000-8000-a99e11e00036'::uuid,
        'The light stayed soft until we walked home.'
      ),
      (
        'c1ec1e00-0000-4000-8000-a99e11e00043'::uuid,
        'c1ec1e00-0000-4000-8000-a99e11e00035'::uuid,
        'He held my hand at the gate, then let go.'
      )
  ) as seed(id, moment_id, body)
  where not exists (
    select 1
      from public.moment_notes as note
     where note.id = seed.id
  );

  insert into public.moment_reactions (
    id, circle_id, moment_id, author_membership_id, reaction_type
  )
  select
    seed.id,
    demo_circle_id,
    seed.moment_id,
    organizer_membership_id,
    'held-close'
  from (
    values
      (
        'c1ec1e00-0000-4000-8000-a99e11e00051'::uuid,
        'c1ec1e00-0000-4000-8000-a99e11e00031'::uuid
      ),
      (
        'c1ec1e00-0000-4000-8000-a99e11e00052'::uuid,
        'c1ec1e00-0000-4000-8000-a99e11e00033'::uuid
      ),
      (
        'c1ec1e00-0000-4000-8000-a99e11e00053'::uuid,
        'c1ec1e00-0000-4000-8000-a99e11e00034'::uuid
      )
  ) as seed(id, moment_id)
  where not exists (
    select 1
      from public.moment_reactions as reaction
     where reaction.id = seed.id
  );

  return jsonb_build_object(
    'ok', true,
    'action', action_name,
    'dryRun', false,
    'circleId', demo_circle_id
  );
end;
$$;

revoke all on function public.apply_app_review_demo(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.apply_app_review_demo(uuid, boolean)
  to service_role;
