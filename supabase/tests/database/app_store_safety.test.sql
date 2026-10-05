begin;

select plan(64);

select is(
  (
    select namespace.nspname
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = class.relnamespace
     where class.relname = 'content_reports'
  ),
  'private',
  'content reports stay outside the exposed schema'
);

select ok(
  (
    select class.relrowsecurity and class.relforcerowsecurity
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = class.relnamespace
     where namespace.nspname = 'private'
       and class.relname = 'content_reports'
  ),
  'content reports enable and force RLS'
);

select ok(
  (
    select bool_and(class.relrowsecurity and class.relforcerowsecurity)
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = class.relnamespace
     where namespace.nspname = 'private'
       and class.relname in (
         'member_blocks',
         'terms_acceptances',
         'account_deletion_runs',
         'account_deletion_completions',
         'safety_outbound_mail'
       )
  ),
  'block, terms, and deletion tables enable and force RLS'
);

select is(
  (
    select count(*)::bigint
      from information_schema.columns
     where table_schema = 'private'
       and table_name = 'account_deletion_completions'
       and column_name in ('email', 'body', 'excerpt', 'display_name')
  ),
  0::bigint,
  'a deletion completion row stores no email or content'
);

select ok(
  not exists (
    select 1
      from pg_catalog.pg_constraint as constraint_row
     where constraint_row.conrelid in (
         'private.content_reports'::regclass,
         'private.member_blocks'::regclass,
         'private.terms_acceptances'::regclass,
         'private.account_deletion_runs'::regclass
       )
       and constraint_row.contype = 'f'
       and constraint_row.confrelid = 'auth.users'::regclass
  ),
  'safety ledgers do not foreign-key the replaceable Auth row'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$select * from private.content_reports$$,
  '42501',
  'permission denied for table content_reports',
  'authenticated cannot read the report ledger'
);

select throws_ok(
  $$select public.tick_safety_jobs()$$,
  '42501',
  'permission denied for function tick_safety_jobs',
  'browser roles cannot run the deletion job'
);

select is(
  (select count(*)::bigint from public.get_my_terms_acceptance()),
  0::bigint,
  'terms acceptance is empty until the member agrees'
);

select is(
  public.accept_terms('2026-10-04'),
  public.accept_terms('2026-10-04'),
  'accepting the same terms version keeps the original timestamp'
);

select is(
  (select terms_version from public.get_my_terms_acceptance()),
  '2026-10-04',
  'the accepted terms version is readable'
);

select throws_ok(
  $$select public.accept_terms('October')$$,
  '22023',
  'Terms could not be accepted',
  'a terms version must be a calendar date'
);

select is(
  (select state from public.get_my_account_closure_status()),
  'none',
  'an organizer with a co-organizer has not requested deletion'
);

select is(
  cardinality((select last_organizer_circles from public.get_my_account_closure_status())),
  0,
  'Cedar Circle still has another organizer'
);

select lives_ok(
  $$select public.set_membership_role(
    '40000000-0000-4000-8000-000000000002',
    'member'
  )$$,
  'the co-organizer can be demoted for the last-organizer check'
);

select ok(
  'Cedar Circle' = any (
    select unnest(last_organizer_circles)
      from public.get_my_account_closure_status()
  ),
  'the status names the circle that still needs another organizer'
);

select throws_ok(
  $$select public.request_account_closure('aa000000-0000-4000-8000-000000000091')$$,
  '23514',
  'Every family must retain an active organizer',
  'the last organizer cannot request deletion'
);

select lives_ok(
  $$select public.set_membership_role(
    '40000000-0000-4000-8000-000000000002',
    'organizer'
  )$$,
  'the co-organizer role is restored'
);

select is(
  public.report_content(
    'moment',
    '60000000-0000-4000-8000-000000000004',
    'spam',
    '  repeated solicitation  '
  ),
  public.report_content(
    'moment',
    '60000000-0000-4000-8000-000000000004',
    'harassment',
    null
  ),
  'reporting the same post twice returns the original report'
);

select is(
  (
    select count(*)::bigint
      from public.list_timeline_moments('20000000-0000-4000-8000-000000000001')
     where moment_id = '60000000-0000-4000-8000-000000000004'
  ),
  0::bigint,
  'a reported post disappears from the reporter timeline'
);

select throws_ok(
  $$select public.report_content('photo', '60000000-0000-4000-8000-000000000004', 'spam', null)$$,
  '22023',
  'Content could not be reported',
  'a report needs a moment or a note'
);

select throws_ok(
  $$select public.report_content('moment', '60000000-0000-4000-8000-000000000006', 'spam', null)$$,
  '42501',
  'Content could not be reported',
  'a member cannot report a post they cannot see'
);

select throws_ok(
  $$select public.block_member('40000000-0000-4000-8000-000000000001')$$,
  '22023',
  'This person cannot be blocked',
  'a member cannot block themselves'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);

