begin;

select plan(6);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values (
  '10000000-0000-4000-8000-000000000008',
  'tars-ops@example.test',
  statement_timestamp(),
  '{}'
);

insert into public.people (
  id,
  circle_id,
  display_name,
  profile_kind,
  accent_token,
  created_by_membership_id
)
values (
  '30000000-0000-4000-8000-000000000010',
  '20000000-0000-4000-8000-000000000001',
  'Circle Operations',
  'account',
  'plum',
  '40000000-0000-4000-8000-000000000001'
);

insert into public.circle_memberships (
  id,
  circle_id,
  user_id,
  person_id,
  role,
  directory_kind,
  status
)
values (
  '40000000-0000-4000-8000-000000000008',
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000008',
  '30000000-0000-4000-8000-000000000010',
  'organizer',
  'operations',
  'active'
);

select is(
  (
    select role || '|' || directory_kind
      from public.circle_memberships
     where id = '40000000-0000-4000-8000-000000000008'
  ),
  'organizer|operations',
  'Operations is an organizer membership with a directory label'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000008', true);

select ok(
  public.create_insight_moment(
    '20000000-0000-4000-8000-000000000001',
    'Operations can post a system Insight.',
    'Our Days Operations',
    null,
    '2026-08-28'
  ) is not null,
  'Operations can create a circle Insight'
);

select ok(
  public.create_family_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000008',
    'thought', null, 'Operations keeps organizer journal write access.',
    null, '{}', '2026-08-28'
  ) is not null,
  'Operations can write a managed child journal like an organizer'
);

select lives_ok(
  $$select public.set_membership_role(
    '40000000-0000-4000-8000-000000000003',
    'organizer'
  )$$,
  'Operations can change family roles like an organizer'
);

select is(
  (select moment_kind || '|' || coalesce(journal_person_name, '')
     from public.list_timeline_moments('20000000-0000-4000-8000-000000000001')
    where moment_title = 'Our Days Operations'
    limit 1),
  'insight|',
  'Operations Insights stay byline-less on the family timeline'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);

select throws_ok(
  $$select public.create_insight_moment(
    '20000000-0000-4000-8000-000000000001',
    'Members still cannot curate Insights.',
    'A show',
    null,
    '2026-08-28'
  )$$,
  '42501', 'Insight could not be created',
  'an ordinary member still cannot create an Insight'
);

select * from finish();
rollback;
