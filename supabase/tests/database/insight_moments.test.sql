begin;

select plan(24);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$select public.create_family_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'insight', 'Huberman Lab', 'A personal insight should be rejected.',
    null, '{}', '2026-08-28'
  )$$,
  '22023', 'Moment could not be created',
  'the ordinary family composer cannot create an Insight'
);

select ok(
  public.create_insight_moment(
    '20000000-0000-4000-8000-000000000001',
    '  Morning sunlight is the most powerful stimulus for setting your circadian rhythm.  ',
    '  Huberman Lab — Circadian Toolkit  ',
    '  https://www.youtube.com/watch?v=nm1TxQj9IsQ&t=120  ',
    '2026-08-28'
  ) is not null,
  'an organizer can create a circle Insight'
);

select is(
  (select kind || '|' || title || '|' || body || '|' || coalesce(source_url, '')
     || '|' || coalesce(journal_person_id::text, '')
   from public.moments
   where kind = 'insight' and title = 'Huberman Lab — Circadian Toolkit'
   order by created_at desc
   limit 1),
  'insight|Huberman Lab — Circadian Toolkit|Morning sunlight is the most powerful stimulus for setting your circadian rhythm.|https://www.youtube.com/watch?v=nm1TxQj9IsQ&t=120|',
  'Insight payload is normalized and has no journal person'
);

select is(
  (select moment_kind || '|' || moment_title || '|' || coalesce(source_url, '')
     || '|' || coalesce(moment_journal_person_id::text, '')
     || '|' || coalesce(journal_person_name, '')
   from public.list_timeline_moments('20000000-0000-4000-8000-000000000001')
   where moment_kind = 'insight'
     and moment_title = 'Huberman Lab — Circadian Toolkit'
   limit 1),
  'insight|Huberman Lab — Circadian Toolkit|https://www.youtube.com/watch?v=nm1TxQj9IsQ&t=120||',
  'the family timeline returns Insights without a person byline'
);

select is(
  (select count(*)::bigint from public.list_timeline_moments(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001'
  ) where moment_kind = 'insight'),
  0::bigint,
  'family Insights never appear on a personal journal'
);

select ok(
  public.create_insight_moment(
    '20000000-0000-4000-8000-000000000001',
    'Only I should see this one.',
    'Private operations note',
    null,
    '2026-08-28',
    null,
    null,
    'just_me',
    null
  ) is not null,
  'an organizer can create a Just me Insight'
);

select is(
  (select audience || '|' || coalesce(journal_person_id::text, '')
     from public.moments
    where kind = 'insight' and title = 'Private operations note'
    order by created_at desc
    limit 1),
  'just_me|',
  'Just me Insights remain byline-less with a null journal person'
);

select is(
  (select count(*)::bigint from public.list_timeline_moments(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001'
  ) where moment_kind = 'insight'
      and moment_title = 'Private operations note'),
  1::bigint,
  'Just me Insights appear on the author journal'
);

select is(
  (select count(*)::bigint from public.list_timeline_moments(
    '20000000-0000-4000-8000-000000000001'
  ) where moment_kind = 'insight'
      and moment_title = 'Private operations note'),
  0::bigint,
  'Just me Insights stay off the circle feed'
);

select throws_ok(
  $$select public.create_insight_moment(
    '20000000-0000-4000-8000-000000000001',
    'A quote',
    'A show',
    'javascript:alert(1)',
    '2026-08-28'
  )$$,
  '22023', 'Insight could not be created',
  'non-https source URLs are rejected'
);

select throws_ok(
  $$select public.create_insight_moment(
    '20000000-0000-4000-8000-000000000001',
    'A quote',
    'A show',
    'http://example.test/insecure',
    '2026-08-28'
  )$$,
  '22023', 'Insight could not be created',
  'http source URLs are rejected'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);

