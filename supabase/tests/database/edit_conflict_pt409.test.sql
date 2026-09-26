begin;

select plan(7);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select public.create_written_moment(
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'Conflict probe thought.',
  '2026-08-29'
) as moment_id \gset

select public.create_moment_note(
  :'moment_id'::uuid,
  'Conflict probe note.'
) as note_id \gset

select throws_ok(
  format(
    'select public.update_written_moment(%L::uuid, 999, %L, %L::date)',
    :'moment_id',
    'A stale thought must not land.',
    '2026-08-29'
  ),
  'PT409',
  'Moment changed elsewhere',
  'update_written_moment raises PT409 on a stale expected revision'
);

select throws_ok(
  format(
    'select public.update_family_moment(%L::uuid, 999, null, %L, null, ''{}''::uuid[], %L::date)',
    :'moment_id',
    'A stale family edit must not land.',
    '2026-08-29'
  ),
  'PT409',
  'Moment changed elsewhere',
  'update_family_moment raises PT409 on a stale expected revision'
);

select throws_ok(
  format(
    'select public.set_written_moment_trashed(%L::uuid, 999, true)',
    :'moment_id'
  ),
  'PT409',
  'Moment changed elsewhere',
  'set_written_moment_trashed raises PT409 on a stale expected revision'
);

select throws_ok(
  format(
    'select public.set_moment_audience(%L::uuid, 999, ''family'', array[''20000000-0000-4000-8000-000000000001''::uuid])',
    :'moment_id'
  ),
  'PT409',
  'Moment changed elsewhere',
  'set_moment_audience raises PT409 on a stale expected revision'
);

select throws_ok(
  format(
    'select public.update_moment_note(%L::uuid, 999, %L)',
    :'note_id',
    'A stale note must not land.'
  ),
  'PT409',
  'Note changed elsewhere',
  'update_moment_note raises PT409 on a stale expected revision'
);

select throws_ok(
  format(
    'select public.trash_moment_note(%L::uuid, 999)',
    :'note_id'
  ),
  'PT409',
  'Note changed elsewhere',
  'trash_moment_note raises PT409 on a stale expected revision'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);

select public.create_family_moment(
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000005',
  'thought',
  null,
  'Private conflict probe.',
  null,
  '{}',
  '2026-08-29',
  null,
  null,
  null,
  null,
  'just_me',
  '{}'
) as share_moment_id \gset

select throws_ok(
  format(
    'select public.share_private_moment(%L::uuid, 999, ''20000000-0000-4000-8000-000000000002''::uuid, null, %L, null, ''{}''::uuid[], %L::date)',
    :'share_moment_id',
    'A stale share must not land.',
    '2026-08-29'
  ),
  'PT409',
  'Moment changed elsewhere',
  'share_private_moment raises PT409 on a stale expected revision'
);

select * from finish();
rollback;
