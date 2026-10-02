begin;

alter table public.user_support_requests
    add column if not exists resolved_by uuid references auth.users(id) on delete set null,
    add column if not exists resolved_at timestamptz;

create table if not exists public.user_support_request_events (
    id uuid primary key default gen_random_uuid(),
    request_id uuid not null references public.user_support_requests(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    actor_id uuid references auth.users(id) on delete set null,
    actor_role text not null check (actor_role in ('user', 'admin', 'system')),
    event_type text not null check (event_type in ('created', 'status_changed', 'reply_updated')),
    previous_status text,
    status text not null check (status in ('pending', 'reviewing', 'answered', 'closed')),
    message text,
    created_at timestamptz not null default now()
);

create index if not exists user_support_request_events_request_created_idx
    on public.user_support_request_events(request_id, created_at desc);
create index if not exists user_support_request_events_user_created_idx
    on public.user_support_request_events(user_id, created_at desc);

alter table public.user_support_request_events enable row level security;

drop policy if exists "Users read own support request events" on public.user_support_request_events;
create policy "Users read own support request events"
    on public.user_support_request_events for select to authenticated
    using (auth.uid() = user_id or public.forum_is_admin());

drop policy if exists "Users log own support request creation" on public.user_support_request_events;
create policy "Users log own support request creation"
    on public.user_support_request_events for insert to authenticated
    with check (
        auth.uid() = user_id
        and auth.uid() = actor_id
        and actor_role = 'user'
        and event_type = 'created'
    );

drop policy if exists "Admins manage support request events" on public.user_support_request_events;
create policy "Admins manage support request events"
    on public.user_support_request_events for all to authenticated
    using (public.forum_is_admin())
    with check (public.forum_is_admin());

grant select, insert on public.user_support_request_events to authenticated;
grant all on public.user_support_request_events to service_role;

with appeal_credits as (
    select user_id, (created_at at time zone 'UTC')::date as quota_date, count(*)::integer as credit_count
    from public.user_support_quota_credits
    where source_type in ('account_appeal', 'forum_appeal')
    group by user_id, (created_at at time zone 'UTC')::date
)
update public.user_support_daily_quotas as quota
set bonus_count = greatest(0, quota.bonus_count - appeal_credits.credit_count)
from appeal_credits
where quota.user_id = appeal_credits.user_id
  and quota.quota_date = appeal_credits.quota_date;

delete from public.user_support_quota_credits
where source_type in ('account_appeal', 'forum_appeal');

alter table public.user_support_quota_credits
    drop constraint if exists user_support_quota_credits_source_type_check;
alter table public.user_support_quota_credits
    add constraint user_support_quota_credits_source_type_check check (source_type = 'request');

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

alter table public.user_activity_logs drop constraint if exists user_activity_logs_event_type_check;
alter table public.user_activity_logs add constraint user_activity_logs_event_type_check
    check (event_type in (
        'login', 'logout', 'profile_updated', 'password_changed', 'password_failed',
        'password_reset_requested', 'list_created', 'list_renamed', 'list_deleted',
        'stock_added', 'stock_removed', 'portfolio_order', 'portfolio_cash_adjustment',
        'lesson_completed', 'lesson_uncompleted', 'admin_cash_adjustment',
        'admin_role_changed', 'admin_account_status', 'admin_order_status',
        'admin_alert_status', 'admin_position_adjusted', 'admin_rank_adjusted',
        'admin_profile_updated', 'admin_user_invited', 'account_freeze_requested',
        'account_reactivated', 'account_deletion_requested', 'forum_topic_created',
        'support_request_created', 'support_request_updated',
        'account_appeal_submitted', 'account_appeal_decided',
        'forum_appeal_submitted', 'forum_appeal_decided'
    ));

commit;
