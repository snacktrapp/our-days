begin;

select plan(48);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select ok(
  public.create_family_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'milestone', '  Learned to ride  ', '  Two brave laps.  ',
    '  Cedar Park  ',
    array['30000000-0000-4000-8000-000000000002'::uuid,
          '30000000-0000-4000-8000-000000000008'::uuid],
    '2026-08-29'
  ) is not null,
  'an adult can create a milestone in their own journal'
);

select is(
  (select title || '|' || body || '|' || place_name
   from public.moments where title = 'Learned to ride'),
  'Learned to ride|Two brave laps.|Cedar Park',
  'milestone text and manual place labels are normalized'
);

select is(
  (select count(*)::bigint from public.moment_people
   where moment_id = (select id from public.moments where title = 'Learned to ride')),
  2::bigint,
  'same-circle people tags are stored atomically'
);

select throws_ok(
  $$select public.update_written_moment(
    (select id from public.moments where title = 'Learned to ride'),
    1, 'Legacy kind rewrite', '2026-08-29'
  )$$,
  '22023', 'Moment could not be changed',
  'the legacy thought editor cannot target a milestone or place'
);

select ok(
  public.create_family_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'location', null, 'A windy picnic.', 'Ocean overlook', '{}', '2026-08-28'
  ) is not null,
  'an adult can create a manual place moment'
);

select is(
  (select moment_kind || '|' || place_name
   from public.list_timeline_moments('20000000-0000-4000-8000-000000000001')
   where place_name = 'Ocean overlook'),
  'location|Ocean overlook',
  'the timeline returns the distinct location treatment'
);

select is(
  public.update_family_moment(
    (select id from public.moments where place_name = 'Ocean overlook'),
    1, null, 'A windy picnic.', 'Ocean overlook',
    array['30000000-0000-4000-8000-000000000002'::uuid], '2026-08-28'
  ),
  2::bigint,
  'an authorized edit can add a same-circle tag'
);

select is(
  public.update_family_moment(
    (select id from public.moments where place_name = 'Ocean overlook'),
    2, null, 'A windy picnic.', 'Ocean overlook', '{}', '2026-08-28'
  ),
  3::bigint,
  'an authorized edit can softly remove a tag'
);

set local role postgres;
select is(
  (select count(*)::bigint from public.moment_people
   where moment_id = (select id from public.moments where place_name = 'Ocean overlook')
     and removed_at is not null
     and tagged_by_membership_id = '40000000-0000-4000-8000-000000000001'),
  1::bigint,
  'removed tags retain their original attribution as soft-removed rows'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is(
  public.update_family_moment(
    (select id from public.moments where place_name = 'Ocean overlook'),
    3, null, 'A windy picnic.', 'Ocean overlook',
    array['30000000-0000-4000-8000-000000000002'::uuid], '2026-08-28'
  ),
  4::bigint,
  're-adding a tag restores its existing attributed row'
);

select is(
  (select count(*)::bigint from public.list_timeline_moments(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002'
  ) where moment_title = 'Learned to ride'),
  0::bigint,
  'tagging someone never transfers journal ownership'
);

select throws_ok(
  $$select public.create_family_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'milestone', 'Duplicate tags', '', null,
    array['30000000-0000-4000-8000-000000000002'::uuid,
          '30000000-0000-4000-8000-000000000002'::uuid], '2026-08-29'
  )$$,
  '22023', 'Moment could not be created',
  'duplicate tags are rejected'
);

select throws_ok(
  $$select public.create_family_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'milestone', 'Wrong family tag', '', null,
    array['30000000-0000-4000-8000-000000000006'::uuid], '2026-08-29'
  )$$,
  '22023', 'Moment could not be created',
  'cross-circle tags are rejected without partial creation'
);

select throws_ok(
  $$select public.create_family_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'milestone', 'Redundant self tag', '', null,
    array['30000000-0000-4000-8000-000000000001'::uuid], '2026-08-29'
  )$$,
  '22023', 'Moment could not be created',
  'the journal person cannot be redundantly tagged'
);

select throws_ok(
  $$select public.create_family_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002',
    'milestone', 'Another adult words', '', null, '{}', '2026-08-29'
  )$$,
  '42501', 'Moment could not be created',
  'an organizer cannot write in another adult journal'
);

