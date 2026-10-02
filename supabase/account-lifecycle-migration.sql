begin;

alter table public.user_activity_logs drop constraint if exists user_activity_logs_event_type_check;
alter table public.user_activity_logs add constraint user_activity_logs_event_type_check
    check (event_type in (
        'login', 'logout', 'user_registered', 'profile_updated', 'password_changed', 'password_failed',
        'password_reset_requested', 'list_created', 'list_renamed', 'list_deleted',
        'stock_added', 'stock_removed', 'portfolio_order', 'portfolio_cash_adjustment',
        'lesson_completed', 'lesson_uncompleted', 'admin_cash_adjustment',
        'admin_role_changed', 'admin_account_status', 'admin_order_status',
        'admin_alert_status', 'admin_position_adjusted', 'admin_rank_adjusted',
        'admin_profile_updated', 'admin_user_invited', 'account_freeze_requested',
        'account_reactivated', 'account_deletion_requested', 'forum_topic_created'
    ));

create table if not exists public.account_freeze_requests (
    user_id uuid primary key references auth.users(id) on delete cascade,
    requested_at timestamptz not null default now(),
    unfreeze_at timestamptz not null,
    delete_after timestamptz not null,
    reactivated_at timestamptz,
    created_at timestamptz not null default now(),
    constraint account_freeze_requests_unfreeze_after_request
        check (unfreeze_at > requested_at),
    constraint account_freeze_requests_delete_after_request
        check (delete_after = requested_at + interval '720 hours'),
    constraint account_freeze_requests_unfreeze_within_delete_window
        check (unfreeze_at <= delete_after)
);

alter table public.account_freeze_requests
    add column if not exists reactivated_at timestamptz;

create index if not exists account_freeze_requests_delete_after_idx
    on public.account_freeze_requests (delete_after);

create table if not exists public.pending_account_deletions (
    user_id uuid primary key references auth.users(id) on delete cascade,
    token_hash text not null,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
);

create index if not exists pending_account_deletions_expires_at_idx
    on public.pending_account_deletions (expires_at);

alter table public.account_freeze_requests enable row level security;
alter table public.pending_account_deletions enable row level security;

drop policy if exists "Users can read their own account freeze request"
    on public.account_freeze_requests;
create policy "Users can read their own account freeze request"
    on public.account_freeze_requests
    for select to authenticated
    using (auth.uid() = user_id);

revoke all on public.account_freeze_requests from anon, authenticated;
grant select on public.account_freeze_requests to authenticated;
grant all on public.account_freeze_requests to service_role;
revoke all on public.pending_account_deletions from anon, authenticated;
grant all on public.pending_account_deletions to service_role;

commit;
