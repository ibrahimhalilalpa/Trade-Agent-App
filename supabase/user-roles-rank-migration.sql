begin;

create table if not exists public.user_roles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    role text not null default 'user'
        check (role in ('user', 'pro_trader', 'analyst', 'admin', 'super_admin')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.academy_lessons (
    id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    chapter_id text not null check (char_length(chapter_id) between 1 and 100),
    chapter_title text not null check (char_length(chapter_title) between 1 and 160),
    title text not null check (char_length(title) between 1 and 180),
    level text not null check (level in ('Başlangıç', 'Orta', 'İleri')),
    duration text not null default '15 dk' check (char_length(duration) <= 30),
    summary text not null default '',
    concept text not null default '',
    bist_example text not null default '',
    application text not null default '',
    formula text not null default '',
    pitfalls text[] not null default '{}',
    checklist text[] not null default '{}',
    quiz_questions jsonb not null default '[]'::jsonb,
    sort_order integer not null default 0,
    published boolean not null default true,
    updated_by uuid references auth.users(id) on delete set null,
    updated_at timestamptz not null default now()
);

create table if not exists public.system_announcements (
    id uuid primary key default gen_random_uuid(),
    title text not null check (char_length(title) between 1 and 120),
    message text not null check (char_length(message) between 1 and 500),
    severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
    active boolean not null default true,
    starts_at timestamptz not null default now(),
    ends_at timestamptz,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);

alter table public.academy_lessons add column if not exists quiz_questions jsonb not null default '[]'::jsonb;

alter table public.academy_lessons enable row level security;
alter table public.system_announcements enable row level security;

grant select on public.academy_lessons, public.system_announcements to anon, authenticated;
grant insert, update, delete on public.academy_lessons, public.system_announcements to authenticated;
grant all on public.academy_lessons, public.system_announcements to service_role;

insert into public.user_roles (user_id)
select id from auth.users
on conflict (user_id) do nothing;

alter table public.user_profiles
    add column if not exists leaderboard_visible boolean not null default false,
    add column if not exists rank_xp_adjustment integer not null default 0
        check (rank_xp_adjustment between -1000000 and 1000000);

create index if not exists user_roles_role_idx on public.user_roles(role);
create index if not exists user_profiles_leaderboard_visible_idx
    on public.user_profiles(user_id) where leaderboard_visible;
create index if not exists portfolio_transactions_adjustments_idx
    on public.portfolio_transactions(portfolio_id, created_at desc)
    where transaction_type = 'cash_adjustment';

drop trigger if exists user_roles_touch_updated_at on public.user_roles;
create trigger user_roles_touch_updated_at before update on public.user_roles
    for each row execute procedure public.touch_updated_at();

create or replace function public.has_admin_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.user_roles
        where user_id = auth.uid() and role in ('admin', 'super_admin')
    );
$$;

drop policy if exists "Public read published academy lessons" on public.academy_lessons;
create policy "Public read published academy lessons" on public.academy_lessons
    for select using (published or public.has_admin_role());
drop policy if exists "Admins manage academy lessons" on public.academy_lessons;
create policy "Admins manage academy lessons" on public.academy_lessons
    for all using (public.has_admin_role()) with check (public.has_admin_role());
drop policy if exists "Public read active announcements" on public.system_announcements;
create policy "Public read active announcements" on public.system_announcements
    for select using (
        (active and starts_at <= now() and (ends_at is null or ends_at > now()))
        or public.has_admin_role()
    );
drop policy if exists "Admins manage announcements" on public.system_announcements;
create policy "Admins manage announcements" on public.system_announcements
    for all using (public.has_admin_role()) with check (public.has_admin_role());

create or replace function public.get_public_academy_lessons()
returns table (
    id text,
    published boolean,
    chapter_id text,
    chapter_title text,
    title text,
    level text,
    duration text,
    summary text,
    concept text,
    bist_example text,
    application text,
    formula text,
    pitfalls text[],
    checklist text[],
    quiz_questions jsonb,
    sort_order integer
)
language sql
stable
security definer
set search_path = public
as $$
    select l.id, l.published,
        case when l.published then l.chapter_id end,
        case when l.published then l.chapter_title end,
        case when l.published then l.title end,
        case when l.published then l.level end,
        case when l.published then l.duration end,
        case when l.published then l.summary end,
        case when l.published then l.concept end,
        case when l.published then l.bist_example end,
        case when l.published then l.application end,
        case when l.published then l.formula end,
        case when l.published then l.pitfalls end,
        case when l.published then l.checklist end,
        case when l.published then l.quiz_questions end,
        case when l.published then l.sort_order end
    from public.academy_lessons l
    where l.published or l.id ~ '^lesson-[0-9]+-[0-9]+$'
    order by coalesce(l.sort_order, 0), l.id
