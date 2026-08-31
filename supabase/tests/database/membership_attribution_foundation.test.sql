begin;

select plan(42);

select ok(
  exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'moments'
       and column_name = 'recorded_by_membership_id'
       and data_type = 'uuid'
       and is_nullable = 'NO'
  ),
  'moment recorder attribution is a required membership UUID'
);

select ok(
  exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'moments'
       and column_name = 'trashed_by_membership_id'
       and data_type = 'uuid'
       and is_nullable = 'YES'
  ),
  'moment trash attribution is an optional membership UUID'
);

select ok(
  not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'moments'
       and column_name = 'recorded_by_user_id'
  ),
  'the physical moments table retains no Auth-user recorder column'
);

select ok(
  not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'moments'
       and column_name = 'trashed_by_user_id'
  ),
  'the physical moments table retains no Auth-user trash-actor column'
);

select ok(
  exists (
    select 1
      from pg_catalog.pg_constraint as constraint_row
      join pg_catalog.pg_class as source_table
        on source_table.oid = constraint_row.conrelid
      join pg_catalog.pg_namespace as source_schema
        on source_schema.oid = source_table.relnamespace
     where source_schema.nspname = 'public'
       and source_table.relname = 'moments'
       and constraint_row.conname = 'moments_recorded_by_membership_fkey'
       and pg_catalog.pg_get_constraintdef(constraint_row.oid) like
         'FOREIGN KEY (circle_id, recorded_by_membership_id) REFERENCES circle_memberships(circle_id, id) ON DELETE RESTRICT%'
  ),
  'recorder attribution requires a membership from the same circle'
);

select ok(
  exists (
    select 1
      from pg_catalog.pg_constraint as constraint_row
      join pg_catalog.pg_class as source_table
        on source_table.oid = constraint_row.conrelid
      join pg_catalog.pg_namespace as source_schema
        on source_schema.oid = source_table.relnamespace
     where source_schema.nspname = 'public'
       and source_table.relname = 'moments'
       and constraint_row.conname = 'moments_trashed_by_membership_fkey'
       and pg_catalog.pg_get_constraintdef(constraint_row.oid) like
         'FOREIGN KEY (circle_id, trashed_by_membership_id) REFERENCES circle_memberships(circle_id, id) ON DELETE RESTRICT%'
  ),
  'trash attribution requires a membership from the same circle'
);

select ok(
  (
    select constraint_row.convalidated
      from pg_catalog.pg_constraint as constraint_row
     where constraint_row.conname = 'moments_recorded_by_membership_fkey'
  ),
  'the recorder membership foreign key is fully validated'
);

select ok(
  (
    select constraint_row.convalidated
      from pg_catalog.pg_constraint as constraint_row
     where constraint_row.conname = 'moments_trashed_by_membership_fkey'
  ),
  'the trash-actor membership foreign key is fully validated'
);

select ok(
  exists (
    select 1
      from pg_catalog.pg_indexes
     where schemaname = 'public'
       and indexname = 'moments_recorded_by_membership_idx'
       and indexdef like '%USING btree (circle_id, recorded_by_membership_id)%'
  ),
  'membership recorder lookups retain a dedicated composite index'
);

select ok(
  exists (
    select 1
      from pg_catalog.pg_indexes
     where schemaname = 'public'
       and indexname = 'moments_trashed_by_membership_idx'
       and indexdef like '%USING btree (circle_id, trashed_by_membership_id)%'
       and indexdef like '%WHERE (trashed_by_membership_id IS NOT NULL)%'
  ),
  'membership trash-actor lookups retain a partial composite index'
);

select is(
  (
    select count(*)::bigint
      from public.moments
     where recorded_by_membership_id is null
  ),
  0::bigint,
  'every migrated or seeded moment preserves a recorder'
);

select ok(
  not exists (
    select 1
      from (
        values
          ('60000000-0000-4000-8000-000000000001'::uuid, '40000000-0000-4000-8000-000000000001'::uuid),
          ('60000000-0000-4000-8000-000000000002'::uuid, '40000000-0000-4000-8000-000000000001'::uuid),
          ('60000000-0000-4000-8000-000000000003'::uuid, '40000000-0000-4000-8000-000000000002'::uuid),
          ('60000000-0000-4000-8000-000000000004'::uuid, '40000000-0000-4000-8000-000000000003'::uuid),
          ('60000000-0000-4000-8000-000000000005'::uuid, '40000000-0000-4000-8000-000000000001'::uuid),
          ('60000000-0000-4000-8000-000000000006'::uuid, '40000000-0000-4000-8000-000000000006'::uuid),
          ('60000000-0000-4000-8000-000000000007'::uuid, '40000000-0000-4000-8000-000000000003'::uuid)
      ) as expected(moment_id, membership_id)
      left join public.moments as moment on moment.id = expected.moment_id
     where moment.recorded_by_membership_id is distinct from
       expected.membership_id
  ),
  'all synthetic history keeps the same human recorder after the cutover'
);

