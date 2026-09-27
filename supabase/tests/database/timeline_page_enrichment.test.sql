begin;

select plan(8);

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values (
  '72000000-0000-4000-8000-000000000031',
  '10000000-0000-4000-8000-000000000001',
  statement_timestamp(),
  statement_timestamp(),
  statement_timestamp() + interval '1 day'
);

select ok(
  has_function_privilege(
    'authenticated', 'public.enrich_timeline_page(uuid[])', 'EXECUTE'
  ) and has_function_privilege(
    'authenticated', 'public.get_photo_moments_delivery(uuid[])', 'EXECUTE'
  ) and not has_function_privilege(
    'anon', 'public.enrich_timeline_page(uuid[])', 'EXECUTE'
  ) and not has_function_privilege(
    'anon', 'public.get_photo_moments_delivery(uuid[])', 'EXECUTE'
  ),
  'only authenticated callers can batch a timeline page'
);

select ok(
  position(
    '40001' in pg_get_functiondef('public.enrich_timeline_page(uuid[])'::regprocedure)
  ) = 0
  and position(
    '40001' in pg_get_functiondef(
      'public.get_photo_moments_delivery(uuid[])'::regprocedure
    )
  ) = 0,
  'timeline batch functions do not raise serialization_failure'
);

set local role anon;
select throws_ok(
  $$select public.enrich_timeline_page('{}'::uuid[])$$,
  '42501',
  'permission denied for function enrich_timeline_page',
  'anon cannot enrich a timeline page'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","session_id":"72000000-0000-4000-8000-000000000031"}',
  true
);
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true
);

select throws_ok(
  $$select public.enrich_timeline_page(
    array_fill('60000000-0000-4000-8000-000000000007'::uuid, array[101])
  )$$,
  '22023',
  'Timeline page is too large',
  'a page larger than 100 moments is rejected with PT-safe 22023'
);

select is(
  (
    select count(*)
      from jsonb_array_elements(
        public.enrich_timeline_page(array[
          '60000000-0000-4000-8000-000000000007'::uuid,
          '60000000-0000-4000-8000-000000000006'::uuid
        ]) -> 'notes'
      ) as note
     where note->>'moment_id' = '60000000-0000-4000-8000-000000000007'
       and note->>'body' = 'The delighted laugh afterward is worth remembering.'
  ),
  1::bigint,
  'one call returns the visible note on the page'
);

select is(
  (
    select count(*)
      from jsonb_array_elements(
        public.enrich_timeline_page(array[
          '60000000-0000-4000-8000-000000000007'::uuid,
          '60000000-0000-4000-8000-000000000006'::uuid
        ]) -> 'notes'
      ) as note
     where note->>'moment_id' = '60000000-0000-4000-8000-000000000006'
  ),
  0::bigint,
  'a batch does not leak a moment from another circle'
);

select is(
  (
    select count(*)
      from jsonb_array_elements(
        public.enrich_timeline_page(array[
          '60000000-0000-4000-8000-000000000007'::uuid
        ]) -> 'reactions'
      ) as reaction
     where reaction->>'reaction_type' = 'held-close'
  ),
  1::bigint,
  'the same call returns the visible reaction'
);

select is(
  (
    select count(*)
      from public.get_photo_moments_delivery(array[
        '60000000-0000-4000-8000-000000000007'::uuid
      ])
  ),
  0::bigint,
  'a thought has no photo delivery rows'
);

select * from finish();
rollback;
