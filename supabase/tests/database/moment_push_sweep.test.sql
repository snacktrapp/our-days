begin;

select plan(11);

select private.replace_moment_push_sweep_secret('sweep-secret-fixture');

update public.moments
   set moment_push_scheduled_at = timestamptz '2026-10-06 07:00:00+00'
         - interval '1 second',
       moment_push_notified_at = null
 where id = '60000000-0000-4000-8000-000000000003';

insert into private.web_push_subscriptions (
  circle_id, membership_id, endpoint, p256dh, auth
) values (
  '20000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'https://push.example.test/sweep-member',
  repeat('A', 87),
  repeat('B', 22)
);

insert into public.moments (
  id,
  circle_id,
  journal_person_id,
  recorded_by_membership_id,
  kind,
  body,
  occurred_on,
  time_precision,
  audience,
  moment_push_scheduled_at
) values (
  '60000000-0000-4000-8000-000000000099',
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002',
  '40000000-0000-4000-8000-000000000002',
  'video',
  'A video still uploading.',
  '2026-08-27',
  'date',
  'family',
  greatest(statement_timestamp(), timestamptz '2026-10-06 07:00:00+00')
);

set local role anon;

select throws_ok(
  $$select count(*) from public.sweep_due_moment_pushes('wrong-sweep-secret', null, 10)$$,
  '42501',
  'Moment push sweep is unavailable',
  'a wrong sweep secret does not run'
);

select is(
  (
    select count(*)::bigint
      from public.sweep_due_moment_pushes('sweep-secret-fixture', null, 10)
     where moment_id = '60000000-0000-4000-8000-000000000003'
  ),
  0::bigint,
  'moments scheduled before the deploy cutoff are not swept'
);

reset role;

select is(
  (
    select moment_push_notified_at is null
      from public.moments
     where id = '60000000-0000-4000-8000-000000000003'
  ),
  true,
  'a rejected or early sweep leaves the moment unclaimed'
);

select is(
  (
    select moment_push_notified_at is null
      from public.moments
     where id = '60000000-0000-4000-8000-000000000099'
  ),
  true,
  'unfinished video is not claimed before the fallback'
);

update public.moments
   set moment_push_scheduled_at = statement_timestamp() - interval '25 hours',
       moment_push_notified_at = null
 where id = '60000000-0000-4000-8000-000000000001';

set local role anon;

select is(
  (
    select count(*)::bigint
      from public.sweep_due_moment_pushes('sweep-secret-fixture', null, 10)
     where moment_id = '60000000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'a moment scheduled 25 hours ago is outside the sweep window'
);

reset role;

update public.moments
   set moment_push_scheduled_at = greatest(
         statement_timestamp(),
         timestamptz '2026-10-06 07:00:00+00'
       ),
       moment_push_notified_at = null
 where id = '60000000-0000-4000-8000-000000000003';

set local role anon;

create temp table sweep_rows as
select *
  from public.sweep_due_moment_pushes('sweep-secret-fixture', null, 10);

select is(
  (
    select count(*)::bigint
      from sweep_rows
     where moment_id = '60000000-0000-4000-8000-000000000003'
       and channel = 'claimed'
  ),
  1::bigint,
  'a due post is claimed once'
);

select is(
  (
    select count(*)::bigint
      from sweep_rows
     where moment_id = '60000000-0000-4000-8000-000000000003'
       and channel = 'web'
       and destination = 'https://push.example.test/sweep-member'
  ),
  1::bigint,
  'the claim returns that post''s web push exactly once'
);

select is(
  (
    select count(*)::bigint
      from sweep_rows
     where moment_id = '60000000-0000-4000-8000-000000000099'
  ),
  0::bigint,
  'the unfinished video is not in the same sweep'
);

create temp table first_claim as
select moment_push_notified_at as notified_at
  from public.moments
 where id = '60000000-0000-4000-8000-000000000003';

select is(
  (select notified_at is not null from first_claim),
  true,
  'the first sweep sets moment_push_notified_at'
);

select is(
  (
    select count(*)::bigint
      from public.sweep_due_moment_pushes('sweep-secret-fixture', null, 10)
     where moment_id = '60000000-0000-4000-8000-000000000003'
  ),
  0::bigint,
  'a second sweep does not claim or deliver the same post'
);

select is(
  (
    select moment.moment_push_notified_at = first_claim.notified_at
      from public.moments as moment
      cross join first_claim
     where moment.id = '60000000-0000-4000-8000-000000000003'
  ),
  true,
  'notified_at stays on the first claim when the sweeper races itself'
);

select * from finish();
rollback;