select ok(
  public.create_family_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000008',
    'milestone', 'First library card', '', null, '{}', '2024-04-12'
  ) is not null,
  'a guardian can create a managed-child milestone'
);

select ok(
  public.create_moment_note(
    (select id from public.moments where title = 'Learned to ride'),
    '  I remember the proud grin.  '
  ) is not null,
  'an active member can add a family note'
);

select is(
  (select body from public.moment_notes where body = 'I remember the proud grin.'),
  'I remember the proud grin.',
  'family notes are normalized and readable inside the circle'
);

select is(
  jsonb_array_length((
    select notes from public.get_moment_conversation(
      (select id from public.moments where title = 'Learned to ride')
    )
  )),
  1,
  'the lazy detail RPC returns notes only when requested'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);

select ok(
  public.create_moment_note(
    (select id from public.moments where title = 'Learned to ride'),
    'A second family perspective.'
  ) is not null,
  'another active family member may add their own note'
);

select throws_ok(
  $$select public.update_moment_note(
    (select id from public.moment_notes where body = 'I remember the proud grin.'),
    1, 'A silent rewrite.'
  )$$,
  '42501', 'Note could not be changed',
  'a non-author cannot edit another family member note'
);

select throws_ok(
  $$select public.trash_moment_note(
    (select id from public.moment_notes where body = 'I remember the proud grin.'), 1
  )$$,
  '42501', 'Note could not be changed',
  'a non-author cannot remove another family member note'
);

select throws_ok(
  $$select public.create_moment_note(
    '60000000-0000-4000-8000-000000000006', 'Wrong family note'
  )$$,
  '42501', 'Note could not be saved',
  'a member cannot add a note to another circle moment'
);

