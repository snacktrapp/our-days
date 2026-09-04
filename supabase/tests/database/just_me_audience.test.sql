begin;

select plan(15);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);

select lives_ok(
  $$select public.create_family_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000003',
    'thought', null, 'A Just Me morning stays on my journal.',
    null, '{}', '2026-08-29', null, null, null, null, 'just_me'
  )$$,
  'a member can create a Just Me moment on their own journal'
);

select is(
  (
    select audience
      from public.moments
     where body = 'A Just Me morning stays on my journal.'
  ),
  'just_me',
  'Just Me is stored on the moment row'
);

select is(
  (
    select count(*)::bigint
      from public.list_timeline_moments(
        '20000000-0000-4000-8000-000000000001'
      )
     where body = 'A Just Me morning stays on my journal.'
  ),
  0::bigint,
  'the author does not see Just Me on the family feed'
);

select is(
  (
    select count(*)::bigint
      from public.list_timeline_moments(
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000003'
      )
     where body = 'A Just Me morning stays on my journal.'
  ),
  1::bigint,
  'the author sees Just Me on their personal journal'
);

select is(
  (
    select count(*)::bigint
      from public.list_timeline_moments(
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001'
      )
     where body = 'A Just Me morning stays on my journal.'
  ),
  0::bigint,
  'Just Me never appears on someone else''s journal for the author'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select is(
  (
    select count(*)::bigint
      from public.moments
     where body = 'A Just Me morning stays on my journal.'
  ),
  0::bigint,
  'an organizer cannot select another member''s Just Me row'
);

select is(
  (
    select count(*)::bigint
      from public.list_timeline_moments(
        '20000000-0000-4000-8000-000000000001'
      )
     where body = 'A Just Me morning stays on my journal.'
  ),
  0::bigint,
  'the family feed never leaks another member''s Just Me moment'
);

select is(
  (
    select count(*)::bigint
      from public.list_timeline_moments(
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000003'
      )
     where body = 'A Just Me morning stays on my journal.'
  ),
  0::bigint,
  'another person''s journal never includes their Just Me moments'
);

select throws_ok(
  $$select public.create_family_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000008',
    'thought', null, 'Just Me cannot land on a child journal.',
    null, '{}', '2026-08-29', null, null, null, null, 'just_me'
  )$$,
  '42501',
  'Moment could not be created',
  'Just Me cannot be written into another person''s journal'
);

select is(
  (
    select count(*)::bigint
      from public.list_memory_moments(
        '20000000-0000-4000-8000-000000000001',
        2026
      )
     where body = 'A Just Me morning stays on my journal.'
  ),
  0::bigint,
  'family memories never include Just Me rows'
);

select public.create_family_moment(
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'thought', null, 'A family note that can become Just Me.',
  null, '{}', '2026-08-29'
) as flip_moment_id \gset

select public.set_moment_reaction(:'flip_moment_id', 'held-close') is not null;

select is(
  public.update_family_moment(
    :'flip_moment_id',
    (select revision from public.moments where id = :'flip_moment_id'),
    null,
    'A family note that can become Just Me.',
    null,
    '{}',
    '2026-08-29',
    null,
    null,
    null,
    null,
    'just_me'
  ) is not null,
  true,
  'the author can flip a moment on their journal from Family to Just Me'
);

select is(
  (
    select count(*)::bigint
      from public.moment_reactions
     where moment_id = :'flip_moment_id'
       and removed_at is null
  ),
  1::bigint,
  'Family to Just Me keeps existing reactions'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select throws_ok(
  format(
    'select public.set_moment_reaction(%L, %L)',
    :'flip_moment_id',
    'made-me-smile'
  ),
  '42501',
  'Response could not be saved',
  'only the author can react while a moment is Just Me'
);

select throws_ok(
  format(
    'select public.create_moment_note(%L, %L)',
    :'flip_moment_id',
    'A family comment'
  ),
  '42501',
  'Note could not be saved',
  'only the author can comment while a moment is Just Me'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select lives_ok(
  format(
    'select public.set_moment_reaction(%L, %L)',
    :'flip_moment_id',
    'remember-this'
  ),
  'the author can still react to their Just Me moment'
);

select * from finish();
rollback;