$$;
revoke all on function public.get_public_academy_lessons() from public;
grant execute on function public.get_public_academy_lessons() to anon, authenticated;

alter table public.user_roles enable row level security;
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
grant all on public.user_profiles to service_role;
grant all on public.user_portfolios to service_role;
grant all on public.user_positions to service_role;
grant all on public.portfolio_transactions, public.portfolio_snapshots,
    public.portfolio_orders, public.portfolio_order_events, public.price_alerts,
    public.price_alert_events, public.user_education_progress, public.user_activity_logs,
    public.academy_lessons, public.system_announcements
    to service_role;
grant select on public.portfolio_transactions, public.portfolio_snapshots,
    public.portfolio_orders, public.portfolio_order_events, public.price_alerts,
    public.price_alert_events, public.user_education_progress, public.user_activity_logs,
    public.academy_lessons, public.system_announcements
    to authenticated;
grant update on public.portfolio_orders to authenticated;
drop policy if exists "Users read own role" on public.user_roles;
create policy "Users read own role" on public.user_roles
    for select using (auth.uid() = user_id);
drop policy if exists "Admins read roles" on public.user_roles;
create policy "Admins read roles" on public.user_roles
    for select using (public.has_admin_role());

create or replace function public.handle_new_user_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.user_roles (user_id, role)
    values (new.id, 'user')
    on conflict (user_id) do nothing;
    return new;
end;
$$;

drop trigger if exists auth_user_default_role on auth.users;
create trigger auth_user_default_role
    after insert on auth.users
    for each row execute procedure public.handle_new_user_role();

drop policy if exists "Admins read all profiles" on public.user_profiles;
create policy "Admins read all profiles" on public.user_profiles
    for select using (public.has_admin_role());

drop policy if exists "Admins update all profiles" on public.user_profiles;
create policy "Admins update all profiles" on public.user_profiles
    for update using (public.has_admin_role()) with check (public.has_admin_role());

drop policy if exists "Admins read all portfolios" on public.user_portfolios;
create policy "Admins read all portfolios" on public.user_portfolios
    for select using (public.has_admin_role());
drop policy if exists "Admins update all portfolios" on public.user_portfolios;
create policy "Admins update all portfolios" on public.user_portfolios
    for update using (public.has_admin_role()) with check (public.has_admin_role());

drop policy if exists "Admins read all positions" on public.user_positions;
create policy "Admins read all positions" on public.user_positions
    for select using (public.has_admin_role());
drop policy if exists "Admins update all positions" on public.user_positions;
create policy "Admins update all positions" on public.user_positions
    for update using (public.has_admin_role()) with check (public.has_admin_role());

drop policy if exists "Admins read all portfolio transactions" on public.portfolio_transactions;
create policy "Admins read all portfolio transactions" on public.portfolio_transactions
    for select using (public.has_admin_role());
drop policy if exists "Admins read all portfolio snapshots" on public.portfolio_snapshots;
create policy "Admins read all portfolio snapshots" on public.portfolio_snapshots
    for select using (public.has_admin_role());

drop policy if exists "Admins read all portfolio orders" on public.portfolio_orders;
create policy "Admins read all portfolio orders" on public.portfolio_orders
    for select using (public.has_admin_role());
drop policy if exists "Admins update all portfolio orders" on public.portfolio_orders;
create policy "Admins update all portfolio orders" on public.portfolio_orders
    for update using (public.has_admin_role()) with check (public.has_admin_role());

drop policy if exists "Admins read all order events" on public.portfolio_order_events;
create policy "Admins read all order events" on public.portfolio_order_events
    for select using (public.has_admin_role());

drop policy if exists "Admins read all price alerts" on public.price_alerts;
create policy "Admins read all price alerts" on public.price_alerts
    for select using (public.has_admin_role());
drop policy if exists "Admins update all price alerts" on public.price_alerts;
create policy "Admins update all price alerts" on public.price_alerts
    for update using (public.has_admin_role()) with check (public.has_admin_role());
drop policy if exists "Admins read all alert events" on public.price_alert_events;
create policy "Admins read all alert events" on public.price_alert_events
    for select using (public.has_admin_role());

drop policy if exists "Admins read all education progress" on public.user_education_progress;
create policy "Admins read all education progress" on public.user_education_progress
    for select using (public.has_admin_role());
drop policy if exists "Admins read all activity logs" on public.user_activity_logs;
create policy "Admins read all activity logs" on public.user_activity_logs
    for select using (public.has_admin_role());

