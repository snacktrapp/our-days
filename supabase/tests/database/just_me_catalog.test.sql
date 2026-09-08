begin;

select plan(12);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '10000000-0000-4000-8000-000000000003',
    'role', 'authenticated',
    'email', 'member-a@example.test'
  )::text,
  true
);

select is(
  (select array_agg(item_id order by item_id)
     from public.list_just_me_catalog_preferences()),
  array['insights.huberman_faith']::text[],
  'members without the preview email only see Insights in the catalog'
);

select throws_ok(
  $$select public.set_just_me_catalog_preference('journal.daily_prayer', true)$$,
  '42501',
  'Catalog preference could not be saved',
  'Daily prayer cannot be enabled without the preview email'
);

select ok(
  public.set_just_me_catalog_preference('insights.huberman_faith', true),
  'a member can subscribe to Huberman faith Insights'
);

select is(
  (select count(*)::bigint
     from public.list_timeline_moments(
       '20000000-0000-4000-8000-000000000001',
       '30000000-0000-4000-8000-000000000003'
     )
    where moment_kind = 'insight'),
  3::bigint,
  'subscribing delivers seeded Huberman faith Insights to Just me'
);

select is(
  (select count(*)::bigint
     from public.list_timeline_moments(
       '20000000-0000-4000-8000-000000000001'
     )
    where moment_kind = 'insight'
      and moment_title like 'Huberman Lab — %'),
  0::bigint,
  'subscribed Insights stay off the family feed'
);

select ok(
  public.set_just_me_catalog_preference('insights.huberman_faith', false),
  'a member can turn the Insights source off'
);

select is(
  (select enabled from public.list_just_me_catalog_preferences()
    where item_id = 'insights.huberman_faith'),
  false,
  'the Insights toggle persists off'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '10000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'email', 'trappbrian@gmail.com'
  )::text,
  true
);

select is(
  (select array_agg(item_id order by item_id)
     from public.list_just_me_catalog_preferences()),
  array['insights.huberman_faith', 'journal.daily_prayer']::text[],
  'the preview email sees Daily prayer in the catalog'
);

select ok(
  public.set_just_me_catalog_preference('journal.daily_prayer', true),
  'the preview email can enable Daily prayer'
);

select ok(
  public.create_family_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'thought',
    null,
    'OD:daily-prayer' || chr(10) || '{"v":1,"ref":"Ezekiel 36:26","verse":"A new heart.","thanks":["light","",""],"showUp":"","prayers":["peace","",""],"affirm":""}',
    null,
    '{}',
    '2026-09-08',
    null,
    null,
    null,
    null,
    'just_me'
  ) is not null,
  'a Daily prayer thought can be saved to Just me'
);

select is(
  (select body from public.find_daily_prayer_moment('2026-09-08')),
  'OD:daily-prayer' || chr(10) || '{"v":1,"ref":"Ezekiel 36:26","verse":"A new heart.","thanks":["light","",""],"showUp":"","prayers":["peace","",""],"affirm":""}',
  'today prayer lookup returns the Just me entry'
);

select throws_ok(
  $$select public.create_family_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'thought',
    null,
    'OD:daily-prayer' || chr(10) || '{"v":1,"ref":"Ezekiel 36:26","verse":"Duplicate.","thanks":["two","",""],"showUp":"","prayers":["", "", ""],"affirm":""}',
    null,
    '{}',
    '2026-09-08',
    null,
    null,
    null,
    null,
    'just_me'
  )$$,
  '23505',
  null,
  'the same recorder cannot save two Daily prayer entries on one day'
);

select * from finish();
rollback;
