begin;

insert into storage.buckets (id, name, public)
values ('support-attachments', 'support-attachments', false)
on conflict (id) do update set public = false;

create table if not exists public.user_support_requests (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    request_type text not null check (request_type in ('question', 'suggestion', 'feedback')),
    subject text not null check (char_length(trim(subject)) between 3 and 120),
    details text not null check (char_length(trim(details)) between 20 and 3000),
    attachment_url text,
    status text not null default 'pending' check (status in ('pending', 'reviewing', 'answered', 'closed')),
    admin_reply text,
    moderator_id uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    answered_at timestamptz
);

alter table public.user_support_requests add column if not exists attachment_url text;
alter table public.account_moderation_appeals add column if not exists attachment_url text;
alter table public.account_moderation_appeals add column if not exists restriction_id uuid references public.account_moderation_restrictions(user_id) on delete set null;
alter table public.account_moderation_appeals add column if not exists subject text;
update public.account_moderation_appeals set subject = reason_title where subject is null;
alter table public.account_moderation_appeals alter column subject set not null;
alter table public.account_moderation_appeals alter column subject set default 'Hesap kısıtlamasına itiraz';
alter table public.account_moderation_appeals drop constraint if exists account_moderation_appeals_subject_length;
alter table public.account_moderation_appeals add constraint account_moderation_appeals_subject_length
    check (char_length(trim(subject)) between 3 and 120) not valid;
alter table public.forum_moderation_appeals add column if not exists attachment_url text;
alter table public.forum_moderation_appeals add column if not exists subject text;
alter table public.forum_moderation_appeals add column if not exists restriction_was_banned boolean not null default false;
alter table public.forum_moderation_appeals add column if not exists restriction_ban_until timestamptz;
update public.forum_moderation_appeals set subject = 'Topluluk kısıtlamasına itiraz' where subject is null;
alter table public.forum_moderation_appeals alter column subject set not null;
alter table public.forum_moderation_appeals alter column subject set default 'Topluluk kısıtlamasına itiraz';
alter table public.forum_moderation_appeals drop constraint if exists forum_moderation_appeals_subject_length;
alter table public.forum_moderation_appeals add constraint forum_moderation_appeals_subject_length
    check (char_length(trim(subject)) between 3 and 120) not valid;
alter table public.user_support_requests drop constraint if exists user_support_requests_subject_length;
alter table public.user_support_requests add constraint user_support_requests_subject_length
    check (char_length(trim(subject)) between 3 and 120) not valid;
alter table public.user_support_requests drop constraint if exists user_support_requests_details_length;
alter table public.user_support_requests add constraint user_support_requests_details_length
    check (char_length(trim(details)) between 20 and 2000) not valid;
alter table public.account_moderation_appeals drop constraint if exists account_moderation_appeals_details_length;
alter table public.account_moderation_appeals add constraint account_moderation_appeals_details_length
    check (char_length(trim(details)) between 20 and 1000) not valid;

create table if not exists public.user_support_daily_quotas (
    user_id uuid not null references auth.users(id) on delete cascade,
    quota_date date not null,
    used_count integer not null default 0 check (used_count >= 0),
    bonus_count integer not null default 0 check (bonus_count >= 0),
    primary key (user_id, quota_date)
);

create table if not exists public.user_support_quota_credits (
    user_id uuid not null references auth.users(id) on delete cascade,
    source_type text not null check (source_type = 'request'),
    source_id uuid not null,
    created_at timestamptz not null default now(),
    primary key (source_type, source_id)
);

alter table public.user_support_daily_quotas enable row level security;
alter table public.user_support_quota_credits enable row level security;

create or replace function public.consume_user_support_daily_quota(p_user_id uuid)
returns table (allowed boolean, remaining integer)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_used integer;
    v_bonus integer;
begin
    if p_user_id is null or (
        auth.uid() is distinct from p_user_id
        and coalesce(auth.role(), '') <> 'service_role'
    ) then
        raise exception 'Not authorized to consume support quota';
    end if;

    insert into public.user_support_daily_quotas(user_id, quota_date)
    values (p_user_id, (now() at time zone 'UTC')::date)
    on conflict (user_id, quota_date) do nothing;

    update public.user_support_daily_quotas q
    set used_count = q.used_count + 1
    where q.user_id = p_user_id
      and q.quota_date = (now() at time zone 'UTC')::date
      and q.used_count < 3 + q.bonus_count
    returning q.used_count, q.bonus_count into v_used, v_bonus;

    if found then
        return query select true, greatest(0, 3 + v_bonus - v_used);
    else
        select q.used_count, q.bonus_count into v_used, v_bonus
        from public.user_support_daily_quotas q
        where q.user_id = p_user_id and q.quota_date = (now() at time zone 'UTC')::date;
        return query select false, greatest(0, 3 + coalesce(v_bonus, 0) - coalesce(v_used, 0));
    end if;