select throws_ok(
  $$select public.create_insight_moment(
    '20000000-0000-4000-8000-000000000001',
    'Members cannot curate Insights.',
    'A show',
    null,
    '2026-08-28'
  )$$,
  '42501', 'Insight could not be created',
  'an ordinary member cannot create an Insight'
);

select is(
  (select count(*)::bigint from public.list_all_timeline_moments()
    where moment_kind = 'insight'
      and moment_title = 'Private operations note'),
  0::bigint,
  'an ordinary member cannot read another person''s Just me Insight'
);

select throws_ok(
  $$select public.set_written_moment_trashed(
    (select id from public.moments
      where kind = 'insight' and title = 'Huberman Lab — Circadian Toolkit'
      order by created_at desc limit 1),
    1, true
  )$$,
  '42501', 'Moment could not be changed',
  'an ordinary member cannot trash an Insight'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', true);

select throws_ok(
  $$select public.create_insight_moment(
    '20000000-0000-4000-8000-000000000001',
    'Wrong family.',
    'A show',
    null,
    '2026-08-28'
  )$$,
  '42501', 'Insight could not be created',
  'an organizer cannot create an Insight in another circle'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);

select ok(
  public.create_insight_moment(
    '20000000-0000-4000-8000-000000000002',
    'Harbor and Cedar should both see this.',
    'Shared circle insight',
    null,
    '2026-08-28',
    null,
    null,
    'family',
    array[
      '20000000-0000-4000-8000-000000000002'::uuid,
      '20000000-0000-4000-8000-000000000001'::uuid
    ]
  ) is not null,
  'a dual-circle organizer can target one Insight to real circles'
);

select is(
  (select linked_circle_ids
     from public.list_timeline_moments('20000000-0000-4000-8000-000000000002')
    where moment_title = 'Shared circle insight'
    limit 1),
  array[
    '20000000-0000-4000-8000-000000000001'::uuid,
    '20000000-0000-4000-8000-000000000002'::uuid
  ],
  'targeted Insight stores real linked circles instead of a fake Family label'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);

select is(
  (select count(*)::bigint from public.list_timeline_moments(
    '20000000-0000-4000-8000-000000000001'
  ) where moment_title = 'Shared circle insight'),
  1::bigint,
  'members of a targeted circle can read a shared Insight'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select id as insight_moment_id
  from public.moments
 where kind = 'insight' and title = 'Huberman Lab — Circadian Toolkit'
 order by created_at desc
 limit 1 \gset

select lives_ok(
  format(
    'select public.set_written_moment_trashed(%L, 1, true)',
    :'insight_moment_id'
  ),
  'an organizer can trash an Insight'
);

select is(
  (select count(*)::bigint from public.list_timeline_moments(
    '20000000-0000-4000-8000-000000000001'
  ) where moment_kind = 'insight'
    and moment_title = 'Huberman Lab — Circadian Toolkit'),
  0::bigint,
  'a trashed Insight leaves the family timeline'
);

select ok(
  exists (
    select 1 from public.list_manageable_trashed_written_moments(
      '20000000-0000-4000-8000-000000000001'
    ) where moment_kind = 'insight'
      and moment_title = 'Huberman Lab — Circadian Toolkit'
  ),
  'organizers can see trashed Insights'
);

select lives_ok(
  format(
    'select public.set_written_moment_trashed(%L, 2, false)',
    :'insight_moment_id'
  ),
  'an organizer can restore an Insight'
);

select throws_ok(
  $$select public.create_insight_moment(
    '20000000-0000-4000-8000-000000000001',
    '',
    'A show',
    null,
    '2026-08-28'
  )$$,
  '22023', 'Insight could not be created',
  'an empty quote is rejected'
);

select ok(
  public.create_insight_moment(
    '20000000-0000-4000-8000-000000000001',
    'Curiosity is a form of courage.',
    'The Diary of a CEO',
    null,
    '2026-08-27'
  ) is not null,
  'an Insight may omit a source URL'
);

select * from finish();
rollback;
