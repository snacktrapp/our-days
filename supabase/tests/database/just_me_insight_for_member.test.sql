begin;

select plan(26);

select is(
  (
    select namespace.nspname
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = class.relnamespace
     where class.relname = 'operations_just_me_insight_consent'
  ),
  'private',
  'Just me Insight consent stays outside the exposed schema'
);

select ok(
  (
    select class.relrowsecurity and class.relforcerowsecurity
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = class.relnamespace
     where namespace.nspname = 'private'
       and class.relname = 'operations_just_me_insight_consent'
  ),
  'Just me Insight consent forces row level security'
);

select is(
  (select count(*)::bigint from private.operations_just_me_insight_consent),
  0::bigint,
  'the migration seeds consent only for trappbrian@gmail.com'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.create_just_me_insight_for_member(uuid, uuid, text, text, text, date, timestamptz, text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'private.create_just_me_insight_for_member(uuid, uuid, text, text, text, date, timestamptz, text)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.create_just_me_insight_for_member(uuid, uuid, text, text, text, date, timestamptz, text)',
    'execute'
  )
  and not has_table_privilege(
    'anon', 'private.operations_just_me_insight_consent', 'select'
  )
  and not has_table_privilege(
    'authenticated', 'private.operations_just_me_insight_consent', 'select'
  ),
  'anonymous and public callers cannot execute the member Insight RPC or read consent'
);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values (
  '10000000-0000-4000-8000-000000000008',
  'tars-ops@example.test',
  statement_timestamp(),
  '{}'
);

insert into public.people (
  id, circle_id, display_name, profile_kind, accent_token, created_by_membership_id
) values (
  '30000000-0000-4000-8000-000000000010',
  '20000000-0000-4000-8000-000000000001',
  'Circle Operations',
  'account',
  'plum',
  '40000000-0000-4000-8000-000000000001'
);

insert into public.circle_memberships (
  id, circle_id, user_id, person_id, role, directory_kind, status
) values (
  '40000000-0000-4000-8000-000000000008',
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000008',
  '30000000-0000-4000-8000-000000000010',
  'organizer',
  'operations',
  'active'
);

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values
  (
    '72000000-0000-4000-8000-000000000031',
    '10000000-0000-4000-8000-000000000008',
    statement_timestamp(), statement_timestamp(),
    statement_timestamp() + interval '1 day'
  ),
  (
    '72000000-0000-4000-8000-000000000032',
    '10000000-0000-4000-8000-000000000001',
    statement_timestamp(), statement_timestamp(),
    statement_timestamp() + interval '1 day'
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);

select throws_ok(
  $$select public.create_just_me_insight_for_member(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'A quote',
    'A show'
  )$$,
  '22023',
  'Insight could not be created',
  'a signed-out caller cannot post a member Insight'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);

