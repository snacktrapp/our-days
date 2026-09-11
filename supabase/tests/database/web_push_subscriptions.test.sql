begin;

select plan(23);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select ok(
  public.save_web_push_subscription(
    'https://push.example.test/member-one',
    repeat('A', 87),
    repeat('B', 22)
  ) is not null,
  'an active member can save their own push subscription'
);

reset role;
select is(
  (
    select count(*)::bigint
      from private.web_push_subscriptions
     where membership_id = '40000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'the saved subscription is stored for that membership'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select is(
  (
    select count(*)::bigint
      from public.list_web_push_deliveries(
        'moment',
        '60000000-0000-4000-8000-000000000003'
      )
  ),
  1::bigint,
  'a family post notifies the other member who opted in, not the author'
);

select is(
  (
    select actor_name || '|' || moment_kind
      from public.list_web_push_deliveries(
        'moment',
        '60000000-0000-4000-8000-000000000003'
      )
  ),
  'A Organizer Two|location',
  'delivery copy uses the actor name and moment kind only'
);

select is(
  (
    select count(*)::bigint
      from public.list_web_push_deliveries(
        'moment',
        '60000000-0000-4000-8000-000000000001'
      )
  ),
  0::bigint,
  'a member cannot list deliveries for someone else''s moment'
);

select public.save_web_push_subscription(
  'https://push.example.test/member-two',
  repeat('C', 87),
  repeat('D', 22)
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);

select public.create_moment_note(
  '60000000-0000-4000-8000-000000000001',
  'A later detail from another member.'
);

select is(
  (
    select endpoint
      from public.list_web_push_deliveries(
        'note',
        '60000000-0000-4000-8000-000000000001'
      )
  ),
  'https://push.example.test/member-one',
  'a comment notifies only the entry owner'
);

select public.set_moment_reaction(
  '60000000-0000-4000-8000-000000000001',
  'held-close'
);

select is(
  (
    select reaction_type
      from public.list_web_push_deliveries(
        'reaction',
        '60000000-0000-4000-8000-000000000001'
      )
  ),
  'held-close',
  'a reaction notifies the entry owner with the quiet reaction type'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select public.create_moment_note(
  '60000000-0000-4000-8000-000000000001',
  'The author adding their own later note.'
);

select is(
  (
    select count(*)::bigint
      from public.list_web_push_deliveries(
        'note',
        '60000000-0000-4000-8000-000000000001'
      )
  ),
  0::bigint,
  'the entry owner is not notified for their own later note'
);

select ok(
  public.delete_web_push_subscription('https://push.example.test/member-one'),
  'a member can mute by deleting their subscription'
);

reset role;
select is(
  (
    select count(*)::bigint
      from private.web_push_subscriptions
     where membership_id = '40000000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'deleting a subscription removes only that membership row'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$select public.save_web_push_subscription(
    'http://insecure.example.test/push',
    repeat('A', 87),
    repeat('B', 22)
  )$$,
  '23514',
  'new row for relation "web_push_subscriptions" violates check constraint "web_push_subscriptions_endpoint_valid"',
  'plain HTTP push endpoints are rejected'
);

reset role;
select ok(
  (
    select relrowsecurity and relforcerowsecurity
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
     where namespace.nspname = 'private'
       and class.relname = 'web_push_subscriptions'
  ),
  'push subscriptions force RLS even in the private schema'
);

select is(
  (
    select count(*)::bigint
      from information_schema.role_table_grants
     where table_schema = 'private'
       and table_name = 'web_push_subscriptions'
       and grantee in ('anon', 'authenticated', 'PUBLIC')
  ),
  0::bigint,
  'browser roles have no direct subscription table privileges'
);

select is(
  (
    select count(*)::bigint
      from information_schema.columns
     where table_schema = 'private'
       and table_name = 'web_push_subscriptions'
       and column_name in ('body', 'title', 'caption')
  ),
  0::bigint,
  'subscription rows do not store journal body text'
);

reset role;
insert into private.web_push_subscriptions (
  circle_id, membership_id, endpoint, p256dh, auth
) values (
  '20000000-0000-4000-8000-000000000002',
  '40000000-0000-4000-8000-000000000007',
  'https://push.example.test/dual-legacy-harbor',
  repeat('E', 87),
  repeat('F', 22)
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select is(
  (
    select endpoint
      from public.list_web_push_deliveries(
        'moment',
        '60000000-0000-4000-8000-000000000003'
      )
     where endpoint = 'https://push.example.test/dual-legacy-harbor'
  ),
  'https://push.example.test/dual-legacy-harbor',
  'a Cedar family post notifies a dual member whose only saved row is Harbor'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', true);

select is(
  (
    select endpoint
      from public.list_web_push_deliveries(
        'moment',
        '60000000-0000-4000-8000-000000000006'
      )
  ),
  'https://push.example.test/dual-legacy-harbor',
  'a Harbor family post still notifies when the saved row is on that same circle'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);

select ok(
  public.save_web_push_subscription(
    'https://push.example.test/dual-legacy-harbor',
    repeat('E', 87),
    repeat('F', 22)
  ) is not null,
  'Notifications On refreshes coverage for every active membership'
);

reset role;
select is(
  (
    select count(*)::bigint
      from private.web_push_subscriptions
     where endpoint = 'https://push.example.test/dual-legacy-harbor'
       and membership_id in (
         '40000000-0000-4000-8000-000000000005',
         '40000000-0000-4000-8000-000000000007'
       )
  ),
  2::bigint,
  'saving a dual-circle subscription stores one row per active membership'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select is(
  (
    select count(*)::bigint
      from public.list_web_push_deliveries(
        'moment',
        '60000000-0000-4000-8000-000000000003'
      )
     where endpoint = 'https://push.example.test/dual-legacy-harbor'
  ),
  1::bigint,
  'one endpoint is not notified twice for the same moment across memberships'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', true);

select public.save_web_push_subscription(
  'https://push.example.test/harbor-organizer',
  repeat('G', 87),
  repeat('H', 22)
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);

select lives_ok(
  $$select public.create_written_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000005',
    'A porch thought for both circles.',
    '2026-09-11',
    null,
    null,
    'family',
    array[
      '20000000-0000-4000-8000-000000000001'::uuid,
      '20000000-0000-4000-8000-000000000002'::uuid
    ]
  )$$,
  'a dual member can post one family thought to Cedar and Harbor'
);

select is(
  (
    select string_agg(endpoint, ',' order by endpoint)
      from public.list_web_push_deliveries(
        'moment',
        (
          select id
            from public.moments
           where body = 'A porch thought for both circles.'
        )
      )
  ),
  'https://push.example.test/harbor-organizer,https://push.example.test/member-two',
  'a linked Harbor audience notifies Harbor and Cedar members and never the actor'
);

select ok(
  public.delete_web_push_subscription('https://push.example.test/dual-legacy-harbor'),
  'a dual member can mute the device once for every membership row'
);

reset role;
select is(
  (
    select count(*)::bigint
      from private.web_push_subscriptions
     where endpoint = 'https://push.example.test/dual-legacy-harbor'
  ),
  0::bigint,
  'deleting a dual-circle endpoint removes every membership row for that device'
);

select * from finish();
rollback;