select is(
  (
    select trashed_by_membership_id
      from public.moments
     where id = '60000000-0000-4000-8000-000000000005'
  ),
  '40000000-0000-4000-8000-000000000001'::uuid,
  'existing trash attribution maps to the same actor membership'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);

select public.create_written_moment(
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'Membership-derived recorder fixture.',
  '2026-08-29'
) as moment_id \gset writer_

select isnt(
  :'writer_moment_id'::uuid,
  null::uuid,
  'the reviewed writer still creates a moment'
);

reset role;

select is(
  (
    select recorded_by_membership_id
      from public.moments
     where id = :'writer_moment_id'::uuid
  ),
  '40000000-0000-4000-8000-000000000001'::uuid,
  'the writer derives recorder identity from the active caller membership'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000005',
  true
);

select public.create_written_moment(
  '20000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000009',
  'Circle-specific recorder fixture.',
  '2026-08-29'
) as moment_id \gset dual_

select isnt(
  :'dual_moment_id'::uuid,
  null::uuid,
  'a dual-circle identity still writes where its local role permits'
);

reset role;

select is(
  (
    select recorded_by_membership_id
      from public.moments
     where id = :'dual_moment_id'::uuid
  ),
  '40000000-0000-4000-8000-000000000007'::uuid,
  'a dual-circle write records the membership from the requested circle'
);

select throws_ok(
  $$insert into public.moments (
    circle_id,
    journal_person_id,
    recorded_by_membership_id,
    body,
    occurred_on
  ) values (
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000006',
    'Cross-circle recorder attempt.',
    '2026-08-29'
  )$$,
  '23503',
  'insert or update on table "moments" violates foreign key constraint "moments_recorded_by_membership_fkey"',
  'a valid membership from another circle cannot become the recorder'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);

select is(
  public.set_written_moment_trashed(
    :'writer_moment_id'::uuid,
    1,
    true
  ),
  2::bigint,
  'the reviewed trash workflow still advances the revision'
);

reset role;

select is(
  (
    select trashed_by_membership_id
      from public.moments
     where id = :'writer_moment_id'::uuid
  ),
  '40000000-0000-4000-8000-000000000001'::uuid,
  'trash records the active caller membership rather than an Auth user ID'
);

select throws_ok(
  format(
    'update public.moments set recorded_by_membership_id = %L where id = %L',
    '40000000-0000-4000-8000-000000000002',
    :'writer_moment_id'
  ),
  '42501',
  'Moment identity is immutable',
  'recorder membership attribution remains immutable'
);

select ok(
  pg_catalog.pg_get_functiondef(
    'public.list_timeline_moments(uuid,uuid,date,boolean,timestamp with time zone,uuid,integer,timestamp with time zone)'::regprocedure
  ) like '%recorder_membership.id = moment.recorded_by_membership_id%',
  'the runtime timeline reader joins through membership identity'
);

select ok(
  pg_catalog.pg_get_functiondef(
    'public.list_timeline_moments(uuid,uuid,date,boolean,timestamp with time zone,uuid,integer,timestamp with time zone)'::regprocedure
  ) not like '%moment.recorded_by_user_id%',
  'the runtime timeline reader no longer depends on Auth-user attribution'
);

select ok(
  pg_catalog.pg_get_functiondef(
    'public.list_memory_moments(uuid,integer,integer,integer,date,boolean,timestamp with time zone,uuid,integer,timestamp with time zone)'::regprocedure
  ) like '%recorder_membership.id = moment.recorded_by_membership_id%',
  'the runtime memory reader joins through membership identity'
);

select ok(
  pg_catalog.pg_get_functiondef(
    'public.list_memory_moments(uuid,integer,integer,integer,date,boolean,timestamp with time zone,uuid,integer,timestamp with time zone)'::regprocedure
  ) not like '%moment.recorded_by_user_id%',
  'the runtime memory reader no longer depends on Auth-user attribution'
);

select ok(
  pg_catalog.pg_get_functiondef(
    'public.list_milestone_memories(uuid,date,boolean,timestamp with time zone,uuid,integer,timestamp with time zone)'::regprocedure
  ) like '%recorder_membership.id = moment.recorded_by_membership_id%',
  'the runtime milestone reader joins through membership identity'
);

select ok(
  pg_catalog.pg_get_functiondef(
    'public.list_milestone_memories(uuid,date,boolean,timestamp with time zone,uuid,integer,timestamp with time zone)'::regprocedure
  ) not like '%moment.recorded_by_user_id%',
  'the runtime milestone reader no longer depends on Auth-user attribution'
);

select ok(
  pg_catalog.pg_get_function_result(
    'public.list_timeline_moments(uuid,uuid,date,boolean,timestamp with time zone,uuid,integer,timestamp with time zone)'::regprocedure
  ) like '%recorder_person_id uuid, recorder_person_name text%'
  and pg_catalog.pg_get_function_result(
    'public.list_timeline_moments(uuid,uuid,date,boolean,timestamp with time zone,uuid,integer,timestamp with time zone)'::regprocedure
  ) not like '%membership_id%',
  'the public timeline response keeps its recorder-person contract'
);