end;
$$;

create or replace function public.get_user_support_daily_quota(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_remaining integer;
begin
    if p_user_id is null or (
        auth.uid() is distinct from p_user_id
        and coalesce(auth.role(), '') <> 'service_role'
    ) then
        raise exception 'Not authorized to inspect support quota';
    end if;

    select greatest(0, 3 + q.bonus_count - q.used_count) into v_remaining
    from public.user_support_daily_quotas q
    where q.user_id = p_user_id and q.quota_date = (now() at time zone 'UTC')::date;
    return coalesce(v_remaining, 3);
end;
$$;

create or replace function public.release_user_support_daily_quota(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if p_user_id is null or (
        auth.uid() is distinct from p_user_id
        and coalesce(auth.role(), '') <> 'service_role'
    ) then
        raise exception 'Not authorized to release support quota';
    end if;
    update public.user_support_daily_quotas
    set used_count = greatest(0, used_count - 1)
    where user_id = p_user_id and quota_date = (now() at time zone 'UTC')::date;
end;
$$;

create or replace function public.grant_user_support_quota_credit(
    p_user_id uuid,
    p_source_type text,
    p_source_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
    if p_user_id is null or p_source_type is distinct from 'request'
        or p_source_id is null or (
            coalesce(auth.role(), '') <> 'service_role'
            and not public.forum_is_admin()
        ) then
        raise exception 'Not authorized to grant support quota credit';
    end if;

    insert into public.user_support_quota_credits(user_id, source_type, source_id)
    values (p_user_id, p_source_type, p_source_id)
    on conflict (source_type, source_id) do nothing;
    if not found then
        return false;
    end if;

    insert into public.user_support_daily_quotas(user_id, quota_date, bonus_count)
    values (p_user_id, (now() at time zone 'UTC')::date, 1)
    on conflict (user_id, quota_date)
    do update set bonus_count = public.user_support_daily_quotas.bonus_count + 1;
    return true;
end;
$$;

revoke all on function public.consume_user_support_daily_quota(uuid) from public, anon;
revoke all on function public.get_user_support_daily_quota(uuid) from public, anon;
revoke all on function public.release_user_support_daily_quota(uuid) from public, anon;
revoke all on function public.grant_user_support_quota_credit(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.consume_user_support_daily_quota(uuid) to authenticated, service_role;
grant execute on function public.get_user_support_daily_quota(uuid) to authenticated, service_role;
grant execute on function public.release_user_support_daily_quota(uuid) to authenticated, service_role;
grant execute on function public.grant_user_support_quota_credit(uuid, text, uuid) to authenticated, service_role;

create index if not exists user_support_quota_credits_user_created_idx
    on public.user_support_quota_credits(user_id, created_at desc);

create index if not exists user_support_requests_user_created_idx
    on public.user_support_requests(user_id, created_at desc);
create index if not exists user_support_requests_status_created_idx
    on public.user_support_requests(status, created_at desc);

alter table public.user_support_requests enable row level security;
alter table public.account_moderation_appeals enable row level security;

drop policy if exists "Users read own support requests" on public.user_support_requests;
create policy "Users read own support requests"
    on public.user_support_requests for select to authenticated
    using (auth.uid() = user_id or public.forum_is_admin());

drop policy if exists "Users create own support requests" on public.user_support_requests;
create policy "Users create own support requests"
    on public.user_support_requests for insert to authenticated
    with check (auth.uid() = user_id);

grant select, insert on public.user_support_requests to authenticated;
grant all on public.user_support_requests to service_role;

drop policy if exists "Admins manage support requests" on public.user_support_requests;
create policy "Admins manage support requests"
    on public.user_support_requests for all to authenticated
    using (public.forum_is_admin())
    with check (public.forum_is_admin());

grant update on public.user_support_requests to authenticated;

drop policy if exists "Users read own account moderation appeals" on public.account_moderation_appeals;
create policy "Users read own account moderation appeals"
    on public.account_moderation_appeals for select to authenticated
    using (auth.uid() = user_id or public.forum_is_admin());

grant select on public.account_moderation_appeals to authenticated;

commit;
