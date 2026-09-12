begin;

select plan(8);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);

select lives_ok(
  $$select public.create_family_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000005',
    'thought', null, 'A porch note for both circles.',
    null, '{}', '2026-08-29', null, null, null, null, 'family',
    array[
      '20000000-0000-4000-8000-000000000001'::uuid,
      '20000000-0000-4000-8000-000000000002'::uuid
    ]
  )$$,
  'a dual-circle member can post one family moment to Cedar and Harbor'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select ok(
  public.create_moment_note(
    (select id from public.moments where body = 'A porch note for both circles.'),
    'Nana kept the porch light on.'
  ) is not null,
  'a Cedar member can note a Cedar-primary linked moment'
);

select is(
  public.set_moment_reaction(
    (select id from public.moments where body = 'A porch note for both circles.'),
    'held-close'
  ),
  1::bigint,
  'a Cedar member can react to a Cedar-primary linked moment'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', true);

select is(
  (
    select count(*)::bigint
      from public.moment_notes
     where body = 'Nana kept the porch light on.'
  ),
  1::bigint,
  'a Harbor-only member can read notes on a Cedar-primary moment linked to Harbor'
);

select is(
  (
    select notes -> 0 ->> 'authorName'
      from public.get_moment_conversation(
        (select id from public.moments where body = 'A porch note for both circles.')
      )
  ),
  'A Organizer One',
  'a Harbor-only member sees the Cedar author name on a linked moment note'
);

select is(
  (
    select reactions -> 0 ->> 'personName'
      from public.get_moment_conversation(
        (select id from public.moments where body = 'A porch note for both circles.')
      )
  ),
  'A Organizer One',
  'a Harbor-only member sees the Cedar author name on a linked moment reaction'
);

select is(
  (
    select count(*)::bigint
      from public.moment_notes
     where body = 'The delighted laugh afterward is worth remembering.'
  ),
  0::bigint,
  'a Harbor-only member cannot read notes on a Cedar-only moment'
);

select throws_ok(
  $$select public.create_moment_note(
    (select id from public.moments where body = 'A porch note for both circles.'),
    'Harbor cannot write without a Cedar membership.'
  )$$,
  '42501',
  'Note could not be saved',
  'a Harbor-only member still cannot write a note on a Cedar-primary moment'
);

select * from finish();
rollback;