select is(
  public.create_moment_note(
    '60000000-0000-4000-8000-000000000001',
    '@A Organizer One thanks for keeping this',
    array['10000000-0000-4000-8000-000000000001']::uuid[],
    array[0],
    array[16]
  ) is not null,
  true,
  'a member can comment on a visible family post'
);

select lives_ok(
  $$select public.set_moment_reaction(
    '60000000-0000-4000-8000-000000000001',
    'held-close'
  )$$,
  'a member can react to a visible family post'
);

select lives_ok(
  $$select public.set_moment_note_heart(
  (
    select id
      from public.moment_notes
     where author_membership_id = '40000000-0000-4000-8000-000000000003'
       and moment_id = '60000000-0000-4000-8000-000000000001'
  ),
  true
  )$$,
  'a member can heart their own comment'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select ok(
  exists (
    select 1
      from public.list_my_mention_notifications()
     where actor_membership_id = '40000000-0000-4000-8000-000000000003'
  ),
  'a mention from a visible member reaches the recipient'
);

select lives_ok(
  $$select public.block_member('40000000-0000-4000-8000-000000000003')$$,
  'a member who shares a circle can be blocked'
);
select lives_ok(
  $$select public.block_member('40000000-0000-4000-8000-000000000003')$$,
  'blocking the same person again is idempotent'
);

select is(
  (select person_display_name from public.list_my_blocks()),
  'A Member',
  'blocked people are listed by their display name'
);

select is(
  (
    select count(*)::bigint
      from public.list_timeline_moments('20000000-0000-4000-8000-000000000001')
     where moment_id in (
       '60000000-0000-4000-8000-000000000004',
       '60000000-0000-4000-8000-000000000007'
     )
  ),
  0::bigint,
  'list_timeline_moments hides a blocked member posts'
);

select is(
  (
    select count(*)::bigint
      from public.list_all_timeline_moments()
     where moment_id = '60000000-0000-4000-8000-000000000007'
  ),
  0::bigint,
  'list_all_timeline_moments hides a blocked member post'
);

select ok(
  not exists (
    select 1
      from jsonb_array_elements(
        public.enrich_timeline_page(
          array['60000000-0000-4000-8000-000000000001']::uuid[]
        ) -> 'notes'
      ) as note
     where note ->> 'author_membership_id' = '40000000-0000-4000-8000-000000000003'
  ),
  'enrich_timeline_page hides a blocked member comment'
);

select ok(
  not exists (
    select 1
      from jsonb_array_elements(
        public.enrich_timeline_page(
          array['60000000-0000-4000-8000-000000000001']::uuid[]
        ) -> 'reactions'
      ) as reaction
     where reaction ->> 'author_membership_id' = '40000000-0000-4000-8000-000000000003'
  ),
  'enrich_timeline_page hides a blocked member reaction'
);

select ok(
  not exists (
    select 1
      from jsonb_array_elements(
        public.enrich_timeline_page(
          array['60000000-0000-4000-8000-000000000001']::uuid[]
        ) -> 'hearts'
      ) as heart
     where heart ->> 'author_membership_id' = '40000000-0000-4000-8000-000000000003'
  ),
  'enrich_timeline_page hides a blocked member heart'
);

select ok(
  not exists (
    select 1
      from jsonb_array_elements(
        (select notes from public.get_moment_conversation(
          '60000000-0000-4000-8000-000000000001'
        ))
      ) as note
     where note ->> 'body' = '@A Organizer One thanks for keeping this'
  ),
  'get_moment_conversation hides a blocked member comment'
);

select is(
  (
    select count(*)::bigint
      from public.moment_notes
     where author_membership_id = '40000000-0000-4000-8000-000000000003'
  ),
  0::bigint,
  'note reads hide a blocked member comment'
);

select is(
  (
    select count(*)::bigint
      from public.moment_reactions
     where author_membership_id = '40000000-0000-4000-8000-000000000003'
  ),
  0::bigint,
  'reaction reads hide a blocked member heart on a post'
);

select is(
  (
    select count(*)::bigint
      from public.moment_note_reactions
     where author_user_id = '10000000-0000-4000-8000-000000000003'
  ),
  0::bigint,
  'heart reads hide a blocked member comment heart'
);

select is(
  (
    select count(*)::bigint
      from public.list_my_mention_notifications()
     where actor_membership_id = '40000000-0000-4000-8000-000000000003'
  ),
  0::bigint,
  'mention notifications hide a blocked member'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select is(
  (
    select count(*)::bigint
      from public.list_timeline_moments('20000000-0000-4000-8000-000000000001')
     where moment_id = '60000000-0000-4000-8000-000000000007'
  ),
  1::bigint,
  'another member still sees the blocked person post'
);

select ok(
  exists (
    select 1
      from public.moment_notes
     where author_membership_id = '40000000-0000-4000-8000-000000000003'
       and moment_id = '60000000-0000-4000-8000-000000000001'
  ),
  'another member still sees the blocked person comment'
);

select is(
  public.create_moment_note(
    '60000000-0000-4000-8000-000000000001',
    'A co-organizer note that must remain.'
  ) is not null,
  true,
  'a co-organizer can still comment on someone else post'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$select public.unblock_member('40000000-0000-4000-8000-000000000003')$$,
  'a blocked person can be unblocked'
);

select is(
  (select count(*)::bigint from public.list_my_blocks()),
  0::bigint,
  'unblocking removes the person from the blocked list'
);

select is(
  (
    select count(*)::bigint
      from public.list_timeline_moments('20000000-0000-4000-8000-000000000001')
     where moment_id = '60000000-0000-4000-8000-000000000007'
  ),
  1::bigint,
  'unblocking restores a post that was not reported'
);

select is(
  (
    select count(*)::bigint
      from public.list_timeline_moments('20000000-0000-4000-8000-000000000001')
     where moment_id = '60000000-0000-4000-8000-000000000004'
  ),
  0::bigint,
  'unblocking does not restore a post the viewer reported'
);

reset role;

insert into private.entry_drafts (user_id, kind)
values ('10000000-0000-4000-8000-000000000003', 'thought');

insert into private.expo_push_tokens (user_id, token)
values (
  '10000000-0000-4000-8000-000000000003',
  'ExpoPushToken[aaaaaaaaaaaaaaaa]'
);

insert into private.web_push_subscriptions (
  circle_id, membership_id, endpoint, p256dh, auth
) values (
  '20000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000003',
  'https://push.example.test/member-a-safety',
  repeat('a', 80),
  repeat('b', 16)
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);

select is(
  (select state from public.get_my_account_closure_status()),
  'none',
  'a member who has not asked for deletion is not pending'
);

select is(
  public.request_account_closure('aa000000-0000-4000-8000-000000000099') is not null,
  true,
  'a member who is not the last organizer can request deletion'
);

select is(
  (select state from public.get_my_account_closure_status()),
  'requested',
  'the status shows a deletion request before the job runs'
);

reset role;

select lives_ok(
  $$select private.tick_safety_jobs()$$,
  'the safety job processes a requested deletion'
);

select lives_ok(
  $$select private.tick_safety_jobs()$$,
  'running the safety job again is idempotent'
);

select is(
  (
    select count(*)::bigint
      from public.moments
     where id in (
       '60000000-0000-4000-8000-000000000004',
       '60000000-0000-4000-8000-000000000007'
     )
  ),
  0::bigint,
  'the job deletes the requester authored posts'
);

select is(
  (select count(*)::bigint from public.moments where id = '60000000-0000-4000-8000-000000000001'),
  1::bigint,
  'another person post remains'
);

select is(
  (select count(*)::bigint from public.moments where id = '60000000-0000-4000-8000-000000000003'),
  1::bigint,
  'a co-organizer post remains'
);

select is(
  (
    select count(*)::bigint
      from public.moment_notes
     where body = 'A co-organizer note that must remain.'
  ),
  1::bigint,
  'a comment on someone else post remains'
);

select is(
  (select count(*)::bigint from public.moment_notes where id = '70000000-0000-4000-8000-000000000001'),
  0::bigint,
  'a comment on the requester post is removed with that post'
);

select is(
  (
    select count(*)::bigint
      from public.moment_notes
     where author_membership_id = '40000000-0000-4000-8000-000000000003'
  ),
  0::bigint,
  'the requester comments are deleted'
);

select is(
  (
    select count(*)::bigint
      from public.moment_reactions
     where author_membership_id = '40000000-0000-4000-8000-000000000003'
        or moment_id = '60000000-0000-4000-8000-000000000007'
  ),
  0::bigint,
  'the requester reactions and reactions on their posts are deleted'
);

select is(
  (select count(*)::bigint from private.entry_drafts where user_id = '10000000-0000-4000-8000-000000000003'),
  0::bigint,
  'the requester drafts are deleted'
);

select is(
  (select count(*)::bigint from private.expo_push_tokens where user_id = '10000000-0000-4000-8000-000000000003'),
  0::bigint,
  'the requester native push tokens are deleted'
);

select is(
  (
    select count(*)::bigint
      from private.web_push_subscriptions
     where membership_id = '40000000-0000-4000-8000-000000000003'
  ),
  0::bigint,
  'the requester web push subscriptions are deleted'
);

select is(
  (select count(*)::bigint from auth.users where id = '10000000-0000-4000-8000-000000000003'),
  0::bigint,
  'the auth user is deleted after preparation'
);

select is(
  (select count(*)::bigint from private.account_deletion_completions),
  1::bigint,
  'one content-free completion row is recorded'
);

select is(
  (select count(*)::bigint from public.people where id = '30000000-0000-4000-8000-000000000003'),
  1::bigint,
  'the family roster person row remains after the account is deleted'
);

select * from finish();
rollback;
