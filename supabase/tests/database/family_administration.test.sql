begin;

select plan(27);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select public.set_membership_role(
  '40000000-0000-4000-8000-000000000003', 'member'
);
set local role postgres;
select is(
  (select count(*)::bigint from private.audit_events
    where event_type in (
      'membership_role_changed', 'membership_promoted', 'membership_demoted'
    )
      and subject_id = '40000000-0000-4000-8000-000000000003'),
  0::bigint,
  'a repeated role request does not create false audit history'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select public.set_membership_role(
  '40000000-0000-4000-8000-000000000003', 'organizer'
);
select is(
  (select role from public.circle_memberships
    where id = '40000000-0000-4000-8000-000000000003'),
  'organizer',
  'an organizer can promote an active same-circle member'
);
set local role postgres;
select is(
  (select count(*)::bigint from private.audit_events
    where event_type = 'membership_promoted'
      and subject_id = '40000000-0000-4000-8000-000000000003'),
  1::bigint,
  'a real promotion creates one attributed audit event'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select public.set_membership_role(
  '40000000-0000-4000-8000-000000000003', 'member'
);
select is(
  (select role from public.circle_memberships
    where id = '40000000-0000-4000-8000-000000000003'),
  'member',
  'an organizer can demote another organizer while one remains'
);
set local role postgres;
select is(
  (select count(*)::bigint from private.audit_events
    where event_type = 'membership_demoted'
      and subject_id = '40000000-0000-4000-8000-000000000003'),
  1::bigint,
  'a real demotion creates one directional audit event'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.set_membership_role(
    '40000000-0000-4000-8000-000000000006', 'member'
  )$$,
  '22023', 'Role could not be changed',
  'role changes cannot cross circle boundaries'
);
select throws_ok(
  $$select public.set_membership_role(
    '40000000-0000-4000-8000-000000000003', null
  )$$,
  '22023', 'Role could not be changed',
  'null role input follows the generic database denial contract'
);

select public.set_person_guardian(
  '30000000-0000-4000-8000-000000000008',
  '40000000-0000-4000-8000-000000000003',
  true
) as guardian_id \gset new_guardian_
select isnt(:'new_guardian_guardian_id'::uuid, null::uuid,
  'an organizer can assign an active account to a managed journal');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select ok(
  private.can_manage_person(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000008'
  ),
  'an explicit guardian immediately gains managed-journal authority'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select public.set_person_guardian(
  '30000000-0000-4000-8000-000000000008',
  '40000000-0000-4000-8000-000000000003',
  true
);
set local role postgres;
select is(
  (select count(*)::bigint from private.audit_events
    where event_type = 'guardian_added'
      and subject_id = :'new_guardian_guardian_id'::uuid),
  1::bigint,
  'a repeated guardian grant is an audit-idempotent success'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select public.set_person_guardian(
  '30000000-0000-4000-8000-000000000008',
  '40000000-0000-4000-8000-000000000003',
  false
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select ok(
  not private.can_manage_person(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000008'
  ),
  'removing an explicit grant immediately removes member care authority'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select public.set_person_guardian(
  '30000000-0000-4000-8000-000000000008',
  '40000000-0000-4000-8000-000000000003',
  false
);
set local role postgres;
select is(
  (select count(*)::bigint from private.audit_events
    where event_type = 'guardian_removed'
      and subject_id = :'new_guardian_guardian_id'::uuid),
  1::bigint,
  'a repeated guardian removal is an audit-idempotent success'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select public.set_person_guardian(
  '30000000-0000-4000-8000-000000000008',
  '40000000-0000-4000-8000-000000000003',
  true
) as guardian_id \gset replacement_guardian_
select isnt(
  :'replacement_guardian_guardian_id'::uuid,
  :'new_guardian_guardian_id'::uuid,
  're-adding a removed guardian creates a new durable grant event'
);

select throws_ok(
  $$select public.set_person_guardian(
    '30000000-0000-4000-8000-000000000009',
    '40000000-0000-4000-8000-000000000003', true
  )$$,
  '22023', 'Guardian access could not be changed',
  'guardian changes cannot target another circle managed journal'
);
select throws_ok(
  $$select public.set_person_guardian(
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000003', true
  )$$,
  '22023', 'Guardian access could not be changed',
  'account profiles cannot receive guardian grants'
);
select throws_ok(
  $$select public.set_person_guardian(
    '30000000-0000-4000-8000-000000000008',
    '40000000-0000-4000-8000-000000000004', true
  )$$,
  '22023', 'Guardian access could not be changed',
  'revoked memberships cannot receive guardian grants'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.set_membership_role(
    '40000000-0000-4000-8000-000000000005', 'organizer'
  )$$,
  '22023', 'Role could not be changed',
  'an ordinary member cannot change another role'
);
select throws_ok(
  $$select public.set_person_guardian(
    '30000000-0000-4000-8000-000000000008',
    '40000000-0000-4000-8000-000000000005', true
  )$$,
  '22023', 'Guardian access could not be changed',
  'an ordinary member cannot assign guardians'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$select public.set_membership_role(
    '40000000-0000-4000-8000-000000000003', 'organizer'
  )$$,
  '22023', 'Role could not be changed',
  'a revoked member cannot change roles with a stale JWT'
);
select throws_ok(
  $$select public.set_person_guardian(
    '30000000-0000-4000-8000-000000000008',
    '40000000-0000-4000-8000-000000000005', true
  )$$,
  '22023', 'Guardian access could not be changed',
  'a revoked member cannot assign guardians with a stale JWT'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000007', true);
select throws_ok(
  $$select public.set_membership_role(
    '40000000-0000-4000-8000-000000000003', 'organizer'
  )$$,
  '22023', 'Role could not be changed',
  'a no-circle account cannot change roles'
);
select throws_ok(
  $$select public.set_person_guardian(
    '30000000-0000-4000-8000-000000000008',
    '40000000-0000-4000-8000-000000000005', true
  )$$,
  '22023', 'Guardian access could not be changed',
  'a no-circle account cannot assign guardians'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', true);
select public.set_membership_role(
  '40000000-0000-4000-8000-000000000007', 'member'
);
select throws_ok(
  $$select public.set_membership_role(
    '40000000-0000-4000-8000-000000000006', 'member'
  )$$,
  '23514', 'A circle must retain an active organizer',
  'the last organizer invariant remains final under role changes'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select public.revoke_membership('40000000-0000-4000-8000-000000000005');
select public.revoke_membership('40000000-0000-4000-8000-000000000005');
select is(
  (select status from public.circle_memberships
    where id = '40000000-0000-4000-8000-000000000005'),
  'revoked',
  'a repeated same-circle membership removal remains durably revoked'
);
set local role postgres;
select is(
  (select count(*)::bigint from private.audit_events
    where event_type = 'membership_revoked'
      and subject_id = '40000000-0000-4000-8000-000000000005'),
  1::bigint,
  'a repeated membership removal creates one audit event'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select public.set_person_guardian(
  '30000000-0000-4000-8000-000000000008',
  '40000000-0000-4000-8000-000000000001',
  false
);
select ok(
  private.can_manage_person(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000008'
  ),
  'an organizer manages managed child journals after their explicit grant is removed'
);
select ok(
  not private.can_manage_person(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002'
  ),
  'organizer authority never permits editing another adult account journal'
);

reset role;

select * from finish();
rollback;