create or replace function public.snapshot_portfolio_performance()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_snapshot_count integer;
begin
    insert into public.portfolio_snapshots (portfolio_id, snapshot_date, cash_balance, total_value)
    select pf.id, (timezone('utc', now()))::date, pf.balance,
        pf.balance + coalesce(sum(pos.quantity * pos.current_price), 0)
    from public.user_portfolios pf
    left join public.user_positions pos on pos.portfolio_id = pf.id
    group by pf.id, pf.balance
    on conflict (portfolio_id, snapshot_date) do update
    set cash_balance = excluded.cash_balance, total_value = excluded.total_value, created_at = now();
    get diagnostics v_snapshot_count = row_count;
    return v_snapshot_count;
end;
$$;

revoke all on function public.snapshot_portfolio_performance() from public;
grant execute on function public.snapshot_portfolio_performance() to service_role;

do $$
declare
    v_job_id bigint;
begin
    if to_regclass('cron.job') is null then
        raise exception 'pg_cron must be enabled before installing the daily portfolio snapshot job.';
    end if;
    select jobid into v_job_id from cron.job where jobname = 'portfolio-performance-daily-snapshot';
    if v_job_id is not null then
        perform cron.unschedule(v_job_id);
    end if;
    perform cron.schedule(
        'portfolio-performance-daily-snapshot',
        '0 0 * * *',
        'select public.snapshot_portfolio_performance();'
    );
end;
$$;

select public.snapshot_portfolio_performance();

