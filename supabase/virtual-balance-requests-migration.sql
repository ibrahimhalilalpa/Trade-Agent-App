begin;

alter table public.user_notifications add column if not exists event_key text;
alter table public.notification_event_templates
    drop constraint if exists notification_event_templates_event_key_check,
    add constraint notification_event_templates_event_key_check
        check (event_key ~ '^[a-z][a-z0-9_]{1,79}$');

insert into public.notification_event_templates (event_key, title, message, category, severity) values
    ('balance_request_approved', 'Bakiye talebin onaylandı', 'Sanal cüzdanına {{amount}} TL aktarıldı. {{admin_note}}', 'portfolio', 'success'),
    ('balance_request_rejected', 'Bakiye talebin sonuçlandı', 'Sanal bakiye talebin onaylanmadı. {{admin_note}}', 'portfolio', 'warning')
on conflict (event_key) do nothing;

create table if not exists public.virtual_balance_requests (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    requested_amount numeric(18, 2) not null check (requested_amount > 0 and requested_amount <= 1000000000),
    reason text not null check (char_length(trim(reason)) between 5 and 500),
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    approved_amount numeric(18, 2),
    admin_note text,
    reviewed_by uuid references auth.users(id) on delete set null,
    reviewed_at timestamptz,
    created_at timestamptz not null default now(),
    check ((status = 'pending' and approved_amount is null and reviewed_at is null)
        or (status = 'rejected' and approved_amount is null and reviewed_at is not null)
        or (status = 'approved' and approved_amount > 0 and reviewed_at is not null))
);

create unique index if not exists virtual_balance_requests_one_pending_per_user_idx
    on public.virtual_balance_requests (user_id) where status = 'pending';
create index if not exists virtual_balance_requests_pending_created_idx
    on public.virtual_balance_requests (created_at) where status = 'pending';

alter table public.virtual_balance_requests enable row level security;
drop policy if exists "Users and admins read virtual balance requests" on public.virtual_balance_requests;
create policy "Users and admins read virtual balance requests" on public.virtual_balance_requests
    for select using (user_id = auth.uid() or public.has_admin_role());
revoke all on public.virtual_balance_requests from anon, authenticated;
grant select on public.virtual_balance_requests to authenticated;
grant all on public.virtual_balance_requests to service_role;

insert into public.user_portfolios (user_id, balance)
select id, 100000 from auth.users
on conflict (user_id) do nothing;
alter table public.user_portfolios alter column balance set default 100000;
revoke update, delete on public.user_portfolios from authenticated;

create or replace function public.enforce_initial_virtual_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    new.balance := 100000;
    return new;
end;
$$;

drop trigger if exists user_portfolio_initial_balance on public.user_portfolios;
create trigger user_portfolio_initial_balance
    before insert on public.user_portfolios
    for each row execute function public.enforce_initial_virtual_balance();

