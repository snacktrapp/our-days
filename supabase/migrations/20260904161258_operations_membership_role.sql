-- Operations is a directory visibility label, not a weaker permission set.
-- Privileges stay organizer-equivalent: invites, membership admin, Insights,
-- and journal care. Family and People omit this presence; Account keeps it.

alter table public.circle_memberships
  add column directory_kind text not null default 'journal';

alter table public.circle_memberships
  add constraint circle_memberships_directory_kind_valid
  check (directory_kind in ('journal', 'operations'));

-- Prefer Auth email over display-name matching. Keep organizer privileges.
update public.circle_memberships as membership
   set directory_kind = 'operations',
       role = 'organizer'
  from auth.users as users
 where membership.user_id = users.id
   and membership.status = 'active'
   and lower(users.email) = 'tars-trapp@agentmail.to';

create or replace function private.tags_are_valid(
  requested_circle_id uuid,
  requested_journal_person_id uuid,
  requested_tagged_person_ids uuid[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select requested_tagged_person_ids is not null
    and cardinality(requested_tagged_person_ids) <= 25
    and not (requested_journal_person_id = any(requested_tagged_person_ids))
    and not exists (
      select 1 from unnest(requested_tagged_person_ids) as tagged(person_id)
      where tagged.person_id is null
    )
    and (
      select count(*) = cardinality(requested_tagged_person_ids)
      from (
        select distinct tagged.person_id
        from unnest(requested_tagged_person_ids) as tagged(person_id)
        join public.people as person
          on person.circle_id = requested_circle_id
         and person.id = tagged.person_id
        where not exists (
          select 1
            from public.circle_memberships as membership
           where membership.circle_id = requested_circle_id
             and membership.person_id = person.id
             and membership.status = 'active'
             and membership.directory_kind = 'operations'
        )
      ) as valid_tags
    );
$$;
