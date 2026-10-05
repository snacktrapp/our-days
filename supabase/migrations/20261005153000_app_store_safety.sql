-- App Store safety: report, block, terms acceptance, and automated account deletion.
-- Additive only. Existing request_account_closure and prepare_account_closure
-- keep their signatures and behavior. prepare_account_closure still preserves
-- remaining family history. Authored-content removal is a separate step that
-- runs before preparation, inside private.purge_account_authored_content.
-- Browser roles receive no table privileges. Scheduling uses pg_cron when the
-- server allows it, and email uses the Vault secret resend_api_key with pg_net.
-- Neither secret is stored in this migration.

create table private.content_reports (
  id uuid primary key default extensions.gen_random_uuid(),
  reporter_user_id uuid not null,
  target_kind text not null,
  target_id uuid not null,
  reason text not null,
  details text,
  circle_id uuid not null references public.circles (id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  notified_at timestamptz,
  constraint content_reports_target_kind_valid check (
    target_kind in ('moment', 'note')
  ),
  constraint content_reports_reason_valid check (
    reason in (
      'harassment', 'hate', 'sexual', 'violence', 'child_safety', 'spam', 'other'
    )
  ),
  constraint content_reports_details_valid check (
    details is null
    or (
      details = btrim(details)
      and char_length(details) between 1 and 2000
    )
  ),
  constraint content_reports_reporter_target_key unique (
    reporter_user_id, target_kind, target_id
  )
);

create index content_reports_target_idx
  on private.content_reports (target_kind, target_id);

create table private.member_blocks (
  id uuid primary key default extensions.gen_random_uuid(),
  blocker_user_id uuid not null,
  blocked_user_id uuid not null,
  blocked_membership_id uuid not null references public.circle_memberships (id)
    on delete restrict,
  blocked_at timestamptz not null default statement_timestamp(),
  constraint member_blocks_not_self check (blocker_user_id <> blocked_user_id),
  constraint member_blocks_pair_key unique (blocker_user_id, blocked_user_id)
);

create index member_blocks_blocked_idx
  on private.member_blocks (blocked_user_id);

create table private.terms_acceptances (
  user_id uuid not null,
  terms_version text not null,
  accepted_at timestamptz not null default statement_timestamp(),
  primary key (user_id, terms_version),
  constraint terms_acceptances_version_valid check (
    terms_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  )
);

create table private.account_deletion_runs (
  closure_request_id uuid primary key references private.account_closure_requests (id)
    on delete restrict,
  content_purged_at timestamptz,
  storage_purged_at timestamptz,
  prepared_at timestamptz,
  auth_deleted_at timestamptz,
  receipt_email text,
  receipt_sent_at timestamptz,
  completed_at timestamptz,
  attempt_count integer not null default 0,
  leased_until timestamptz,
  last_error_code text,
  updated_at timestamptz not null default statement_timestamp(),
  constraint account_deletion_runs_error_code_valid check (
    last_error_code is null or last_error_code ~ '^[0-9A-Z]{5}$'
  ),
  constraint account_deletion_runs_attempt_valid check (attempt_count >= 0)
);

create table private.account_deletion_completions (
  closure_request_id uuid primary key references private.account_closure_requests (id)
    on delete restrict,
  completed_at timestamptz not null default statement_timestamp()
);

create table private.safety_outbound_mail (
  id uuid primary key default extensions.gen_random_uuid(),
  kind text not null,
  report_id uuid references private.content_reports (id) on delete restrict,
  closure_request_id uuid references private.account_closure_requests (id)
    on delete restrict,
  recipient text,
  subject text not null,
  body text,
  net_request_id bigint,
  attempt_count integer not null default 0,
  sent_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint safety_outbound_mail_kind_valid check (
    kind in ('report', 'deletion_receipt')
  ),
  constraint safety_outbound_mail_attempt_valid check (attempt_count >= 0)
);

create unique index safety_outbound_mail_report_idx
  on private.safety_outbound_mail (report_id)
  where report_id is not null;

create unique index safety_outbound_mail_closure_idx
  on private.safety_outbound_mail (closure_request_id)
  where closure_request_id is not null;

alter table private.content_reports enable row level security;
alter table private.content_reports force row level security;
alter table private.member_blocks enable row level security;
alter table private.member_blocks force row level security;
alter table private.terms_acceptances enable row level security;
alter table private.terms_acceptances force row level security;
alter table private.account_deletion_runs enable row level security;
alter table private.account_deletion_runs force row level security;
alter table private.account_deletion_completions enable row level security;
alter table private.account_deletion_completions force row level security;
alter table private.safety_outbound_mail enable row level security;
alter table private.safety_outbound_mail force row level security;

revoke all on table private.content_reports
  from public, anon, authenticated, service_role;
revoke all on table private.member_blocks
  from public, anon, authenticated, service_role;
revoke all on table private.terms_acceptances
  from public, anon, authenticated, service_role;
revoke all on table private.account_deletion_runs
  from public, anon, authenticated, service_role;
revoke all on table private.account_deletion_completions
  from public, anon, authenticated, service_role;
revoke all on table private.safety_outbound_mail
  from public, anon, authenticated, service_role;

create function private.viewer_reported(target_kind text, target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from private.content_reports as report
     where report.reporter_user_id = (select auth.uid())
       and report.target_kind = viewer_reported.target_kind
       and report.target_id = viewer_reported.target_id
  );
$$;

create function private.viewer_hides_author(author_membership_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.circle_memberships as author
      join private.member_blocks as block
        on block.blocked_user_id = author.user_id
       and block.blocker_user_id = (select auth.uid())
     where author.id = viewer_hides_author.author_membership_id
       and author.user_id is not null
  );
$$;

create function private.viewer_hides_note(note_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.moment_notes as note
     where note.id = viewer_hides_note.note_id
       and (
         (select private.viewer_reported('note', note.id))
         or (select private.viewer_hides_author(note.author_membership_id))
       )
  );
$$;

create function private.viewer_hides_reaction(reaction_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.moment_reactions as reaction
     where reaction.id = viewer_hides_reaction.reaction_id
       and (select private.viewer_hides_author(reaction.author_membership_id))
  );
$$;

create function private.viewer_hides_heart(heart_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.moment_note_reactions as heart
     where heart.id = viewer_hides_heart.heart_id
       and (select private.viewer_hides_author(heart.author_membership_id))
  );
$$;

-- Policies stay security invoker. They must not read private.member_blocks
-- directly, or every live timeline and memory read fails with permission denied.
create function private.viewer_hides_tagged_person(
  circle_id uuid,
  person_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.circle_memberships as tagged
      join private.member_blocks as block
        on block.blocked_user_id = tagged.user_id
       and block.blocker_user_id = (select auth.uid())
     where tagged.circle_id = viewer_hides_tagged_person.circle_id
       and tagged.person_id = viewer_hides_tagged_person.person_id
       and tagged.user_id is not null
  );
$$;

create or replace function private.can_read_live_moment(requested_moment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.moments as moment
     where moment.id = requested_moment_id
       and moment.trashed_at is null
       and not (select private.viewer_reported('moment', moment.id))
       and not (select private.viewer_hides_author(moment.recorded_by_membership_id))
       and (
         (
           moment.audience = 'just_me'
           and (select private.is_active_circle_member(moment.circle_id))
           and (select private.can_read_moment_audience(
             moment.circle_id,
             moment.audience,
             moment.recorded_by_membership_id
           ))
         )
         or (
           moment.audience = 'family'
           and exists (
             select 1
               from public.moment_circles as link
              where link.moment_id = moment.id
                and (select private.is_active_circle_member(link.circle_id))
           )
         )
       )
  );
$$;

drop policy moment_notes_select_live_parent on public.moment_notes;

create policy moment_notes_select_live_parent
on public.moment_notes for select to authenticated
using (
  trashed_at is null
  and (select private.can_read_live_moment(moment_id))
  and not (select private.viewer_hides_note(id))
);

drop policy moment_reactions_select_live_parent on public.moment_reactions;

create policy moment_reactions_select_live_parent
on public.moment_reactions for select to authenticated
using (
  removed_at is null
  and (select private.can_read_live_moment(moment_id))
  and not (select private.viewer_hides_reaction(id))
);

drop policy moment_note_reactions_select_live_parent on public.moment_note_reactions;

create policy moment_note_reactions_select_live_parent
on public.moment_note_reactions for select to authenticated
using (
  removed_at is null
  and exists (
    select 1
      from public.moment_notes as note
     where note.circle_id = moment_note_reactions.circle_id
       and note.id = moment_note_reactions.note_id
       and note.moment_id = moment_note_reactions.moment_id
       and note.trashed_at is null
  )
  and (select private.can_read_live_moment(moment_id))
  and not (select private.viewer_hides_heart(id))
  and not (select private.viewer_hides_note(note_id))
);

drop policy moment_people_select_live_parent on public.moment_people;

create policy moment_people_select_live_parent
on public.moment_people for select to authenticated
using (
  removed_at is null
  and (select private.can_read_live_moment(moment_id))
  and not (select private.viewer_hides_author(tagged_by_membership_id))
  and not (select private.viewer_hides_tagged_person(circle_id, person_id))
);

drop policy content_mentions_select_visible_moment on public.content_mentions;

create policy content_mentions_select_visible_moment
on public.content_mentions for select to authenticated
using (
  removed_at is null
  and (select private.can_read_live_moment(moment_id))
  and not (select private.viewer_hides_author(author_membership_id))
  and not (
    note_id is not null
    and (select private.viewer_reported('note', note_id))
  )
  and not (
    note_id is null
    and (select private.viewer_reported('moment', moment_id))
  )
);

create or replace function private.get_moment_conversation(requested_moment_id uuid)
returns table (notes jsonb, reactions jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', note.id,
        'authorPersonId', note_author.id,
        'authorName', note_author.display_name,
        'authorAccent', note_author.accent_token,
        'body', note.body,
        'revision', note.revision,
        'createdAt', note.created_at,
        'canChange', note_membership.user_id = (select auth.uid()),
        'heartCount', (
          select count(*)::int
            from public.moment_note_reactions as heart
           where heart.note_id = note.id
             and heart.removed_at is null
             and not (select private.viewer_hides_heart(heart.id))
        ),
        'heartedByViewer', exists (
          select 1
            from public.moment_note_reactions as heart
           where heart.note_id = note.id
             and heart.removed_at is null
             and heart.author_user_id = (select auth.uid())
             and not (select private.viewer_hides_heart(heart.id))
        ),
        'heartNames', coalesce((
          select jsonb_agg(heart_author.display_name order by heart.created_at, heart.id)
            from public.moment_note_reactions as heart
            join public.circle_memberships as heart_membership
              on heart_membership.id = heart.author_membership_id
            join public.people as heart_author
              on heart_author.circle_id = heart_membership.circle_id
             and heart_author.id = heart_membership.person_id
           where heart.note_id = note.id
             and heart.removed_at is null
             and not (select private.viewer_hides_heart(heart.id))
        ), '[]'::jsonb)
      ) order by note.created_at, note.id)
      from public.moment_notes as note
      join public.circle_memberships as note_membership
        on note_membership.id = note.author_membership_id
      join public.people as note_author
        on note_author.circle_id = note_membership.circle_id
       and note_author.id = note_membership.person_id
      where note.circle_id = moment.circle_id and note.moment_id = moment.id
        and note.trashed_at is null
        and not (select private.viewer_hides_note(note.id))
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', reaction.id,
        'personId', reaction_author.id,
        'personName', reaction_author.display_name,
        'personAccent', reaction_author.accent_token,
        'reactionId', reaction.reaction_type,
        'revision', reaction.revision,
        'isCurrentMember', reaction_membership.user_id = (select auth.uid())
      ) order by reaction.created_at, reaction.id)
      from public.moment_reactions as reaction
      join public.circle_memberships as reaction_membership
        on reaction_membership.id = reaction.author_membership_id
      join public.people as reaction_author
        on reaction_author.circle_id = reaction_membership.circle_id
       and reaction_author.id = reaction_membership.person_id
      where reaction.circle_id = moment.circle_id
        and reaction.moment_id = moment.id
        and reaction.removed_at is null
        and not (select private.viewer_hides_reaction(reaction.id))
    ), '[]'::jsonb)
  from public.moments as moment
  where moment.id = requested_moment_id
    and moment.trashed_at is null
    and (select private.can_read_live_moment(moment.id));
