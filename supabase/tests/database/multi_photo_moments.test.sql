begin;

select plan(6);

select ok(
  exists (
    select 1
      from pg_catalog.pg_constraint as constraint
      join pg_catalog.pg_class as class
        on class.oid = constraint.conrelid
     where class.relname = 'moment_photos'
       and constraint.conname = 'moment_photos_moment_sort_unique'
       and constraint.contype = 'u'
  ),
  'moment_photos enforces unique sort_order per moment'
);

select ok(
  not exists (
    select 1
      from pg_catalog.pg_constraint as constraint
      join pg_catalog.pg_class as class
        on class.oid = constraint.conrelid
     where class.relname = 'moment_photos'
       and constraint.conname = 'moment_photos_moment_unique'
  ),
  'moment_photos no longer has a 1:1 uniqueness on moment_id'
);

select ok(
  exists (
    select 1
      from pg_catalog.pg_attribute as attribute
      join pg_catalog.pg_class as class
        on class.oid = attribute.attrelid
     where class.relname = 'moment_photos'
       and attribute.attname = 'sort_order'
       and not attribute.attisdropped
  ),
  'moment_photos has sort_order'
);

select ok(
  exists (
    select 1
      from pg_catalog.pg_attribute as attribute
      join pg_catalog.pg_class as class
        on class.oid = attribute.attrelid
     where class.relname = 'moment_photos'
       and attribute.attname = 'id'
       and not attribute.attisdropped
  ),
  'moment_photos has a row id'
);

select ok(
  has_function_privilege('authenticated', 'public.attach_photo_to_moment(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.remove_moment_photo(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.reorder_moment_photos(uuid, uuid[])', 'execute'),
  'authenticated members can attach, remove, and reorder album photos'
);

select ok(
  not has_function_privilege('anon', 'public.attach_photo_to_moment(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.remove_moment_photo(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.reorder_moment_photos(uuid, uuid[])', 'execute'),
  'anonymous callers cannot attach, remove, or reorder album photos'
);

select * from finish();
rollback;
