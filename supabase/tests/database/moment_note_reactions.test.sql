begin;

select plan(26);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select public.save_web_push_subscription(
  'https://push.example.test/comment-author',
  repeat('A', 87),
  repeat('B', 22)
);

select ok(
  public.create_moment_note(
    '60000000-0000-4000-8000-000000000001',
    'A comment worth a heart.'
  ) is not null,
  'the comment author can leave a note'
);

select lives_ok(
  $$select public.set_moment_note_heart(
    (select id from public.moment_notes where body = 'A comment worth a heart.'),
    true
  )$$,
  'a member can heart their own comment'
);

select is(
  (
    select count(*)::bigint
      from public.claim_note_reaction_push_deliveries(
        (select id from public.moment_notes where body = 'A comment worth a heart.')
      )
  ),
  0::bigint,
  'a heart on your own comment never notifies'
);

select lives_ok(
  $$select public.set_moment_note_heart(
    (select id from public.moment_notes where body = 'A comment worth a heart.'),
    false
  )$$,
  'the author can remove their own comment heart'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select is(
  public.set_moment_note_heart(
    (select id from public.moment_notes where body = 'A comment worth a heart.'),
    true
  ) > 0,
  true,
  'a circle member can heart a comment'
);

select is(
  (
    select count(*)::bigint
      from public.moment_note_reactions
     where removed_at is null
       and note_id = (
         select id from public.moment_notes where body = 'A comment worth a heart.'
       )
  ),
  1::bigint,
  'one live heart is visible on that comment'
);

select is(
  (
    select count(*)::bigint
      from public.moment_note_reactions
     where note_id = (
         select id from public.moment_notes where body = 'A comment worth a heart.'
       )
       and author_user_id = '10000000-0000-4000-8000-000000000002'
  ),
  1::bigint,
  'one heart row exists per person per comment'
);

select is(
  public.set_moment_note_heart(
    (select id from public.moment_notes where body = 'A comment worth a heart.'),
    true
  ) > 0,
  true,
  'hearting again does not add a second live heart'
);

select is(
  (
    select notes -> 0 ->> 'heartCount'
      from public.get_moment_conversation('60000000-0000-4000-8000-000000000001')
  ),
  '1',
  'the conversation payload includes the heart count'
);

select is(
  (
    select notes -> 0 ->> 'heartedByViewer'
      from public.get_moment_conversation('60000000-0000-4000-8000-000000000001')
  ),
  'true',
  'the hearter sees that they hearted the comment'
);

select is(
  (
    select notes -> 0 -> 'heartNames' ->> 0
      from public.get_moment_conversation('60000000-0000-4000-8000-000000000001')
  ),
  'A Organizer Two',
  'the conversation payload names who hearted the comment'
);

select is(
  (
    select actor_name
      from public.claim_note_reaction_push_deliveries(
        (select id from public.moment_notes where body = 'A comment worth a heart.')
      )
  ),
  'A Organizer Two',
  'the comment author receives one push naming who hearted it'
);

select is(
  (
    select count(*)::bigint
      from public.claim_note_reaction_push_deliveries(
        (select id from public.moment_notes where body = 'A comment worth a heart.')
      )
  ),
  0::bigint,
  'claiming the same heart again does not notify'
);

select lives_ok(
  $$select public.set_moment_note_heart(
    (select id from public.moment_notes where body = 'A comment worth a heart.'),
    false
  )$$,
  'a member can unheart a comment'
);

select lives_ok(
  $$select public.set_moment_note_heart(
    (select id from public.moment_notes where body = 'A comment worth a heart.'),
    true
  )$$,
  'a member can heart the same comment again'
);

select is(
  (
    select count(*)::bigint
      from public.claim_note_reaction_push_deliveries(
        (select id from public.moment_notes where body = 'A comment worth a heart.')
      )
  ),
  0::bigint,
  'toggling a comment heart off and on does not send another push'
);

select id as hearted_note_id
  from public.moment_notes
 where body = 'A comment worth a heart.'
\gset

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', true);

select throws_ok(
  format(
    'select public.set_moment_note_heart(%L, true)',
    :'hearted_note_id'
  ),
  '42501',
  'Comment heart could not be saved',
  'another circle cannot heart a comment it cannot read'
);

select is(
  (select count(*)::bigint from public.moment_note_reactions),
  0::bigint,
  'another circle cannot see comment hearts'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select throws_ok(
  $$insert into public.moment_note_reactions (
    circle_id, note_id, moment_id, author_membership_id, author_user_id
  ) values (
    '20000000-0000-4000-8000-000000000001',
    (select id from public.moment_notes where body = 'A comment worth a heart.'),
    '60000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002'
  )$$,
  '42501',
  'permission denied for table moment_note_reactions',
  'browser callers cannot directly insert comment hearts'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$select public.trash_moment_note(
    (select id from public.moment_notes where body = 'A comment worth a heart.'),
    1
  )$$,
  'the author can remove the hearted comment'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select is(
  (select count(*)::bigint from public.moment_note_reactions),
  0::bigint,
  'hearts on a removed comment are hidden'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$select public.create_written_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'A moment that will be trashed.',
    '2026-09-20',
    null,
    null,
    'family',
    null
  )$$,
  'the author can post a moment that will be trashed'
);

select lives_ok(
  $$select public.create_moment_note(
    (select id from public.moments where body = 'A moment that will be trashed.'),
    'A comment on a moment that will be trashed.'
  )$$,
  'the author can comment on that moment'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select lives_ok(
  $$select public.set_moment_note_heart(
    (select id from public.moment_notes where body = 'A comment on a moment that will be trashed.'),
    true
  )$$,
  'a member can heart a comment before the moment is trashed'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$select public.set_written_moment_trashed(
    (select id from public.moments where body = 'A moment that will be trashed.'),
    1,
    true
  )$$,
  'the author can trash the parent moment'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select is(
  (select count(*)::bigint from public.moment_note_reactions),
  0::bigint,
  'hearts on a trashed moment are hidden'
);

select * from finish();
rollback;