select ok(
  (
    select procedure.provolatile = 's'
      and not procedure.prosecdef
      and 'search_path=""' = any(procedure.proconfig)
      from pg_catalog.pg_proc as procedure
     where procedure.oid =
       'public.list_timeline_moments(uuid,uuid,date,boolean,timestamp with time zone,uuid,integer,timestamp with time zone)'::regprocedure
  ),
  'the timeline reader remains stable, invoker, and fixed-path'
);

select ok(
  pg_catalog.pg_get_function_result(
    'public.list_memory_moments(uuid,integer,integer,integer,date,boolean,timestamp with time zone,uuid,integer,timestamp with time zone)'::regprocedure
  ) like '%recorder_person_id uuid, recorder_person_name text%'
  and pg_catalog.pg_get_function_result(
    'public.list_memory_moments(uuid,integer,integer,integer,date,boolean,timestamp with time zone,uuid,integer,timestamp with time zone)'::regprocedure
  ) not like '%membership_id%',
  'the public memory response keeps its recorder-person contract'
);

select ok(
  pg_catalog.pg_get_function_result(
    'public.list_milestone_memories(uuid,date,boolean,timestamp with time zone,uuid,integer,timestamp with time zone)'::regprocedure
  ) like '%recorder_person_id uuid, recorder_person_name text%'
  and pg_catalog.pg_get_function_result(
    'public.list_milestone_memories(uuid,date,boolean,timestamp with time zone,uuid,integer,timestamp with time zone)'::regprocedure
  ) not like '%membership_id%',
  'the public milestone response keeps its recorder-person contract'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);

select is(
  (
    select recorder_person_id
      from public.list_timeline_moments(
        '20000000-0000-4000-8000-000000000001'
      )
     where moment_id = '60000000-0000-4000-8000-000000000001'
  ),
  '30000000-0000-4000-8000-000000000001'::uuid,
  'timeline responses preserve recorder person identity'
);

select is(
  (
    select recorder_person_name
      from public.list_timeline_moments(
        '20000000-0000-4000-8000-000000000001'
      )
     where moment_id = '60000000-0000-4000-8000-000000000001'
  ),
  'A Organizer One',
  'timeline responses preserve recorder display attribution'
);

select is(
  (
    select recorder_person_id
      from public.list_memory_moments(
        circle_id => '20000000-0000-4000-8000-000000000001',
        memory_year => 2020
      )
     where moment_id = '60000000-0000-4000-8000-000000000007'
  ),
  '30000000-0000-4000-8000-000000000003'::uuid,
  'memory responses preserve recorder person identity'
);

select is(
  (
    select recorder_person_name
      from public.list_memory_moments(
        circle_id => '20000000-0000-4000-8000-000000000001',
        memory_year => 2020
      )
     where moment_id = '60000000-0000-4000-8000-000000000007'
  ),
  'A Member',
  'memory responses preserve recorder display attribution'
);

select is(
  (
    select recorder_person_id
      from public.list_milestone_memories(
        '20000000-0000-4000-8000-000000000001'
      )
     where moment_id = '60000000-0000-4000-8000-000000000007'
  ),
  '30000000-0000-4000-8000-000000000003'::uuid,
  'milestone responses preserve recorder person identity'
);

select is(
  (
    select recorder_person_name
      from public.list_milestone_memories(
        '20000000-0000-4000-8000-000000000001'
      )
     where moment_id = '60000000-0000-4000-8000-000000000007'
  ),
  'A Member',
  'milestone responses preserve recorder display attribution'
);

reset role;

select ok(
  exists (
    select 1
      from pg_catalog.pg_constraint as constraint_row
      join pg_catalog.pg_class as source_table
        on source_table.oid = constraint_row.conrelid
      join pg_catalog.pg_namespace as source_schema
        on source_schema.oid = source_table.relnamespace
     where source_schema.nspname = 'public'
       and source_table.relname = 'circle_memberships'
       and constraint_row.conname = 'circle_memberships_user_id_fkey'
       and constraint_row.confdeltype = 'r'
  ),
  'this foundation intentionally keeps Auth deletion restricted'
);

select ok(
  exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'circle_memberships'
       and column_name = 'user_id'
       and is_nullable = 'YES'
  ),
  'the closure schema permits a revoked membership to detach from Auth'
);

select throws_ok(
  $$delete from auth.users
     where id = '10000000-0000-4000-8000-000000000004'$$,
  '23503',
  'update or delete on table "users" violates foreign key constraint "circle_memberships_user_id_fkey" on table "circle_memberships"',
  'even a revoked membership still blocks Auth deletion in this slice'
);

select is(
  (
    select count(*)::bigint
      from auth.users
     where id = '10000000-0000-4000-8000-000000000004'
  ),
  1::bigint,
  'a blocked Auth deletion leaves the account row intact'
);

select is(
  (
    select user_id
      from public.circle_memberships
     where id = '40000000-0000-4000-8000-000000000004'
  ),
  '10000000-0000-4000-8000-000000000004'::uuid,
  'a blocked Auth deletion leaves revoked membership attribution attached'
);

select * from finish();
rollback;