select throws_ok(
  $$select public.create_just_me_insight_for_member(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'A quote',
    'A show'
  )$$,
  '42501',
  'Insight could not be created',
  'an ordinary member cannot post a member Insight'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$select public.create_just_me_insight_for_member(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000003',
    'A quote',
    'A show'
  )$$,
  '42501',
  'Insight could not be created',
  'a non-Operations organizer cannot post a member Insight'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000008","session_id":"72000000-0000-4000-8000-000000000031"}',
  true
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000008', true);

select throws_ok(
  $$select public.create_just_me_insight_for_member(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'A quote',
    'A show'
  )$$,
  '42501',
  'Insight could not be created',
  'Operations cannot post into a journal that has not opted in'
);

select throws_ok(
  $$select public.create_just_me_insight_for_member(
    '20000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000006',
    'A quote',
    'A show'
  )$$,
  '42501',
  'Insight could not be created',
  'Operations cannot post into another circle'
);

select throws_ok(
  $$select public.create_just_me_insight_for_member(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000008',
    'A quote',
    'A show'
  )$$,
  '42501',
  'Insight could not be created',
  'Operations cannot post into a managed journal'
);

select throws_ok(
  $$select public.create_just_me_insight_for_member(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000004',
    'A quote',
    'A show'
  )$$,
  '42501',
  'Insight could not be created',
  'Operations cannot post into a revoked membership'
);

reset role;

insert into private.operations_just_me_insight_consent (user_id)
values ('10000000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000008","session_id":"72000000-0000-4000-8000-000000000031"}',
  true
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000008', true);

select ok(
  public.create_just_me_insight_for_member(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '  Morning light still belongs to Brian.  ',
    '  Huberman Lab — Just me  ',
    '  https://www.youtube.com/watch?v=nm1TxQj9IsQ&t=120  ',
    '2026-08-28'
  ) is not null,
  'Operations can post a Just me Insight for a consented member'
);

reset role;

select is(
  (
    select audience || '|' || coalesce(journal_person_id::text, '')
      || '|' || recorded_by_membership_id::text
      || '|' || created_by_operations_membership_id::text
      || '|' || title || '|' || body
      from public.moments
     where kind = 'insight' and title = 'Huberman Lab — Just me'
  ),
  'just_me||40000000-0000-4000-8000-000000000001|40000000-0000-4000-8000-000000000008|Huberman Lab — Just me|Morning light still belongs to Brian.',
  'the Insight is owned by the member and audited as Operations'
);

select ok(
  exists (
    select 1
      from private.audit_events
     where event_type = 'moment_created'
       and actor_membership_id = '40000000-0000-4000-8000-000000000008'
       and subject_id = (
         select id from public.moments
          where kind = 'insight' and title = 'Huberman Lab — Just me'
       )
  ),
  'the audit event attributes the post to Operations'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000008","session_id":"72000000-0000-4000-8000-000000000031"}',
  true
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000008', true);

select is(
  (
    select count(*)::bigint
      from public.list_timeline_moments('20000000-0000-4000-8000-000000000001')
     where moment_title = 'Huberman Lab — Just me'
  ),
  0::bigint,
  'the member Insight stays off the family feed for Operations'
);

select is(
  (
    select count(*)::bigint
      from public.list_timeline_moments(
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000010'
      )
     where moment_title = 'Huberman Lab — Just me'
  ),
  0::bigint,
  'the member Insight does not appear on Operations Just me'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","session_id":"72000000-0000-4000-8000-000000000032"}',
  true
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select is(
  (
    select moment_kind || '|' || coalesce(moment_journal_person_id::text, '')
      || '|' || coalesce(journal_person_name, '')
      || '|' || coalesce(source_url, '')
      || '|' || moment_audience
      || '|' || can_change::text
      from public.list_timeline_moments(
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001'
      )
     where moment_title = 'Huberman Lab — Just me'
  ),
  'insight|||https://www.youtube.com/watch?v=nm1TxQj9IsQ&t=120|just_me|true',
  'the member Just me timeline shows the Insight with system chrome'
);

select is(
  (
    select count(*)::bigint
      from public.list_all_timeline_moments()
     where moment_title = 'Huberman Lab — Just me'
  ),
  1::bigint,
  'the member all-timeline includes their Just me Insight'
);

select id as member_insight_id
  from public.moments
 where kind = 'insight' and title = 'Huberman Lab — Just me' \gset

select lives_ok(
  format(
    $$select public.reserve_video_moment(
      '20000000-0000-4000-8000-000000000001',
      null,
      '',
      null,
      '{}'::uuid[],
      '2026-08-28',
      'video/mp4',
      2233445,
      17000,
      null,
      null,
      '71000000-0000-4000-8000-000000000091',
      null,
      null,
      %L::uuid
    )$$,
    :'member_insight_id'
  ),
  'the member can attach a clip to the Operations-posted Insight'
);

select lives_ok(
  format(
    'select public.set_written_moment_trashed(%L, 1, true)',
    :'member_insight_id'
  ),
  'the member can trash the Insight'
);

select is(
  (
    select count(*)::bigint
      from public.list_timeline_moments(
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001'
      )
     where moment_title = 'Huberman Lab — Just me'
  ),
  0::bigint,
  'trashing removes the Insight from the member Just me feed'
);

select lives_ok(
  format(
    'select public.set_written_moment_trashed(%L, 2, false)',
    :'member_insight_id'
  ),
  'the member can restore the Insight'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);

select is(
  (
    select count(*)::bigint
      from public.list_all_timeline_moments()
     where moment_title = 'Huberman Lab — Just me'
  ),
  0::bigint,
  'another member cannot read the Just me Insight'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000008', true);

select throws_ok(
  $$select public.create_just_me_insight_for_member(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '',
    'A show'
  )$$,
  '22023',
  'Insight could not be created',
  'an empty quote is rejected'
);

select throws_ok(
  $$select public.create_just_me_insight_for_member(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'A quote',
    'A show',
    'http://example.test/insecure'
  )$$,
  '22023',
  'Insight could not be created',
  'http source URLs are rejected'
);

select throws_ok(
  $$update public.moments
       set created_by_operations_membership_id = null
     where title = 'Huberman Lab — Just me'$$,
  '42501',
  'permission denied for table moments',
  'authenticated clients cannot rewrite the Operations audit column'
);

select * from finish();
rollback;