$$;

create or replace function private.moment_tagged_people(requested_moment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not (select private.can_read_live_moment(requested_moment_id)) then
      '[]'::jsonb
    else
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', tagged_person.id,
          'name', tagged_person.display_name
        ) order by tagged_person.display_name, tagged_person.id)
        from public.moment_people as tag
        join public.people as tagged_person
          on tagged_person.circle_id = tag.circle_id
         and tagged_person.id = tag.person_id
        where tag.moment_id = requested_moment_id
          and tag.removed_at is null
          and not (select private.viewer_hides_author(tag.tagged_by_membership_id))
          and not (select private.viewer_hides_tagged_person(tag.circle_id, tag.person_id))
      ), '[]'::jsonb)
  end;
$$;

create or replace function private.list_visible_content_mentions(moment_ids uuid[])
returns table (
  moment_id uuid,
  note_id uuid,
  mentioned_user_id uuid,
  start_offset integer,
  end_offset integer,
  display_name text,
  active boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    mention.moment_id,
    mention.note_id,
    mention.mentioned_user_id,
    mention.start_offset,
    mention.end_offset,
    case when member_name.display_name is null then null else member_name.display_name end,
    member_name.display_name is not null
  from public.content_mentions as mention
  left join lateral (
    select person.display_name
    from public.circle_memberships as membership
    join public.people as person
      on person.circle_id = membership.circle_id
     and person.id = membership.person_id
    where membership.user_id = mention.mentioned_user_id
      and membership.status = 'active'
      and (
        membership.circle_id = mention.circle_id
        or exists (
          select 1
          from public.moment_circles as link
          where link.moment_id = mention.moment_id
            and link.circle_id = membership.circle_id
        )
      )
    order by (membership.circle_id = mention.circle_id) desc, person.display_name
    limit 1
  ) as member_name on true
  where auth.uid() is not null
    and coalesce(cardinality(moment_ids), 0) between 1 and 100
    and mention.moment_id = any (moment_ids)
    and mention.removed_at is null
    and (select private.can_read_live_moment(mention.moment_id))
    and not (select private.viewer_hides_author(mention.author_membership_id))
    and not (
      mention.note_id is not null
      and (select private.viewer_reported('note', mention.note_id))
    )
    and not (
      mention.note_id is null
      and (select private.viewer_reported('moment', mention.moment_id))
    );
$$;

create or replace function private.list_my_mention_notifications()
returns table (
  mention_id uuid,
  moment_id uuid,
  note_id uuid,
  actor_membership_id uuid,
  actor_name text,
  snippet text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    mention.id,
    mention.moment_id,
    mention.note_id,
    mention.author_membership_id,
    coalesce(person.display_name, 'Family'),
    left(regexp_replace(
      coalesce(note.body, moment.body, ''),
      '[[:space:]]+',
      ' ',
      'g'
    ), 80),
    mention.created_at
  from public.content_mentions as mention
  join public.moments as moment
    on moment.id = mention.moment_id
   and moment.circle_id = mention.circle_id
  join public.circle_memberships as author
    on author.circle_id = mention.circle_id
   and author.id = mention.author_membership_id
  join public.people as person
    on person.circle_id = author.circle_id
   and person.id = author.person_id
  left join public.moment_notes as note
    on note.id = mention.note_id
   and note.trashed_at is null
  where auth.uid() is not null
    and mention.mentioned_user_id = auth.uid()
    and mention.mentioned_user_id is distinct from author.user_id
    and mention.removed_at is null
    and moment.trashed_at is null
    and moment.audience = 'family'
    and moment.kind <> 'insight'
    and (mention.note_id is null or note.id is not null)
    and (select private.can_read_live_moment(moment.id))
    and not (select private.viewer_hides_author(mention.author_membership_id))
    and not (
      mention.note_id is not null
      and (select private.viewer_reported('note', mention.note_id))
    )
    and not (
      mention.note_id is null
      and (select private.viewer_reported('moment', mention.moment_id))
    )
  order by mention.created_at desc
  limit 40;
$$;

create function public.report_content(
  target_kind text,
  target_id uuid,
  reason text,
  details text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized_kind text := lower(btrim(coalesce(target_kind, '')));
  normalized_reason text := lower(btrim(coalesce(reason, '')));
  normalized_details text := nullif(btrim(coalesce(details, '')), '');
  existing_id uuid;
  target_circle_id uuid;
  resulting_id uuid;
begin
  if current_user_id is null
    or target_id is null
    or normalized_kind not in ('moment', 'note')
    or normalized_reason not in (
      'harassment', 'hate', 'sexual', 'violence', 'child_safety', 'spam', 'other'
    )
    or (
      normalized_details is not null
      and char_length(normalized_details) > 2000
    ) then
    raise exception using
      errcode = '22023',
      message = 'Content could not be reported';
  end if;

  select report.id
    into existing_id
    from private.content_reports as report
   where report.reporter_user_id = current_user_id
     and report.target_kind = normalized_kind
     and report.target_id = report_content.target_id;

  if existing_id is not null then
    return existing_id;
  end if;

  if normalized_kind = 'moment' then
    select moment.circle_id
      into target_circle_id
      from public.moments as moment
     where moment.id = report_content.target_id
       and (select private.can_read_live_moment(moment.id));
  else
    select note.circle_id
      into target_circle_id
      from public.moment_notes as note
     where note.id = report_content.target_id
       and note.trashed_at is null
       and (select private.can_read_live_moment(note.moment_id))
       and not (select private.viewer_hides_note(note.id));
  end if;

  if target_circle_id is null then
    raise exception using
      errcode = '42501',
      message = 'Content could not be reported';
  end if;

  insert into private.content_reports (
    reporter_user_id,
    target_kind,
    target_id,
    reason,
    details,
    circle_id
  ) values (
    current_user_id,
    normalized_kind,
    report_content.target_id,
    normalized_reason,
    normalized_details,
    target_circle_id
  )
  returning id into resulting_id;

  insert into private.safety_outbound_mail (
    kind,
    report_id,
    recipient,
    subject
  ) values (
    'report',
    resulting_id,
    'team@beelinetech.co',
    'Our Days content report'
  );

  return resulting_id;
exception
  when unique_violation then
    select report.id
      into existing_id
      from private.content_reports as report
     where report.reporter_user_id = current_user_id
       and report.target_kind = normalized_kind
       and report.target_id = report_content.target_id;
    return existing_id;
end;
$$;

create function public.block_member(target_membership_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target public.circle_memberships%rowtype;
begin
  if current_user_id is null or target_membership_id is null then
    raise exception using
      errcode = '22023',
      message = 'This person cannot be blocked';
  end if;

  select membership.*
    into target
    from public.circle_memberships as membership
   where membership.id = target_membership_id;

  if target.id is null
    or target.user_id is null
    or target.user_id = current_user_id then
    raise exception using
      errcode = '22023',
      message = 'This person cannot be blocked';
  end if;

  if not (
    exists (
      select 1
        from public.circle_memberships as mine
       where mine.user_id = current_user_id
         and mine.status = 'active'
         and mine.circle_id = target.circle_id
         and target.status = 'active'
    )
    or exists (
      select 1
        from public.moments as moment
       where moment.recorded_by_membership_id = target.id
         and (select private.can_read_live_moment(moment.id))
    )
    or exists (
      select 1
        from public.moment_notes as note
       where note.author_membership_id = target.id
         and note.trashed_at is null
         and (select private.can_read_live_moment(note.moment_id))
         and not (select private.viewer_reported('note', note.id))
    )
  ) then
    raise exception using
      errcode = '42501',
      message = 'This person cannot be blocked';
  end if;

  insert into private.member_blocks (
    blocker_user_id,
    blocked_user_id,
    blocked_membership_id
  ) values (
    current_user_id,
    target.user_id,
    target.id
  )
  on conflict on constraint member_blocks_pair_key do nothing;
end;
$$;

create function public.unblock_member(target_membership_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_user_id uuid;
begin
  if current_user_id is null or target_membership_id is null then
    raise exception using
      errcode = '22023',
      message = 'This person cannot be unblocked';
  end if;

  select membership.user_id
    into target_user_id
    from public.circle_memberships as membership
   where membership.id = target_membership_id;

  delete from private.member_blocks as block
   where block.blocker_user_id = current_user_id
     and (
       block.blocked_membership_id = target_membership_id
       or (
         target_user_id is not null
         and block.blocked_user_id = target_user_id
       )
     );
end;
$$;

create function public.list_my_blocks()
returns table (
  membership_id uuid,
  person_display_name text,
  blocked_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    block.blocked_membership_id,
    coalesce(person.display_name, 'Family'),
    block.blocked_at
  from private.member_blocks as block
  join public.circle_memberships as membership
    on membership.id = block.blocked_membership_id
  join public.people as person
    on person.circle_id = membership.circle_id
   and person.id = membership.person_id
  where block.blocker_user_id = (select auth.uid())
  order by block.blocked_at desc, person.display_name;
$$;

create function public.accept_terms(terms_version text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized_version text := btrim(coalesce(terms_version, ''));
  accepted timestamptz;
begin
  if current_user_id is null
    or normalized_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception using
      errcode = '22023',
      message = 'Terms could not be accepted';
  end if;

  insert into private.terms_acceptances (user_id, terms_version)
  values (current_user_id, normalized_version)
  on conflict on constraint terms_acceptances_pkey do nothing;

  select acceptance.accepted_at
    into accepted
    from private.terms_acceptances as acceptance
   where acceptance.user_id = current_user_id
     and acceptance.terms_version = normalized_version;

  return accepted;
end;
$$;

create function public.get_my_terms_acceptance()
returns table (
  terms_version text,
  accepted_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select acceptance.terms_version, acceptance.accepted_at
    from private.terms_acceptances as acceptance
   where acceptance.user_id = (select auth.uid())
   order by acceptance.accepted_at, acceptance.terms_version;
$$;

create function public.get_my_account_closure_status()
returns table (
  state text,
  requested_at timestamptz,
  last_organizer_circles text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  closure_state text := 'none';
  closure_requested_at timestamptz;
  blocking_circles text[];
begin
  if current_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Account status is unavailable';
  end if;

  select closure.state, closure.requested_at
    into closure_state, closure_requested_at
    from private.account_closure_requests as closure
   where closure.auth_user_id = current_user_id;

  if closure_state is null then
    closure_state := 'none';
  end if;

  select coalesce(array_agg(circle.name order by circle.name), '{}'::text[])
    into blocking_circles
    from public.circles as circle
    join public.circle_memberships as membership
      on membership.circle_id = circle.id
   where membership.user_id = current_user_id
     and membership.status = 'active'
     and membership.role = 'organizer'
     and not exists (
       select 1
         from public.circle_memberships as other_organizer
        where other_organizer.circle_id = membership.circle_id
          and other_organizer.id <> membership.id
          and other_organizer.status = 'active'
          and other_organizer.role = 'organizer'
          and other_organizer.user_id is not null
          and not (select private.account_closure_is_blocking(
            other_organizer.user_id
          ))
     );

  return query
  select closure_state, closure_requested_at, blocking_circles;
end;
$$;

create function private.set_account_deletion_triggers(enabled boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  statement text;
  relation text;
begin
  foreach relation in array array[
    'public.moments',
    'public.moment_notes',
    'public.moment_reactions',
    'public.moment_note_reactions',
    'public.moment_people',
    'public.moment_photos',
    'public.moment_videos',
    'public.moment_video_posters',
    'public.moment_circles',
    'public.content_mentions'
  ]
  loop
    statement := format(
      'alter table %s %s trigger user',
      relation,
      case when enabled then 'enable' else 'disable' end
    );
    execute statement;
  end loop;
end;
$$;

create function private.purge_account_authored_content(target_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if target_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'Account content could not be removed';
  end if;

  perform private.set_account_deletion_triggers(false);
  begin
    drop table if exists pg_temp.account_deletion_memberships;
    drop table if exists pg_temp.account_deletion_moments;
    drop table if exists pg_temp.account_deletion_objects;

    create temp table account_deletion_memberships on commit drop as
    select membership.id as membership_id,
           membership.circle_id,
           membership.person_id
      from public.circle_memberships as membership
     where membership.user_id = target_user_id;

    create temp table account_deletion_moments on commit drop as
    select moment.id as moment_id, moment.circle_id
      from public.moments as moment
      join pg_temp.account_deletion_memberships as membership
        on membership.membership_id = moment.recorded_by_membership_id;

    create temp table account_deletion_objects (
      bucket_id text,
      object_path text,
      storage_object_id uuid
    ) on commit drop;

    insert into pg_temp.account_deletion_objects (
      bucket_id, object_path, storage_object_id
    )
    select original.bucket_id, original.object_path, original.storage_object_id
      from private.photo_originals as original
      join pg_temp.account_deletion_memberships as membership
        on membership.membership_id = original.recorded_by_membership_id
    union
    select derivative.bucket_id, derivative.object_path, derivative.storage_object_id
      from private.photo_display_derivatives as derivative
      join pg_temp.account_deletion_memberships as membership
        on membership.membership_id = derivative.requested_by_membership_id
    union
    select card.bucket_id, card.object_path, card.storage_object_id
      from private.photo_card_renditions as card
      join private.photo_display_derivatives as derivative
        on derivative.id = card.display_derivative_id
      join pg_temp.account_deletion_memberships as membership
        on membership.membership_id = derivative.requested_by_membership_id
    union
    select photo_original.bucket_id, photo_original.object_path, photo_original.storage_object_id
      from public.moment_photos as photo
      join private.photo_originals as photo_original
        on photo_original.id = photo.original_id
      join pg_temp.account_deletion_moments as owned
        on owned.moment_id = photo.moment_id
    union
    select derivative.bucket_id, derivative.object_path, derivative.storage_object_id
      from public.moment_photos as photo
      join private.photo_display_derivatives as derivative
        on derivative.id = photo.display_derivative_id
      join pg_temp.account_deletion_moments as owned
        on owned.moment_id = photo.moment_id
    union
    select 'our-days-intake', intake.object_path, null
      from private.photo_intakes as intake
      join pg_temp.account_deletion_memberships as membership
        on membership.membership_id = intake.requested_by_membership_id
    union
    select video.bucket_id, video.object_path, video.storage_object_id
      from public.moment_videos as video
      join pg_temp.account_deletion_moments as owned
        on owned.moment_id = video.moment_id
    union
    select poster.bucket_id, poster.object_path, poster.storage_object_id
      from public.moment_video_posters as poster
      join pg_temp.account_deletion_moments as owned
        on owned.moment_id = poster.moment_id
    union
    select 'our-days-videos', request.object_path, null
      from private.video_upload_requests as request
      join pg_temp.account_deletion_memberships as membership
        on membership.membership_id = request.requested_by_membership_id;

    delete from public.content_mentions as mention
     where mention.author_membership_id in (
         select membership.membership_id from pg_temp.account_deletion_memberships as membership
       )
        or mention.mentioned_user_id = target_user_id
        or mention.moment_id in (
          select owned.moment_id from pg_temp.account_deletion_moments as owned
        )
        or mention.note_id in (
          select note.id
            from public.moment_notes as note
           where note.author_membership_id in (
               select membership.membership_id
                 from pg_temp.account_deletion_memberships as membership
             )
              or note.moment_id in (
                select owned.moment_id from pg_temp.account_deletion_moments as owned
              )
        );

    delete from public.moment_note_reactions as heart
     where heart.author_user_id = target_user_id
        or heart.author_membership_id in (
          select membership.membership_id from pg_temp.account_deletion_memberships as membership
        )
        or heart.moment_id in (
          select owned.moment_id from pg_temp.account_deletion_moments as owned
        )
        or heart.note_id in (
          select note.id
            from public.moment_notes as note
           where note.author_membership_id in (
               select membership.membership_id
                 from pg_temp.account_deletion_memberships as membership
             )
              or note.moment_id in (
                select owned.moment_id from pg_temp.account_deletion_moments as owned
              )
        );

    delete from public.moment_notes as note
     where note.author_membership_id in (
         select membership.membership_id from pg_temp.account_deletion_memberships as membership
       )
        or note.moment_id in (
          select owned.moment_id from pg_temp.account_deletion_moments as owned
        );

    delete from public.moment_reactions as reaction
     where reaction.author_membership_id in (
         select membership.membership_id from pg_temp.account_deletion_memberships as membership
       )
        or reaction.moment_id in (
          select owned.moment_id from pg_temp.account_deletion_moments as owned
        );

    delete from public.moment_people as tag
     where tag.moment_id in (
         select owned.moment_id from pg_temp.account_deletion_moments as owned
       )
        or tag.person_id in (
          select membership.person_id from pg_temp.account_deletion_memberships as membership
        )
        or tag.tagged_by_membership_id in (
          select membership.membership_id from pg_temp.account_deletion_memberships as membership
        );

    delete from public.moment_video_posters as poster
     where poster.moment_id in (
       select owned.moment_id from pg_temp.account_deletion_moments as owned
     );

    delete from public.moment_videos as video
     where video.moment_id in (
       select owned.moment_id from pg_temp.account_deletion_moments as owned
     );

    delete from public.moment_photos as photo
     where photo.moment_id in (
       select owned.moment_id from pg_temp.account_deletion_moments as owned
     );

    delete from public.moment_circles as link
     where link.moment_id in (
       select owned.moment_id from pg_temp.account_deletion_moments as owned
     );

    delete from public.moments as moment
     where moment.id in (
       select owned.moment_id from pg_temp.account_deletion_moments as owned
     );

    delete from private.entry_drafts as draft
     where draft.user_id = target_user_id;

    delete from private.expo_push_tokens as token
     where token.user_id = target_user_id;

    delete from private.web_push_subscriptions as subscription
     where subscription.membership_id in (
       select membership.membership_id from pg_temp.account_deletion_memberships as membership
     );

    delete from private.member_blocks as block
     where block.blocker_user_id = target_user_id
        or block.blocked_user_id = target_user_id;

    delete from private.terms_acceptances as acceptance
     where acceptance.user_id = target_user_id;

    if to_regclass('storage.objects') is not null then
      delete from storage.objects as object
       using pg_temp.account_deletion_objects as target
       where (
           target.storage_object_id is not null
           and object.id = target.storage_object_id
         )
          or (
           target.object_path is not null
           and object.bucket_id = target.bucket_id
           and object.name = target.object_path
         );
    end if;

    perform private.set_account_deletion_triggers(true);
  exception
    when others then
      perform private.set_account_deletion_triggers(true);
      raise;
  end;
end;
$$;

create function private.process_account_deletion(closure_request_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_request private.account_closure_requests%rowtype;
  run private.account_deletion_runs%rowtype;
  leased_id uuid;
  copied_email text;
begin
  if closure_request_id is null then
    return;
  end if;

  if exists (
    select 1
      from private.account_deletion_completions as done
     where done.closure_request_id = process_account_deletion.closure_request_id
  ) then
    return;
  end if;

  select closure.*
    into target_request
    from private.account_closure_requests as closure
   where closure.id = process_account_deletion.closure_request_id
   for update;

  if target_request.id is null then
    return;
  end if;

  with leased as (
    insert into private.account_deletion_runs (
      closure_request_id, attempt_count, leased_until
    ) values (
      target_request.id,
      1,
      statement_timestamp() + interval '15 minutes'
    )
    on conflict on constraint account_deletion_runs_pkey do update
      set attempt_count = private.account_deletion_runs.attempt_count + 1,
          leased_until = statement_timestamp() + interval '15 minutes',
          updated_at = statement_timestamp()
    where private.account_deletion_runs.completed_at is null
      and (
        private.account_deletion_runs.leased_until is null
        or private.account_deletion_runs.leased_until < statement_timestamp()
      )
    returning closure_request_id
  )
  select leased.closure_request_id
    into leased_id
    from leased;

  if leased_id is null then
    return;
  end if;

  select deletion_run.*
    into run
    from private.account_deletion_runs as deletion_run
   where deletion_run.closure_request_id = target_request.id
   for update;

  if exists (
    select 1
      from public.circle_memberships as membership
     where membership.user_id = target_request.auth_user_id
       and membership.status = 'active'
       and membership.role = 'organizer'
       and not exists (
         select 1
           from public.circle_memberships as other_organizer
          where other_organizer.circle_id = membership.circle_id
            and other_organizer.id <> membership.id
            and other_organizer.status = 'active'
            and other_organizer.role = 'organizer'
            and other_organizer.user_id is not null
            and not (select private.account_closure_is_blocking(
              other_organizer.user_id
            ))
       )
  ) then
    update private.account_deletion_runs
       set last_error_code = '23514',
           leased_until = null,
           updated_at = statement_timestamp()
     where account_deletion_runs.closure_request_id = target_request.id;
    return;
  end if;

  if run.content_purged_at is null then
    perform private.purge_account_authored_content(target_request.auth_user_id);
    update private.account_deletion_runs
       set content_purged_at = statement_timestamp(),
           storage_purged_at = statement_timestamp(),
           last_error_code = null,
           updated_at = statement_timestamp()
     where account_deletion_runs.closure_request_id = target_request.id;
  end if;

  if target_request.state = 'requested' then
    perform private.prepare_account_closure(target_request.id);
    update private.account_deletion_runs
       set prepared_at = statement_timestamp(),
           updated_at = statement_timestamp()
     where account_deletion_runs.closure_request_id = target_request.id;
  end if;

  if run.receipt_email is null and run.auth_deleted_at is null then
    select nullif(btrim(auth_user.email), '')
      into copied_email
      from auth.users as auth_user
     where auth_user.id = target_request.auth_user_id;

    update private.account_deletion_runs
       set receipt_email = copied_email,
           updated_at = statement_timestamp()
     where account_deletion_runs.closure_request_id = target_request.id;
  else
    copied_email := run.receipt_email;
  end if;

  if run.auth_deleted_at is null then
    begin
      delete from auth.users as auth_user
       where auth_user.id = target_request.auth_user_id;
    exception
      when foreign_key_violation then
        update private.account_deletion_runs
           set last_error_code = '23503',
               leased_until = null,
               updated_at = statement_timestamp()
         where account_deletion_runs.closure_request_id = target_request.id;
        return;
    end;

    update private.account_deletion_runs
       set auth_deleted_at = statement_timestamp(),
           updated_at = statement_timestamp()
     where account_deletion_runs.closure_request_id = target_request.id;
  end if;

  insert into private.account_deletion_completions (closure_request_id)
  values (target_request.id)
  on conflict on constraint account_deletion_completions_pkey do nothing;

  if copied_email is not null
    and not exists (
      select 1
        from private.safety_outbound_mail as mail
       where mail.closure_request_id = target_request.id
    ) then
    insert into private.safety_outbound_mail (
      kind,
      closure_request_id,
      recipient,
      subject,
      body
    ) values (
      'deletion_receipt',
      target_request.id,
      copied_email,
      'Your Our Days account has been deleted',
      'Your Our Days account has been deleted. Your posts, photos, videos, comments, and hearts have been deleted.'
    );
  end if;

  update private.account_deletion_runs
     set completed_at = statement_timestamp(),
         receipt_email = null,
         receipt_sent_at = case
           when copied_email is null then statement_timestamp()
           else receipt_sent_at
         end,
         leased_until = null,
         last_error_code = null,
         updated_at = statement_timestamp()
   where account_deletion_runs.closure_request_id = target_request.id;
end;
$$;

create function private.dispatch_pending_safety_mail()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  api_key text;
  mail private.safety_outbound_mail%rowtype;
  status_code integer;
  request_id bigint;
  composed_body text;
  composed_subject text;
  report_row private.content_reports%rowtype;
  circle_name text;
  author_name text;
  excerpt text;
  reporter_membership_id uuid;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return;
  end if;

  begin
    select secret.decrypted_secret
      into api_key
      from vault.decrypted_secrets as secret
     where secret.name = 'resend_api_key'
     limit 1;
  exception
    when undefined_table or invalid_schema_name then
      return;
  end;

  if api_key is null or btrim(api_key) = '' then
    return;
  end if;

  for mail in
    select outbound.*
      from private.safety_outbound_mail as outbound
     where outbound.sent_at is null
       and outbound.attempt_count < 8
     order by outbound.created_at
     limit 20
     for update skip locked
  loop
    if mail.net_request_id is not null then
      select response.status_code
        into status_code
        from net._http_response as response
       where response.id = mail.net_request_id;

      if status_code is null then
        continue;
      elsif status_code between 200 and 299 then
        update private.safety_outbound_mail
           set sent_at = statement_timestamp(),
               recipient = null,
               body = null
         where id = mail.id;
        update private.content_reports
           set notified_at = statement_timestamp()
         where id = mail.report_id
           and notified_at is null;
        update private.account_deletion_runs
           set receipt_sent_at = statement_timestamp(),
               updated_at = statement_timestamp()
         where closure_request_id = mail.closure_request_id;
        continue;
      else
        update private.safety_outbound_mail
           set net_request_id = null,
               attempt_count = attempt_count + 1
         where id = mail.id;
        continue;
      end if;
    end if;

    composed_subject := mail.subject;
    composed_body := mail.body;

    if mail.kind = 'report' and composed_body is null then
      select report.*
        into report_row
        from private.content_reports as report
       where report.id = mail.report_id;

      select circle.name
        into circle_name
        from public.circles as circle
       where circle.id = report_row.circle_id;

      if report_row.target_kind = 'moment' then
        select coalesce(person.display_name, 'Family'),
               left(coalesce(moment.body, ''), 240)
          into author_name, excerpt
          from public.moments as moment
          left join public.circle_memberships as author
            on author.id = moment.recorded_by_membership_id
          left join public.people as person
            on person.circle_id = author.circle_id
           and person.id = author.person_id
         where moment.id = report_row.target_id;
      else
        select coalesce(person.display_name, 'Family'),
               left(coalesce(note.body, ''), 240)
          into author_name, excerpt
          from public.moment_notes as note
          left join public.circle_memberships as author
            on author.id = note.author_membership_id
          left join public.people as person
            on person.circle_id = author.circle_id
           and person.id = author.person_id
         where note.id = report_row.target_id;
      end if;

      select membership.id
        into reporter_membership_id
        from public.circle_memberships as membership
       where membership.user_id = report_row.reporter_user_id
         and membership.circle_id = report_row.circle_id
       limit 1;

      composed_body := concat_ws(
        E'\n',
        'A family member reported content.',
        'Reporter membership: ' || coalesce(reporter_membership_id::text, 'unavailable'),
        'Target: ' || report_row.target_kind || ' ' || report_row.target_id::text,
        'Circle: ' || coalesce(circle_name, 'Family'),
        'Author: ' || coalesce(author_name, 'Family'),
        'Excerpt: ' || coalesce(excerpt, ''),
        'Reason: ' || report_row.reason,
        'Details: ' || coalesce(report_row.details, ''),
        'Reported at: ' || to_char(report_row.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS UTC')
      );

      update private.safety_outbound_mail
         set body = composed_body
       where id = mail.id;
    end if;

    if composed_body is null or mail.recipient is null then
      continue;
    end if;

    begin
      request_id := net.http_post(
        url := 'https://api.resend.com/emails',
        body := jsonb_build_object(
          'from', 'Our Days <ourdays@mail.beelinetech.co>',
          'to', jsonb_build_array(mail.recipient),
          'subject', composed_subject,
          'text', composed_body
        ),
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || api_key,
          'Content-Type', 'application/json'
        ),
        timeout_milliseconds := 5000
      );
      update private.safety_outbound_mail
         set net_request_id = request_id
       where id = mail.id;
    exception
      when others then
        update private.safety_outbound_mail
           set attempt_count = attempt_count + 1
         where id = mail.id;
    end;
  end loop;
end;
$$;

create function private.tick_safety_jobs()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  closure_id uuid;
begin
  for closure_id in
    select closure.id
      from private.account_closure_requests as closure
     where not exists (
         select 1
           from private.account_deletion_completions as done
          where done.closure_request_id = closure.id
       )
       and not exists (
         select 1
           from private.account_deletion_runs as run
          where run.closure_request_id = closure.id
            and run.leased_until > statement_timestamp()
            and run.completed_at is null
       )
     order by closure.requested_at
     for update of closure skip locked
  loop
    begin
      perform private.process_account_deletion(closure_id);
    exception
      when others then
        insert into private.account_deletion_runs (
          closure_request_id, last_error_code, leased_until
        ) values (
          closure_id, sqlstate, null
        )
        on conflict on constraint account_deletion_runs_pkey do update
          set last_error_code = sqlstate,
              leased_until = null,
              updated_at = statement_timestamp();
    end;
  end loop;

  perform private.dispatch_pending_safety_mail();
end;
$$;

create function public.tick_safety_jobs()
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  perform private.tick_safety_jobs();
end;
$$;

revoke all on function private.viewer_reported(text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.viewer_hides_author(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.viewer_hides_note(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.viewer_hides_reaction(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.viewer_hides_heart(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.viewer_hides_tagged_person(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.set_account_deletion_triggers(boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.purge_account_authored_content(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.process_account_deletion(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.dispatch_pending_safety_mail()
  from public, anon, authenticated, service_role;
revoke all on function private.tick_safety_jobs()
  from public, anon, authenticated, service_role;

grant execute on function private.viewer_reported(text, uuid) to authenticated;
grant execute on function private.viewer_hides_author(uuid) to authenticated;
grant execute on function private.viewer_hides_note(uuid) to authenticated;
grant execute on function private.viewer_hides_reaction(uuid) to authenticated;
grant execute on function private.viewer_hides_heart(uuid) to authenticated;
grant execute on function private.viewer_hides_tagged_person(uuid, uuid) to authenticated;
grant execute on function private.tick_safety_jobs() to service_role;

revoke all on function public.report_content(text, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.block_member(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.unblock_member(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.list_my_blocks()
  from public, anon, authenticated, service_role;
revoke all on function public.accept_terms(text)
  from public, anon, authenticated, service_role;
revoke all on function public.get_my_terms_acceptance()
  from public, anon, authenticated, service_role;
revoke all on function public.get_my_account_closure_status()
  from public, anon, authenticated, service_role;
revoke all on function public.tick_safety_jobs()
  from public, anon, authenticated, service_role;

grant execute on function public.report_content(text, uuid, text, text) to authenticated;
grant execute on function public.block_member(uuid) to authenticated;
grant execute on function public.unblock_member(uuid) to authenticated;
grant execute on function public.list_my_blocks() to authenticated;
grant execute on function public.accept_terms(text) to authenticated;
grant execute on function public.get_my_terms_acceptance() to authenticated;
grant execute on function public.get_my_account_closure_status() to authenticated;
grant execute on function public.tick_safety_jobs() to service_role;

do $$
begin
  begin
    create extension if not exists pg_net;
  exception
    when insufficient_privilege or feature_not_supported then
      raise notice 'pg_net unavailable: %', sqlerrm;
    when sqlstate '58P01' then
      raise notice 'pg_net unavailable: %', sqlerrm;
  end;

  begin
    create extension if not exists pg_cron;
  exception
    when insufficient_privilege or feature_not_supported then
      raise notice 'pg_cron unavailable: %', sqlerrm;
    when sqlstate '58P01' then
      raise notice 'pg_cron unavailable: %', sqlerrm;
  end;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      if exists (
        select 1 from cron.job where jobname = 'our-days-safety-jobs'
      ) then
        perform cron.unschedule('our-days-safety-jobs');
      end if;
      perform cron.schedule(
        'our-days-safety-jobs',
        '15 * * * *',
        $cron$select private.tick_safety_jobs()$cron$
      );
    exception
      when others then
        raise notice 'safety cron not scheduled: %', sqlerrm;
    end;
  end if;
end;
$$;

-- 20261005140000 stores the row count in a boolean, so a successful claim
-- raises "operator does not exist: boolean > integer". That migration is
-- already applied in production, so correct the body here without editing it.
create or replace function private.claim_moment_push_delivery(requested_moment_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_circle_id uuid;
  actor_membership_id uuid;
  scheduled_at timestamptz;
  fallback_interval interval := interval '4 minutes';
  ready boolean;
  claimed integer := 0;
begin
  if current_user_id is null or requested_moment_id is null then
    return false;
  end if;

  select
    moment.circle_id,
    moment.recorded_by_membership_id,
    moment.moment_push_scheduled_at
    into target_circle_id, actor_membership_id, scheduled_at
    from public.moments as moment
   where moment.id = requested_moment_id
     and moment.trashed_at is null
     and moment.kind <> 'insight'
     and moment.audience = 'family'
     and moment.moment_push_notified_at is null;

  if target_circle_id is null then
    return false;
  end if;

  if not exists (
    select 1
      from public.circle_memberships as membership
     where membership.id = actor_membership_id
       and membership.circle_id = target_circle_id
       and membership.user_id = current_user_id
       and membership.status = 'active'
  ) and not (select private.photo_validator_is_allowed(current_user_id)) then
    return false;
  end if;

  if scheduled_at is null then
    update public.moments as moment
       set moment_push_scheduled_at = statement_timestamp()
     where moment.id = requested_moment_id
       and moment.moment_push_scheduled_at is null
    returning moment.moment_push_scheduled_at into scheduled_at;
  end if;

  ready := (select private.moment_media_push_is_ready(requested_moment_id));

  if not ready
    and statement_timestamp()
      < coalesce(scheduled_at, statement_timestamp()) + fallback_interval then
    return false;
  end if;

  update public.moments as moment
     set moment_push_notified_at = statement_timestamp()
   where moment.id = requested_moment_id
     and moment.moment_push_notified_at is null;

  get diagnostics claimed = row_count;
  return claimed > 0;
end;
$$;
