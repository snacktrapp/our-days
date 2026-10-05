begin;

select plan(8);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select is(
  (select private.moment_media_push_is_ready(
    '60000000-0000-4000-8000-000000000003'::uuid
  )),
  true,
  'location moments are media-ready immediately'
);

select is(
  (
    select should_send
      from public.moment_push_delivery_status(
        '60000000-0000-4000-8000-000000000003'::uuid
      )
  ),
  true,
  'a ready family moment can send its new-post push'
);

select ok(
  public.claim_moment_push_delivery(
    '60000000-0000-4000-8000-000000000003'::uuid
  ),
  'the poster can claim the first moment push delivery'
);

select ok(
  not public.claim_moment_push_delivery(
    '60000000-0000-4000-8000-000000000003'::uuid
  ),
  'claiming a moment push delivery is idempotent'
);

select is(
  (
    select already_notified
      from public.moment_push_delivery_status(
        '60000000-0000-4000-8000-000000000003'::uuid
      )
  ),
  true,
  'status reports a moment as already notified after claim'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select is(
  (
    select count(*)::bigint
      from public.moment_push_delivery_status(
        '60000000-0000-4000-8000-000000000004'::uuid
      )
  ),
  0::bigint,
  'a non-poster cannot read another member''s moment push status'
);

select ok(
  not public.claim_moment_push_delivery(
    '60000000-0000-4000-8000-000000000004'::uuid
  ),
  'a non-poster cannot claim another member''s moment push delivery'
);

reset role;

update public.moments
   set moment_push_scheduled_at = statement_timestamp() - interval '5 minutes',
       moment_push_notified_at = null
 where id = '60000000-0000-4000-8000-000000000007';

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select is(
  (
    select fallback_elapsed
      from public.moment_push_delivery_status(
        '60000000-0000-4000-8000-000000000007'::uuid
      )
  ),
  true,
  'fallback elapses after the scheduled window even when media is already ready'
);

select ok(
  public.claim_moment_push_delivery(
    '60000000-0000-4000-8000-000000000007'::uuid
  ),
  'fallback allows claiming once the scheduled window has elapsed'
);

select * from finish();
rollback;