select throws_ok(
  $$select public.set_moment_reaction(
    '60000000-0000-4000-8000-000000000006', 'held-close'
  )$$,
  '42501', 'Response could not be saved',
  'a member cannot respond to another circle moment'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select is(
  public.update_moment_note(
    (select id from public.moment_notes where body = 'I remember the proud grin.'),
    1, 'I remember that proud grin.'
  ),
  2::bigint,
  'a note author can edit with the expected revision'
);

select throws_ok(
  $$select public.update_moment_note(
    (select id from public.moment_notes where body = 'I remember that proud grin.'),
    null, 'Revision bypass'
  )$$,
  '22023', 'Note could not be changed',
  'a null note revision cannot bypass optimistic concurrency'
);

select throws_ok(
  $$select public.trash_moment_note(
    (select id from public.moment_notes where body = 'I remember that proud grin.'), 0
  )$$,
  '22023', 'Note could not be changed',
  'a zero note revision is rejected'
);

select is(
  public.trash_moment_note(
    (select id from public.moment_notes where body = 'I remember that proud grin.'), 2
  ),
  3::bigint,
  'a note author can move their note to trash'
);

select is(
  (select count(*)::bigint from public.moment_notes
   where body = 'I remember that proud grin.'),
  0::bigint,
  'trashed notes disappear from the normal read surface'
);

select is(
  public.set_moment_reaction(
    (select id from public.moments where title = 'Learned to ride'),
    'held-close'
  ),
  1::bigint,
  'a member can set one quiet response'
);

select is(
  jsonb_array_length((
    select reactions from public.get_moment_conversation(
      (select id from public.moments where title = 'Learned to ride')
    )
  )),
  1,
  'the lazy detail RPC returns the saved response without a total'
);

select is(
  public.set_moment_reaction(
    (select id from public.moments where title = 'Learned to ride'),
    'made-me-smile'
  ),
  2::bigint,
  'setting another response atomically replaces the callers response'
);

select is(
  (select count(*)::bigint from public.moment_reactions
   where moment_id = (select id from public.moments where title = 'Learned to ride')),
  1::bigint,
  'reaction replacement never creates a popularity stack for one member'
);

select is(
  public.set_moment_reaction(
    (select id from public.moments where title = 'Learned to ride'), null
  ),
  3::bigint,
  'a member can quietly remove their response'
);

select is(
  public.set_moment_reaction(
    (select id from public.moments where place_name = 'Ocean overlook'), null
  ),
  0::bigint,
  'clearing a response that does not exist is a no-op'
);

set local role postgres;
select is(
  (select count(*)::bigint from public.moment_reactions
   where moment_id = (select id from public.moments where place_name = 'Ocean overlook'))
  +
  (select count(*)::bigint from private.audit_events
   where event_type = 'moment_reaction_removed'
     and subject_id in (
       select id from public.moment_reactions
       where moment_id = (select id from public.moments where place_name = 'Ocean overlook')
     )),
  0::bigint,
  'a first-time response clear creates neither a tombstone nor an audit event'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$select public.set_moment_reaction(
    (select id from public.moments where title = 'Learned to ride'), 'applause'
  )$$,
  '22023', 'Response could not be saved',
  'the database rejects an unreviewed reaction vocabulary'
);

select lives_ok(
  $$select public.set_moment_reaction(
    (select id from public.moments where title = 'Learned to ride'),
    'remember-this'
  )$$,
  'a live response is available for the parent visibility test'
);

select is(
  public.set_written_moment_trashed(
    (select id from public.moments where title = 'Learned to ride'), 1, true
  ),
  2::bigint,
  'the parent milestone moves to reversible trash'
);

select ok(
  (select count(*) from public.moment_people where moment_id = (
    select moment_id from public.list_manageable_trashed_written_moments(
      '20000000-0000-4000-8000-000000000001'
    ) where body = 'Two brave laps.'
  )) = 0
  and (select count(*) from public.moment_notes where moment_id = (
    select moment_id from public.list_manageable_trashed_written_moments(
      '20000000-0000-4000-8000-000000000001'
    ) where body = 'Two brave laps.'
  )) = 0
  and (select count(*) from public.moment_reactions where moment_id = (
    select moment_id from public.list_manageable_trashed_written_moments(
      '20000000-0000-4000-8000-000000000001'
    ) where body = 'Two brave laps.'
  )) = 0,
  'parent trash immediately hides every live descendant'
);

select is(
  public.set_written_moment_trashed(
    (select moment_id from public.list_manageable_trashed_written_moments(
      '20000000-0000-4000-8000-000000000001'
    ) where body = 'Two brave laps.'), 2, false
  ),
  3::bigint,
  'the parent milestone can be restored by its owner'
);

select ok(
  (select count(*) from public.moment_people where moment_id = (
    select id from public.moments where title = 'Learned to ride'
  )) = 2
  and (select count(*) from public.moment_notes where moment_id = (
    select id from public.moments where title = 'Learned to ride'
  )) = 1
  and (select count(*) from public.moment_reactions where moment_id = (
    select id from public.moments where title = 'Learned to ride'
  )) = 1,
  'restoring a parent resurfaces only independently live descendants'
);

select throws_ok(
  $$insert into public.moment_notes (
    circle_id, moment_id, author_membership_id, body
  ) values (
    '20000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001', 'Direct write'
  )$$,
  '42501', 'permission denied for table moment_notes',
  'browser callers cannot directly insert note rows'
);

select throws_ok(
  $$update public.moment_reactions set reaction_type = 'held-close'$$,
  '42501', 'permission denied for table moment_reactions',
  'browser callers cannot directly rewrite reaction rows'
);

select throws_ok(
  $$delete from public.moment_people$$,
  '42501', 'permission denied for table moment_people',
  'browser callers cannot directly delete tags'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select is(
  (select count(*)::bigint from public.moment_notes)
  + (select count(*)::bigint from public.moment_reactions)
  + (select count(*)::bigint from public.moment_people),
  0::bigint,
  'a revoked member reads no family-context descendants'
);

select throws_ok(
  $$select public.create_moment_note(
    '60000000-0000-4000-8000-000000000001', 'Revoked write'
  )$$,
  '42501', 'Note could not be saved',
  'a revoked member cannot add a note'
);

select throws_ok(
  $$select public.set_moment_reaction(
    '60000000-0000-4000-8000-000000000001', 'held-close'
  )$$,
  '42501', 'Response could not be saved',
  'a revoked member cannot respond'
);

rollback;
