begin;

select plan(30);

select ok(
  (
    select bool_and(class.relrowsecurity)
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
     where namespace.nspname = 'public'
       and class.relname in ('circles', 'people', 'circle_memberships', 'person_guardians')
  ),
  'every exposed family table has RLS enabled'
);

select is(
  (
    select count(*)::bigint
      from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name in ('circles', 'people', 'circle_memberships', 'person_guardians')
       and grantee in ('anon', 'authenticated', 'PUBLIC')
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
  ),
  0::bigint,
  'browser roles have no direct family-table mutation privileges'
);

select ok(
  not has_function_privilege('anon', 'public.accept_invitation(text)', 'EXECUTE'),
  'anonymous callers cannot accept invitations'
);

select ok(
  has_function_privilege('authenticated', 'public.accept_invitation(text)', 'EXECUTE'),
  'authenticated callers can reach the guarded acceptance RPC'
);

select ok(
  (
    select bool_and(procedure.prosecdef and namespace.nspname = 'private')
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
     where procedure.proname in (
       'accept_invitation',
       'create_invitation',
       'revoke_invitation',
       'revoke_membership',
       'set_membership_role',
       'create_managed_person',
       'set_person_guardian'
     )
       and namespace.nspname = 'private'
  ),
  'security-definer mutation functions live only in private'
);

select ok(
  (
    select bool_and('search_path=""' = any(procedure.proconfig))
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'private'
       and procedure.prosecdef
  ),
  'every private security-definer function fixes an empty search path'
);

select is(
  (
    select count(*)::bigint
      from information_schema.routine_privileges
     where routine_schema = 'private'
       and grantee in ('anon', 'PUBLIC')
       and privilege_type = 'EXECUTE'
       and routine_name <> 'preflight_invitation'
  ),
  0::bigint,
  'only the invitation preflight may be executable anonymously in private'
);

select ok(
  (
    select pg_catalog.pg_get_constraintdef(con.oid) like '%FOREIGN KEY (circle_id, person_id)%'
      from pg_catalog.pg_constraint as con
     where con.conname = 'circle_memberships_person_fkey'
  ),
  'membership-to-person integrity includes circle_id'
);

select ok(
  (
    select pg_catalog.pg_get_constraintdef(con.oid) like '%FOREIGN KEY (circle_id, guardian_membership_id)%'
      from pg_catalog.pg_constraint as con
     where con.conname = 'person_guardians_guardian_fkey'
  ),
  'guardian-to-membership integrity includes circle_id'
);

select ok(
  (
    select pg_catalog.pg_get_constraintdef(con.oid) like '%FOREIGN KEY (circle_id, actor_membership_id)%'
      from pg_catalog.pg_constraint as con
     where con.conname = 'audit_events_actor_fkey'
  ),
  'audit attribution is circle-bound to a membership'
);

select is(
  (
    select count(*)::bigint
      from information_schema.columns
     where table_schema = 'private'
       and table_name = 'invitations'
       and column_name like '%email%'
       and data_type in ('text', 'character varying', 'character')
  ),
  0::bigint,
  'invitation email addresses are not stored as plaintext text columns'
);

select is(
  (select count(*)::bigint from storage.buckets where id in ('our-days-originals', 'our-days-display') and public),
  0::bigint,
  'Our Days storage buckets are private'
);

select ok(
  exists (
    select 1
      from pg_catalog.pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and policyname = 'our_days_storage_objects_closed_until_media_phase'
       and permissive = 'RESTRICTIVE'
  ),
  'media buckets remain explicitly closed until the media phase'
);

set local role anon;
select ok(
  not has_table_privilege(current_user, 'public.circles', 'SELECT'),
  'anonymous callers cannot select circles'
);
select ok(
  not has_table_privilege(current_user, 'public.people', 'SELECT'),
  'anonymous callers cannot select people'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is((select count(*)::bigint from public.circles), 1::bigint, 'circle A organizer sees one circle');
select is((select count(*)::bigint from public.people), 6::bigint, 'circle A organizer retains former-member attribution');
select is((select count(*)::bigint from public.person_guardians), 2::bigint, 'circle A organizer sees active guardian grants');
select ok(
  private.can_manage_person(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000008'
  ),
  'active guardian can manage the circle A child'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select is((select count(*)::bigint from public.circles), 1::bigint, 'ordinary member sees their circle');
select ok(
  not private.can_manage_person(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000008'
  ),
  'ordinary member cannot manage an unassigned child'
);
select ok(
  not private.is_circle_organizer('20000000-0000-4000-8000-000000000001'),
  'ordinary member has no organizer authority'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select is((select count(*)::bigint from public.circles), 2::bigint, 'dual-circle member sees both circles');
select ok(
  not private.is_circle_organizer('20000000-0000-4000-8000-000000000001'),
  'dual-circle member is not organizer in circle A'
);
select ok(
  private.is_circle_organizer('20000000-0000-4000-8000-000000000002'),
  'dual-circle member is organizer in circle B only'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select is((select count(*)::bigint from public.circles), 0::bigint, 'revoked member sees no circles with the same JWT identity');
select is((select count(*)::bigint from public.people), 0::bigint, 'revoked member sees no people with the same JWT identity');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000007', true);
select is((select count(*)::bigint from public.circles), 0::bigint, 'authenticated no-circle user sees no circles');
select is((select count(*)::bigint from public.circle_memberships), 0::bigint, 'authenticated no-circle user sees no memberships');
select ok(
  not private.is_circle_organizer('20000000-0000-4000-8000-000000000002'),
  'no-circle user cannot borrow organizer authority from circle B'
);
reset role;

select * from finish();
rollback;
