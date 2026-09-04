begin;

select plan(16);

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
  'Insights never appear on a personal journal'
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
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$select public.set_written_moment_trashed(
    (select id from public.moments
      where kind = 'insight' and title = 'Huberman Lab — Circadian Toolkit'
      order by created_at desc limit 1),
    1, true
  )$$,
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
  $$select public.set_written_moment_trashed(
    (select id from public.moments
      where kind = 'insight' and title = 'Huberman Lab — Circadian Toolkit'
      order by created_at desc limit 1),
    2, false
  )$$,
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
