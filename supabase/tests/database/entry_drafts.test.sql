begin;

select plan(15);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select is(
  public.save_entry_draft(
    null,
    'thought',
    'Park morning',
    'The kids ran ahead.',
    'family',
    array['20000000-0000-4000-8000-000000000001']::uuid[],
    '30000000-0000-4000-8000-000000000001',
    '{}',
    'Lincoln Park',
    null,
    null,
    '2026-09-08',
    '09:15',
    'America/Los_Angeles',
    '[]'::jsonb,
    null
  ) is not null,
  true,
  'an active member can save a written draft'
);

select is(
  (select count(*)::bigint from public.list_entry_drafts()),
  1::bigint,
  'the author sees their saved draft in the list'
);

select is(
  (select kind from public.list_entry_drafts()),
  'thought',
  'the drafts list returns the saved type'
);

select is(
  (select preview_text from public.list_entry_drafts()),
  'Park morning',
  'the drafts list previews the title'
);

select is(
  (
    select body
      from public.get_entry_draft((select draft_id from public.list_entry_drafts()))
  ),
  'The kids ran ahead.',
  'the author can reload the full draft body'
);

select is(
  public.save_entry_draft(
    (select draft_id from public.list_entry_drafts()),
    'thought',
    'Park morning',
    'The kids ran ahead, then came back.',
    'just_me',
    '{}',
    '30000000-0000-4000-8000-000000000001',
    '{}',
    'Lincoln Park',
    null,
    null,
    '2026-09-08',
    '09:15',
    'America/Los_Angeles',
    '[]'::jsonb,
    null
  ) is not null,
  true,
  'saving again updates the same draft'
);

select is(
  (select count(*)::bigint from public.list_entry_drafts()),
  1::bigint,
  'an update does not consume another draft slot'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select is(
  (select count(*)::bigint from public.list_entry_drafts()),
  0::bigint,
  'another circle member cannot list someone else''s drafts'
);

select is(
  (
    select count(*)::bigint
      from public.get_entry_draft(
        '70000000-0000-4000-8000-000000000001'::uuid
      )
  ),
  0::bigint,
  'another member cannot load an unknown draft'
);

select throws_ok(
  $$select public.save_entry_draft(
    null,
    'thought',
    'Other circle',
    'Should not save.',
    'family',
    array['20000000-0000-4000-8000-000000000002']::uuid[],
    null,
    '{}',
    '',
    null,
    null,
    null,
    null,
    null,
    '[]'::jsonb,
    null
  )$$,
  '42501',
  'That draft could not be saved.',
  'a member cannot save a draft for a circle they do not belong to'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000007', true);

select throws_ok(
  $$select public.save_entry_draft(
    null, 'thought', 'No circle', 'Nope.', 'family'
  )$$,
  '42501',
  'That draft could not be saved.',
  'an account with no circle membership cannot save drafts'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select is(
  public.delete_entry_draft((select draft_id from public.list_entry_drafts())),
  true,
  'the author can delete their draft without posting'
);

select is(
  (select count(*)::bigint from public.list_entry_drafts()),
  0::bigint,
  'a deleted draft leaves the list'
);

select ok(
  (
    select relrowsecurity and relforcerowsecurity
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
     where namespace.nspname = 'private'
       and class.relname = 'entry_drafts'
  ),
  'entry drafts force RLS even in the private schema'
);

select throws_ok(
  $$
  do $cap$
  declare
    index integer;
  begin
    for index in 1..20 loop
      perform public.save_entry_draft(
        null,
        'thought',
        'Draft ' || index,
        'Body ' || index,
        'family'
      );
    end loop;
    perform public.save_entry_draft(
      null,
      'thought',
      'Draft 21',
      'Should fail',
      'family'
    );
  end
  $cap$;
  $$,
  'P0001',
  'Delete a draft first. You can keep up to 20.',
  'the 21st draft is refused until one is deleted'
);

select * from finish();
rollback;