create or replace function public.create_virtual_balance_request(p_amount numeric, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
    v_request_id uuid;
begin
    if auth.uid() is null then
        raise exception 'Authentication required.';
    end if;
    if p_amount is null or p_amount <= 0 or p_amount > 1000000000
       or p_amount <> round(p_amount, 2)
       or char_length(trim(coalesce(p_reason, ''))) not between 5 and 500 then
        raise exception 'Invalid virtual balance request.';
    end if;
    insert into public.user_portfolios (user_id, balance)
    values (auth.uid(), 100000)
    on conflict (user_id) do nothing;
    insert into public.virtual_balance_requests (user_id, requested_amount, reason)
    values (auth.uid(), p_amount, trim(p_reason))
    returning id into v_request_id;
    return v_request_id;
end;
$$;

create or replace function public.admin_review_virtual_balance_request(
    p_request_id uuid,
    p_approve boolean,
    p_approved_amount numeric default null,
    p_admin_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
    v_actor_id uuid := auth.uid();
    v_request public.virtual_balance_requests%rowtype;
    v_portfolio public.user_portfolios%rowtype;
    v_total_value numeric(18, 4);
    v_amount numeric(18, 2);
begin
    if v_actor_id is null or not exists (
        select 1 from public.user_roles where user_id = v_actor_id and role = 'super_admin'
    ) then
        raise exception 'Super administrator access required.';
    end if;
    if p_request_id is null or p_approve is null
       or char_length(trim(coalesce(p_admin_note, ''))) > 180 then
        raise exception 'Invalid review request.';
    end if;

    select * into v_request from public.virtual_balance_requests
    where id = p_request_id for update;
    if not found or v_request.status <> 'pending' then
        raise exception 'Request is not pending.';
    end if;

    if p_approve then
        v_amount := p_approved_amount;
        if v_amount is null or v_amount <= 0 or v_amount > 1000000000
           or v_amount <> round(v_amount, 2) then
            raise exception 'Approved amount must be between 0.01 and 1,000,000,000.';
        end if;
        insert into public.user_portfolios (user_id, balance)
        values (v_request.user_id, 100000)
        on conflict (user_id) do nothing;
        select * into v_portfolio from public.user_portfolios
        where user_id = v_request.user_id for update;
        update public.user_portfolios
        set balance = balance + v_amount, updated_at = now()
        where id = v_portfolio.id
        returning * into v_portfolio;
        insert into public.portfolio_transactions
            (portfolio_id, transaction_type, quantity, price, cash_delta, realized_pnl, balance_after)
        values (v_portfolio.id, 'cash_adjustment', 0, 0, v_amount, 0, v_portfolio.balance);
        select v_portfolio.balance + coalesce(sum(quantity * current_price), 0)
        into v_total_value from public.user_positions where portfolio_id = v_portfolio.id;
        insert into public.portfolio_snapshots (portfolio_id, snapshot_date, cash_balance, total_value)
        values (v_portfolio.id, (timezone('utc', now()))::date, v_portfolio.balance, v_total_value)
        on conflict (portfolio_id, snapshot_date) do update
        set cash_balance = excluded.cash_balance, total_value = excluded.total_value, created_at = now();
    end if;

    update public.virtual_balance_requests
    set status = case when p_approve then 'approved' else 'rejected' end,
        approved_amount = case when p_approve then v_amount else null end,
        admin_note = nullif(trim(coalesce(p_admin_note, '')), ''),
        reviewed_by = v_actor_id,
        reviewed_at = now()
    where id = v_request.id;

    if p_approve then
        perform public.deliver_event_notification(v_request.user_id, 'balance_request_approved', jsonb_build_object(
            'amount', replace(to_char(v_amount, 'FM999999999990D00'), '.', ','),
            'admin_note', case when nullif(trim(coalesce(p_admin_note, '')), '') is null then ''
                else 'Yönetici notu: ' || trim(p_admin_note) end
        ));
        insert into public.user_activity_logs (user_id, event_type, description, metadata)
        values (
            v_request.user_id, 'portfolio_cash_adjustment',
            left(format('Bakiye talebi onaylandı: %s TL aktarıldı.',
                replace(to_char(v_amount, 'FM999999999990D00'), '.', ',')), 180),
            jsonb_build_object('request_id', v_request.id, 'requested_amount', v_request.requested_amount,
                'approved_amount', v_amount, 'reviewed_by', v_actor_id)
        );
    else
        perform public.deliver_event_notification(v_request.user_id, 'balance_request_rejected', jsonb_build_object(
            'admin_note', case when nullif(trim(coalesce(p_admin_note, '')), '') is null then ''
                else 'Yönetici notu: ' || trim(p_admin_note) end
        ));
    end if;

    return jsonb_build_object('requestId', v_request.id, 'status', case when p_approve then 'approved' else 'rejected' end,
        'approvedAmount', case when p_approve then v_amount else null end);
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
        raise exception 'Portfolio adjustments require the authenticated super administrator.';
    end if;
    select role into v_actor_role from public.user_roles where user_id = p_actor_id;
    if v_actor_role <> 'super_admin' then
        raise exception 'Only a super administrator may adjust portfolio cash.';
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

revoke all on function public.create_virtual_balance_request(numeric, text) from public, anon;
grant execute on function public.create_virtual_balance_request(numeric, text) to authenticated;
revoke all on function public.admin_review_virtual_balance_request(uuid, boolean, numeric, text) from public, anon, authenticated;
grant execute on function public.admin_review_virtual_balance_request(uuid, boolean, numeric, text) to authenticated, service_role;

create or replace function public.process_portfolio_action(
    p_user_id uuid,
    p_action text,
    p_symbol text default null,
    p_quantity numeric default 0,
    p_price numeric default 0,
    p_balance numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_portfolio public.user_portfolios%rowtype;
    v_position public.user_positions%rowtype;
    v_next_quantity numeric(18, 6);
    v_next_average numeric(18, 6);
    v_realized_pnl numeric(18, 4) := 0;
    v_total_value numeric(18, 4);
    v_previous_balance numeric(18, 2);
begin
    if auth.uid() is distinct from p_user_id then
        raise exception 'Yetkisiz portföy işlemi.';
    end if;
    if p_action is null or p_action not in ('buy', 'sell', 'cash_adjustment') then
        raise exception 'Geçersiz portföy işlemi.';
    end if;
    if p_action = 'cash_adjustment' and not exists (
        select 1 from public.user_roles where user_id = p_user_id and role = 'super_admin'
    ) then
        raise exception 'Sanal bakiye değişikliği yalnızca super admin yetkisiyle yapılabilir.';
    end if;
    if p_action in ('buy', 'sell') and
       (p_symbol is null or p_symbol !~ '^[A-Z0-9]{3,6}$' or p_quantity is null or p_quantity <= 0 or p_price is null or p_price <= 0) then
        raise exception 'Geçersiz sanal emir.';
    end if;
    if p_action = 'cash_adjustment' and (p_balance is null or p_balance < 0) then
        raise exception 'Bakiye sıfır veya daha büyük olmalıdır.';
    end if;

    insert into public.user_portfolios (user_id, balance) values (p_user_id, 100000)
    on conflict (user_id) do nothing;
    select * into v_portfolio from public.user_portfolios where user_id = p_user_id for update;

    if p_action = 'cash_adjustment' then
        v_previous_balance := v_portfolio.balance;
        update public.user_portfolios set balance = p_balance where id = v_portfolio.id returning * into v_portfolio;
        insert into public.portfolio_transactions (portfolio_id, transaction_type, cash_delta, balance_after)
        values (v_portfolio.id, 'cash_adjustment', p_balance - v_previous_balance, v_portfolio.balance);
    else
        select * into v_position from public.user_positions
        where portfolio_id = v_portfolio.id and symbol = p_symbol for update;
        if p_action = 'buy' then
            if p_quantity * p_price > v_portfolio.balance then
                raise exception 'Sanal bakiyeniz bu emir için yetersiz.';
            end if;
            v_next_quantity := coalesce(v_position.quantity, 0) + p_quantity;
            v_next_average := case when coalesce(v_position.quantity, 0) = 0 then p_price
                else ((v_position.quantity * v_position.average_price) + (p_quantity * p_price)) / v_next_quantity end;
            update public.user_portfolios set balance = balance - (p_quantity * p_price)
            where id = v_portfolio.id returning * into v_portfolio;
            insert into public.user_positions (portfolio_id, symbol, quantity, average_price, current_price, pnl)
            values (v_portfolio.id, p_symbol, v_next_quantity, v_next_average, p_price, 0)
            on conflict (portfolio_id, symbol) do update set
                quantity = excluded.quantity, average_price = excluded.average_price,
                current_price = excluded.current_price, pnl = (excluded.current_price - excluded.average_price) * excluded.quantity;
        else
            if not found or p_quantity > v_position.quantity then
                raise exception 'Satış adedi mevcut pozisyondan fazla olamaz.';
            end if;
            v_realized_pnl := (p_price - v_position.average_price) * p_quantity;
            update public.user_portfolios set balance = balance + (p_quantity * p_price)
            where id = v_portfolio.id returning * into v_portfolio;
            v_next_quantity := v_position.quantity - p_quantity;
            if v_next_quantity = 0 then
                delete from public.user_positions where id = v_position.id;
            else
                update public.user_positions set quantity = v_next_quantity, current_price = p_price,
                    pnl = (p_price - average_price) * v_next_quantity where id = v_position.id;
            end if;
        end if;
        insert into public.portfolio_transactions
            (portfolio_id, symbol, transaction_type, quantity, price, realized_pnl, balance_after)
        values (v_portfolio.id, p_symbol, p_action, p_quantity, p_price, v_realized_pnl, v_portfolio.balance);
    end if;

    select v_portfolio.balance + coalesce(sum(quantity * current_price), 0)
    into v_total_value from public.user_positions where portfolio_id = v_portfolio.id;
    insert into public.portfolio_snapshots (portfolio_id, snapshot_date, cash_balance, total_value)
    values (v_portfolio.id, (timezone('utc', now()))::date, v_portfolio.balance, v_total_value)
    on conflict (portfolio_id, snapshot_date) do update
    set cash_balance = excluded.cash_balance, total_value = excluded.total_value, created_at = now();
    return jsonb_build_object('balance', v_portfolio.balance, 'totalValue', v_total_value);
end;
$$;

drop function if exists public.get_public_leaderboard(text);

create function public.get_public_leaderboard(p_period text default 'all')
returns table (
    user_id uuid,
    display_name text,
    trader_rank text,
    xp bigint,
    pnl_percent numeric,
    pnl_amount numeric
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
            up.leaderboard_gain_visible,
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
        r.total_xp,
        r.return_percent,
        case when r.leaderboard_gain_visible or public.has_admin_role() then r.period_pnl else null::numeric end
    from ranked r
    where r.period_pnl is not null
    order by r.return_percent desc
    limit 50;
end;
$$;

revoke all on function public.get_public_leaderboard(text) from public;
grant execute on function public.get_public_leaderboard(text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