create or replace function public.admin_list_users()
returns table (
    id uuid,
    email text,
    "createdAt" timestamptz,
    "lastSignInAt" timestamptz,
    "emailVerifiedAt" timestamptz,
    banned boolean,
    "displayName" text,
    role text,
    balance numeric,
    "portfolioValue" numeric,
    "realizedPnl" numeric,
    "unrealizedPnl" numeric,
    "positionsCount" bigint
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
    if coalesce(auth.role(), '') <> 'service_role' and not public.has_admin_role() then
        raise exception 'Administrator access required.';
    end if;
    return query
    select u.id, u.email::text, u.created_at, u.last_sign_in_at, u.email_confirmed_at,
        coalesce(u.banned_until > now(), false),
        coalesce(nullif(up.display_name, ''), nullif(up.full_name, ''), ''),
        coalesce(ur.role, 'user'),
        coalesce(pf.balance, 0),
        coalesce(pf.balance, 0) + coalesce(pos.position_value, 0),
        coalesce(tx.realized_pnl, 0),
        coalesce(pos.unrealized_pnl, 0),
        coalesce(pos.positions_count, 0)
    from auth.users u
    left join public.user_profiles up on up.user_id = u.id
    left join public.user_roles ur on ur.user_id = u.id
    left join public.user_portfolios pf on pf.user_id = u.id
    left join lateral (
        select sum(p.quantity * p.current_price) as position_value,
            sum(p.pnl) as unrealized_pnl, count(*) as positions_count
        from public.user_positions p where p.portfolio_id = pf.id
    ) pos on true
    left join lateral (
        select sum(t.realized_pnl) as realized_pnl
        from public.portfolio_transactions t where t.portfolio_id = pf.id
    ) tx on true
    order by u.created_at desc;
end;
$$;

create or replace function public.admin_get_user_auth(p_target_id uuid)
returns table (
    id uuid,
    email text,
    created_at timestamptz,
    last_sign_in_at timestamptz,
    email_confirmed_at timestamptz,
    banned_until timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
    if coalesce(auth.role(), '') <> 'service_role' and not public.has_admin_role() then
        raise exception 'Administrator access required.';
    end if;
    return query select u.id, u.email::text, u.created_at, u.last_sign_in_at, u.email_confirmed_at, u.banned_until
        from auth.users u where u.id = p_target_id;
end;
$$;

create or replace function public.admin_get_system_status(p_actor_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_cron_enabled boolean := to_regclass('cron.job') is not null;
    v_cron_job jsonb := null;
    v_last_run jsonb := null;
    v_vault_configured boolean := false;
    v_vault_url_configured boolean := false;
begin
    if coalesce(auth.role(), '') <> 'service_role' then
        if auth.uid() is null or auth.uid() is distinct from coalesce(p_actor_id, auth.uid())
           or not public.has_admin_role() then raise exception 'Administrator access required.'; end if;
    elsif not exists (select 1 from public.user_roles where user_id = p_actor_id and role in ('admin', 'super_admin')) then
        raise exception 'Administrator access required.';
    end if;
    if v_cron_enabled then
        begin
            execute $query$
                select jsonb_build_object('jobid', jobid, 'active', active, 'schedule', schedule, 'command', command)
                from cron.job where jobname = 'portfolio-order-monitor-every-minute' limit 1
            $query$ into v_cron_job;
        exception when others then
            v_cron_job := jsonb_build_object('error', 'Cron job status is not readable.');
        end;
        begin
            execute $query$
                select jsonb_build_object('status', status, 'return_message', return_message, 'end_time', end_time)
                from cron.job_run_details j
                join cron.job c on c.jobid = j.jobid
                where c.jobname = 'portfolio-order-monitor-every-minute'
                order by j.start_time desc limit 1
            $query$ into v_last_run;
        exception when others then
            v_last_run := jsonb_build_object('error', 'Latest cron execution is not readable.');
        end;
    end if;
    if to_regclass('vault.decrypted_secrets') is not null then
        begin
            execute 'select exists(select 1 from vault.decrypted_secrets where name = $1)' into v_vault_configured using 'portfolio_order_monitor_token';
            execute 'select exists(select 1 from vault.decrypted_secrets where name = $1)' into v_vault_url_configured using 'portfolio_order_monitor_url';
        exception when others then
            v_vault_configured := false;
            v_vault_url_configured := false;
        end;
    end if;
    return jsonb_build_object(
        'database', 'connected',
        'cronEnabled', v_cron_enabled,
        'orderMonitorJob', v_cron_job,
        'lastOrderMonitorRun', v_last_run,
        'vaultTokenConfigured', v_vault_configured,
        'vaultUrlConfigured', v_vault_url_configured
    );
end;
$$;

create or replace function public.admin_update_order_status(
    p_actor_id uuid,
    p_order_id uuid,
    p_status text,
    p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_order public.portfolio_orders%rowtype;
begin
    if coalesce(auth.role(), '') <> 'service_role' then
        if auth.uid() is null or auth.uid() is distinct from p_actor_id or not public.has_admin_role() then
            raise exception 'Administrator access required.';
        end if;
    elsif not exists (select 1 from public.user_roles where user_id = p_actor_id and role in ('admin', 'super_admin')) then
        raise exception 'Administrator access required.';
    end if;
    if p_status not in ('cancelled', 'failed') then
        raise exception 'Admins may cancel an order or mark it failed; fills require the portfolio execution flow.';
    end if;
    select * into v_order from public.portfolio_orders where id = p_order_id for update;
    if not found then raise exception 'Order not found.'; end if;
    if v_order.status <> 'pending' then raise exception 'Only pending orders can be modified.'; end if;
    update public.portfolio_orders
    set status = p_status, error = left(trim(coalesce(p_reason, 'Admin intervention')), 180), updated_at = now()
    where id = p_order_id;
    insert into public.user_activity_logs (user_id, event_type, description, metadata)
    select pf.user_id, 'admin_order_status', 'Yönetici bekleyen emir durumunu değiştirdi.',
        jsonb_build_object('order_id', p_order_id, 'status', p_status, 'reason', p_reason)
    from public.user_portfolios pf where pf.id = v_order.portfolio_id;
    return true;
end;
$$;

create or replace function public.admin_update_alert(
    p_actor_id uuid,
    p_alert_id uuid,
    p_status text,
    p_target_price numeric default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_alert public.price_alerts%rowtype;
begin
    if coalesce(auth.role(), '') <> 'service_role' then
        if auth.uid() is null or auth.uid() is distinct from p_actor_id or not public.has_admin_role() then
            raise exception 'Administrator access required.';
        end if;
    elsif not exists (select 1 from public.user_roles where user_id = p_actor_id and role in ('admin', 'super_admin')) then
        raise exception 'Administrator access required.';
    end if;
    if p_status not in ('active', 'cancelled', 'expired') then
        raise exception 'Invalid alert status.';
    end if;
    select * into v_alert from public.price_alerts where id = p_alert_id for update;
    if not found then raise exception 'Alert not found.'; end if;
    update public.price_alerts
    set status = p_status,
        target_price = coalesce(p_target_price, target_price),
        updated_at = now()
    where id = p_alert_id;
    insert into public.user_activity_logs (user_id, event_type, description, metadata)
    values (v_alert.user_id, 'admin_alert_status', 'Yönetici fiyat alarmını güncelledi.',
        jsonb_build_object('alert_id', p_alert_id, 'status', p_status, 'target_price', coalesce(p_target_price, v_alert.target_price)));
    return true;
end;
$$;

alter table public.user_activity_logs drop constraint if exists user_activity_logs_event_type_check;
alter table public.user_activity_logs add constraint user_activity_logs_event_type_check
    check (event_type in ('login', 'logout', 'profile_updated', 'password_changed', 'password_failed',
        'password_reset_requested', 'list_created', 'list_renamed', 'list_deleted', 'stock_added',
        'stock_removed', 'portfolio_order', 'portfolio_cash_adjustment', 'lesson_completed',
        'lesson_uncompleted', 'admin_cash_adjustment', 'admin_role_changed', 'admin_account_status',
        'admin_order_status', 'admin_alert_status', 'admin_position_adjusted', 'admin_rank_adjusted',
        'admin_profile_updated', 'admin_user_invited'));

create or replace function public.admin_adjust_position(
    p_actor_id uuid,
    p_position_id uuid,
    p_action text,
    p_quantity numeric default null,
    p_average_price numeric default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_position public.user_positions%rowtype;
    v_user_id uuid;
begin
    if coalesce(auth.role(), '') <> 'service_role' then
        if auth.uid() is null or auth.uid() is distinct from p_actor_id or not public.has_admin_role() then
            raise exception 'Administrator access required.';
        end if;
    elsif not exists (select 1 from public.user_roles where user_id = p_actor_id and role in ('admin', 'super_admin')) then
        raise exception 'Administrator access required.';
    end if;
    if p_action is null or p_action not in ('update', 'delete') then raise exception 'Invalid position action.'; end if;
    select pos.* into v_position
    from public.user_positions pos
    join public.user_portfolios pf on pf.id = pos.portfolio_id
    where pos.id = p_position_id
    for update of pos;
    if not found then raise exception 'Position not found.'; end if;
    select user_id into v_user_id from public.user_portfolios where id = v_position.portfolio_id;
    if p_action = 'delete' then
        delete from public.user_positions where id = p_position_id;
    else
        if p_quantity is null or p_quantity <= 0 or p_average_price is null or p_average_price <= 0 then
            raise exception 'Quantity and average price must be positive.';
        end if;
        update public.user_positions
        set quantity = p_quantity, average_price = p_average_price,
            pnl = (current_price - p_average_price) * p_quantity, updated_at = now()
        where id = p_position_id;
    end if;
    insert into public.user_activity_logs (user_id, event_type, description, metadata)
    values (v_user_id, 'admin_position_adjusted', 'Yönetici portföy pozisyonuna müdahale etti.',
        jsonb_build_object('actor_id', p_actor_id, 'position_id', p_position_id, 'action', p_action));
    return true;
end;
$$;

create or replace function public.admin_set_user_role(
    p_actor_id uuid,
    p_target_id uuid,
    p_role text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_role text;
    v_target_role text;
begin
    if coalesce(auth.role(), '') <> 'service_role'
       and (auth.uid() is null or auth.uid() is distinct from p_actor_id) then
        raise exception 'Role changes require the authenticated administrator.';
    end if;
    if p_role is null or p_role not in ('user', 'pro_trader', 'analyst', 'admin', 'super_admin') then
        raise exception 'Invalid role.';
    end if;
    select role into v_actor_role from public.user_roles where user_id = p_actor_id;
    select role into v_target_role from public.user_roles where user_id = p_target_id;
    if v_actor_role not in ('admin', 'super_admin') or v_target_role is null then
        raise exception 'Unauthorized role change.';
    end if;
    if v_actor_role <> 'super_admin' and p_role in ('admin', 'super_admin') then
        raise exception 'Only a super admin may grant administrative roles.';
    end if;
    if v_actor_role <> 'super_admin' and v_target_role in ('admin', 'super_admin') then
        raise exception 'Only a super admin may modify administrative roles.';
    end if;
    if p_actor_id = p_target_id and v_actor_role = 'super_admin' and p_role <> 'super_admin' then
        raise exception 'A super admin cannot demote their own account.';
    end if;

    update public.user_roles set role = p_role, updated_at = now() where user_id = p_target_id;
    insert into public.user_activity_logs (user_id, event_type, description, metadata)
    values (p_target_id, 'admin_role_changed', 'Kullanıcı rolü yönetici tarafından güncellendi.',
        jsonb_build_object('actor_id', p_actor_id, 'role', p_role, 'actor_role', v_actor_role));
    return true;
end;
$$;

create or replace function public.admin_adjust_portfolio_cash(
    p_actor_id uuid,
    p_target_id uuid,
    p_delta numeric,
    p_note text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_role text;
    v_portfolio public.user_portfolios%rowtype;
    v_total_value numeric(18, 4);
begin
    if coalesce(auth.role(), '') <> 'service_role'
       and (auth.uid() is null or auth.uid() is distinct from p_actor_id) then
        raise exception 'Portfolio adjustments require the authenticated administrator.';
    end if;
    select role into v_actor_role from public.user_roles where user_id = p_actor_id;
    if v_actor_role not in ('admin', 'super_admin') then
        raise exception 'Unauthorized portfolio adjustment.';
    end if;
    if p_delta is null or p_delta = 0 or abs(p_delta) > 1000000000
       or char_length(trim(coalesce(p_note, ''))) not between 1 and 180 then
        raise exception 'Invalid cash adjustment.';
    end if;

    select * into v_portfolio from public.user_portfolios where user_id = p_target_id for update;
    if not found then
        raise exception 'Target portfolio not found.';
    end if;
    update public.user_portfolios
    set balance = balance + p_delta, updated_at = now()
    where id = v_portfolio.id
    returning * into v_portfolio;

    insert into public.portfolio_transactions
        (portfolio_id, transaction_type, quantity, price, cash_delta, realized_pnl, balance_after)
    values (v_portfolio.id, 'cash_adjustment', 0, 0, p_delta, 0, v_portfolio.balance);

    select v_portfolio.balance + coalesce(sum(quantity * current_price), 0)
    into v_total_value from public.user_positions where portfolio_id = v_portfolio.id;
    insert into public.portfolio_snapshots (portfolio_id, snapshot_date, cash_balance, total_value)
    values (v_portfolio.id, (timezone('utc', now()))::date, v_portfolio.balance, v_total_value)
    on conflict (portfolio_id, snapshot_date) do update
    set cash_balance = excluded.cash_balance, total_value = excluded.total_value, created_at = now();

    insert into public.user_activity_logs (user_id, event_type, description, metadata)
    values (p_target_id, 'admin_cash_adjustment', left(trim(p_note), 180),
        jsonb_build_object('actor_id', p_actor_id, 'delta', p_delta));
    return true;
end;
$$;

create or replace function public.admin_set_rank_xp_adjustment(
    p_actor_id uuid,
    p_target_id uuid,
    p_adjustment integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_role text;
begin
    if coalesce(auth.role(), '') <> 'service_role'
       and (auth.uid() is null or auth.uid() is distinct from p_actor_id) then
        raise exception 'Rank updates require the authenticated administrator.';
    end if;
    select role into v_actor_role from public.user_roles where user_id = p_actor_id;
    if v_actor_role not in ('admin', 'super_admin') then raise exception 'Unauthorized rank update.'; end if;
    if p_adjustment is null or p_adjustment not between -1000000 and 1000000 then
        raise exception 'XP adjustment is out of range.';
    end if;
    insert into public.user_profiles (user_id, rank_xp_adjustment)
    values (p_target_id, p_adjustment)
    on conflict (user_id) do update set rank_xp_adjustment = excluded.rank_xp_adjustment;
    insert into public.user_activity_logs (user_id, event_type, description, metadata)
    values (p_target_id, 'admin_rank_adjusted', 'Yönetici Trader Rank XP düzeltmesi yaptı.',
        jsonb_build_object('actor_id', p_actor_id, 'xp_adjustment', p_adjustment));
    return true;
end;
$$;

create or replace function public.admin_update_user_profile(
    p_actor_id uuid,
    p_target_id uuid,
    p_display_name text,
    p_full_name text,
    p_bio text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_role text;
begin
    if coalesce(auth.role(), '') <> 'service_role'
       and (auth.uid() is null or auth.uid() is distinct from p_actor_id) then
        raise exception 'Profile updates require the authenticated administrator.';
    end if;
    select role into v_actor_role from public.user_roles where user_id = p_actor_id;
    if v_actor_role not in ('admin', 'super_admin') then raise exception 'Unauthorized profile update.'; end if;
    if not exists (select 1 from auth.users where id = p_target_id) then raise exception 'Target user not found.'; end if;
    if char_length(trim(coalesce(p_display_name, ''))) > 60
       or char_length(trim(coalesce(p_full_name, ''))) > 120
       or char_length(trim(coalesce(p_bio, ''))) > 280 then
        raise exception 'Profile field exceeds the allowed length.';
    end if;
    insert into public.user_profiles (user_id, display_name, full_name, bio)
    values (p_target_id, trim(coalesce(p_display_name, '')), trim(coalesce(p_full_name, '')), trim(coalesce(p_bio, '')))
    on conflict (user_id) do update set
        display_name = excluded.display_name,
        full_name = excluded.full_name,
        bio = excluded.bio,
        updated_at = now();
    insert into public.user_activity_logs (user_id, event_type, description, metadata)
    values (p_target_id, 'admin_profile_updated', 'Yönetici kullanıcı profilini güncelledi.',
        jsonb_build_object('actor_id', p_actor_id));
    return true;
end;
$$;

create or replace function public.get_trader_rank(p_user_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_user_id uuid := coalesce(p_user_id, auth.uid());
    v_completed integer;
    v_active_days integer;
    v_balance numeric;
    v_positions_value numeric;
    v_cash_adjustments numeric;
    v_pnl numeric;
    v_pnl_percent numeric;
    v_xp bigint;
    v_xp_adjustment integer;
    v_rank text;
    v_next_xp bigint;
begin
    if v_user_id is null then
        raise exception 'Authentication required.';
    end if;
    if auth.uid() is not null and auth.uid() <> v_user_id and not public.has_admin_role() then
        raise exception 'You may only view your own trader rank.';
    end if;
    if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
        raise exception 'A trusted request is required to read another trader rank.';
    end if;
    select count(*) into v_completed from public.user_education_progress
    where user_id = v_user_id and completed;
    select count(distinct created_at::date) into v_active_days from public.user_activity_logs
    where user_id = v_user_id;
    select coalesce(rank_xp_adjustment, 0) into v_xp_adjustment
    from public.user_profiles where user_id = v_user_id;
    select balance into v_balance from public.user_portfolios where user_id = v_user_id;
    select coalesce(sum(quantity * current_price), 0) into v_positions_value
    from public.user_positions p join public.user_portfolios pf on pf.id = p.portfolio_id
    where pf.user_id = v_user_id;
    select coalesce(sum(cash_delta), 0) into v_cash_adjustments
    from public.portfolio_transactions t join public.user_portfolios pf on pf.id = t.portfolio_id
    where pf.user_id = v_user_id and t.transaction_type = 'cash_adjustment';

    v_pnl := coalesce(v_balance, 0) + v_positions_value - 100000 - v_cash_adjustments;
    v_pnl_percent := case when 100000 + v_cash_adjustments > 0
        then v_pnl / (100000 + v_cash_adjustments) * 100 else 0 end;
    v_xp := greatest(0, v_completed * 100 + v_active_days * 10
        + floor(greatest(v_pnl_percent, 0) * 100)::bigint + coalesce(v_xp_adjustment, 0));
    v_rank := case when v_xp >= 5000 then 'Piyasa Yapıcı'
        when v_xp >= 2000 then 'Üstat'
        when v_xp >= 500 then 'Analist'
        else 'Çaylak' end;
    v_next_xp := case when v_xp >= 5000 then 5000
        when v_xp >= 2000 then 5000
        when v_xp >= 500 then 2000
        else 500 end;
    return jsonb_build_object(
        'xp', v_xp, 'rank', v_rank, 'nextRankXp', v_next_xp,
        'rankProgress', case when v_xp >= 5000 then 100
            when v_xp >= 2000 then least(100, ((v_xp - 2000)::numeric / 3000 * 100)::integer)
            when v_xp >= 500 then least(100, ((v_xp - 500)::numeric / 1500 * 100)::integer)
            else least(100, (v_xp::numeric / 500 * 100)::integer) end,
        'completedLessons', v_completed, 'activeDays', v_active_days,
        'pnl', v_pnl, 'pnlPercent', v_pnl_percent
    );
end;
$$;

drop function if exists public.get_public_leaderboard(text);

create function public.get_public_leaderboard(p_period text default 'all')
returns table (
    user_id uuid,
    display_name text,
    trader_rank text,
    xp bigint,
    pnl_percent numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if p_period is null or p_period not in ('day', 'week', 'month', 'all') then
        raise exception 'Invalid leaderboard period.';
    end if;
    return query
    with eligible as (
        select pf.id as portfolio_id, pf.user_id, pf.balance,
            coalesce(up.display_name, '') as display_name,
            coalesce(up.rank_xp_adjustment, 0) as rank_xp_adjustment,
            coalesce((select sum(pos.quantity * pos.current_price) from public.user_positions pos where pos.portfolio_id = pf.id), 0) as positions_value,
            coalesce((select sum(t.cash_delta) from public.portfolio_transactions t
                where t.portfolio_id = pf.id and t.transaction_type = 'cash_adjustment'), 0) as total_cash_adjustments,
            (select count(*) from public.user_education_progress ep where ep.user_id = pf.user_id and ep.completed) as lessons,
            (select count(distinct a.created_at::date) from public.user_activity_logs a where a.user_id = pf.user_id) as active_days,
            baseline.snapshot_date as baseline_date,
            baseline.total_value as baseline_value,
            coalesce(period_cash.adjustments, 0) as period_cash_adjustments
        from public.user_portfolios pf
        join public.user_profiles up on up.user_id = pf.user_id and up.leaderboard_visible
        left join lateral (
            select s.snapshot_date, s.total_value
            from public.portfolio_snapshots s
            where s.portfolio_id = pf.id
              and case p_period
                when 'day' then s.snapshot_date < (now() at time zone 'UTC')::date
                when 'week' then s.snapshot_date <= (now() at time zone 'UTC')::date - 7
                when 'month' then s.snapshot_date <= (now() at time zone 'UTC')::date - 30
                else false end
            order by s.snapshot_date desc
            limit 1
        ) baseline on p_period <> 'all'
        left join lateral (
            select coalesce(sum(t.cash_delta), 0) as adjustments
            from public.portfolio_transactions t
            where t.portfolio_id = pf.id
              and t.transaction_type = 'cash_adjustment'
              and t.created_at::date > baseline.snapshot_date
        ) period_cash on p_period <> 'all' and baseline.snapshot_date is not null
    ), scores as (
        select e.*,
            case when p_period = 'all'
                then e.balance + e.positions_value - 100000 - e.total_cash_adjustments
                else e.balance + e.positions_value - e.baseline_value - coalesce(e.period_cash_adjustments, 0)
            end as period_pnl,
            case when p_period = 'all' then 100000 + e.total_cash_adjustments
                else e.baseline_value + coalesce(e.period_cash_adjustments, 0) end as capital_base
        from eligible e
        where p_period = 'all' or e.baseline_value is not null
    ), ranked as (
        select s.*,
            case when s.capital_base > 0 then s.period_pnl / s.capital_base * 100 else 0 end as return_percent,
            greatest(0, s.lessons * 100 + s.active_days * 10
                + floor(greatest(
                    case when 100000 + s.total_cash_adjustments > 0
                        then (s.balance + s.positions_value - 100000 - s.total_cash_adjustments)
                            / (100000 + s.total_cash_adjustments) * 100 else 0 end, 0) * 100)::bigint
                + s.rank_xp_adjustment) as total_xp
        from scores s
    )
    select r.user_id,
        coalesce(nullif(r.display_name, ''), 'Trader-' || left(r.user_id::text, 6)),
        case when r.total_xp >= 5000 then 'Piyasa Yapıcı'
             when r.total_xp >= 2000 then 'Üstat'
             when r.total_xp >= 500 then 'Analist'
             else 'Çaylak' end,
        r.total_xp, r.return_percent
    from ranked r
    where r.period_pnl is not null
    order by r.return_percent desc
    limit 50;
end;
$$;

revoke all on function public.admin_set_user_role(uuid, uuid, text) from public;
revoke all on function public.admin_adjust_portfolio_cash(uuid, uuid, numeric, text) from public;
revoke all on function public.admin_list_users() from public;
revoke all on function public.admin_get_user_auth(uuid) from public;
revoke all on function public.admin_get_system_status(uuid) from public;
revoke all on function public.admin_update_order_status(uuid, uuid, text, text) from public;
revoke all on function public.admin_update_alert(uuid, uuid, text, numeric) from public;
revoke all on function public.admin_adjust_position(uuid, uuid, text, numeric, numeric) from public;
revoke all on function public.admin_set_rank_xp_adjustment(uuid, uuid, integer) from public;
revoke all on function public.admin_update_user_profile(uuid, uuid, text, text, text) from public;
revoke all on function public.get_trader_rank(uuid) from public;
revoke all on function public.get_public_leaderboard(text) from public;
revoke all on function public.has_admin_role() from public;
grant execute on function public.admin_set_user_role(uuid, uuid, text) to service_role;
grant execute on function public.admin_adjust_portfolio_cash(uuid, uuid, numeric, text) to service_role;
grant execute on function public.admin_list_users() to authenticated, service_role;
grant execute on function public.admin_get_user_auth(uuid) to authenticated, service_role;
grant execute on function public.admin_get_system_status(uuid) to authenticated, service_role;
grant execute on function public.admin_update_order_status(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.admin_update_alert(uuid, uuid, text, numeric) to authenticated, service_role;
grant execute on function public.admin_adjust_position(uuid, uuid, text, numeric, numeric) to authenticated, service_role;
grant execute on function public.admin_set_rank_xp_adjustment(uuid, uuid, integer) to authenticated, service_role;
grant execute on function public.admin_update_user_profile(uuid, uuid, text, text, text) to authenticated, service_role;
grant execute on function public.admin_set_user_role(uuid, uuid, text) to authenticated;
grant execute on function public.admin_adjust_portfolio_cash(uuid, uuid, numeric, text) to authenticated;
grant execute on function public.get_trader_rank(uuid) to authenticated, service_role;
grant execute on function public.get_public_leaderboard(text) to anon, authenticated;
grant execute on function public.has_admin_role() to authenticated;

grant select on public.user_roles to authenticated;

notify pgrst, 'reload schema';
commit;
