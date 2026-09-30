create table if not exists public.portfolio_orders (
    id uuid primary key default gen_random_uuid(),
    portfolio_id uuid not null references public.user_portfolios(id) on delete cascade,
    symbol text not null check (symbol ~ '^[A-Z0-9]{3,6}$'),
    side text not null check (side in ('buy', 'sell')),
    order_type text not null check (order_type in ('limit', 'take_profit', 'stop_loss', 'chain')),
    quantity numeric(18, 6) not null check (quantity > 0),
    trigger_price numeric(18, 6),
    take_profit_price numeric(18, 6),
    stop_loss_price numeric(18, 6),
    status text not null default 'pending' check (status in ('pending', 'filled', 'cancelled', 'failed')),
    executed_price numeric(18, 6),
    error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (
        (order_type = 'limit' and trigger_price is not null and trigger_price > 0) or
        (order_type in ('take_profit', 'stop_loss') and side = 'sell' and trigger_price is not null and trigger_price > 0) or
        (order_type = 'chain' and side = 'sell' and take_profit_price is not null and take_profit_price > 0
            and stop_loss_price is not null and stop_loss_price > 0)
    )
);

create index if not exists portfolio_orders_pending_idx
    on public.portfolio_orders(status, symbol) where status = 'pending';
create index if not exists portfolio_orders_portfolio_created_idx
    on public.portfolio_orders(portfolio_id, created_at desc);

alter table public.portfolio_orders enable row level security;
drop policy if exists "Users read their own portfolio orders" on public.portfolio_orders;
create policy "Users read their own portfolio orders" on public.portfolio_orders
    for select using (exists (
        select 1 from public.user_portfolios
        where id = portfolio_id and user_id = auth.uid()
    ));

grant select on public.portfolio_orders to authenticated;
grant usage on schema public to service_role;
grant select on public.portfolio_orders to service_role;

create table if not exists public.portfolio_order_events (
    id uuid primary key default gen_random_uuid(),
    portfolio_id uuid not null references public.user_portfolios(id) on delete cascade,
    order_id uuid not null references public.portfolio_orders(id) on delete cascade,
    symbol text not null,
    side text not null,
    order_type text not null,
    quantity numeric(18, 6) not null,
    event_type text not null check (event_type in ('created', 'filled', 'cancelled', 'failed')),
    price numeric(18, 6),
    error text,
    created_at timestamptz not null default now()
);

alter table public.portfolio_order_events add column if not exists error text;
update public.portfolio_order_events as events
set error = orders.error
from public.portfolio_orders as orders
where events.order_id = orders.id and events.event_type = 'failed' and events.error is null;

create index if not exists portfolio_order_events_portfolio_created_idx
    on public.portfolio_order_events(portfolio_id, created_at desc);
alter table public.portfolio_order_events enable row level security;
drop policy if exists "Users read their own portfolio order events" on public.portfolio_order_events;
create policy "Users read their own portfolio order events" on public.portfolio_order_events
    for select using (exists (
        select 1 from public.user_portfolios
        where id = portfolio_id and user_id = auth.uid()
    ));
grant select on public.portfolio_order_events to authenticated;
grant select, insert on public.portfolio_order_events to service_role;

create or replace function public.log_portfolio_order_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_event_type text;
begin
    if tg_op = 'INSERT' then
        v_event_type := 'created';
    elsif old.status is distinct from new.status then
        v_event_type := case new.status
            when 'filled' then 'filled'
            when 'cancelled' then 'cancelled'
            when 'failed' then 'failed'
            else null
        end;
    end if;

    if v_event_type is not null then
        insert into public.portfolio_order_events (
            portfolio_id, order_id, symbol, side, order_type, quantity, event_type, price, error
        ) values (
            new.portfolio_id, new.id, new.symbol, new.side, new.order_type, new.quantity,
            v_event_type, coalesce(new.executed_price, new.trigger_price, new.take_profit_price, new.stop_loss_price), new.error
        );
    end if;
    if tg_op = 'INSERT' and new.status in ('filled', 'cancelled', 'failed') then
        insert into public.portfolio_order_events (
            portfolio_id, order_id, symbol, side, order_type, quantity, event_type, price, error
        ) values (
            new.portfolio_id, new.id, new.symbol, new.side, new.order_type, new.quantity,
            new.status, coalesce(new.executed_price, new.trigger_price, new.take_profit_price, new.stop_loss_price), new.error
        );
    end if;
    return new;
end;
$$;

drop trigger if exists portfolio_orders_audit on public.portfolio_orders;
create trigger portfolio_orders_audit
    after insert or update of status on public.portfolio_orders
    for each row execute procedure public.log_portfolio_order_event();

create table if not exists public.price_alerts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    symbol text not null check (symbol ~ '^[A-Z0-9]{3,6}$'),
    direction text not null check (direction in ('above', 'below')),
    target_price numeric(18, 6) not null check (target_price > 0),
    status text not null default 'active' check (status in ('active', 'triggered', 'cancelled')),
    triggered_price numeric(18, 6),
    created_at timestamptz not null default now(),
    triggered_at timestamptz,
    updated_at timestamptz not null default now()
);

create index if not exists price_alerts_active_symbol_idx
    on public.price_alerts(symbol) where status = 'active';
create index if not exists price_alerts_user_symbol_created_idx
    on public.price_alerts(user_id, symbol, created_at desc);
alter table public.price_alerts enable row level security;
drop policy if exists "Users manage their own price alerts" on public.price_alerts;
create policy "Users manage their own price alerts" on public.price_alerts
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update on public.price_alerts to authenticated;
grant select, update on public.price_alerts to service_role;

create table if not exists public.price_alert_events (
    id uuid primary key default gen_random_uuid(),
    alert_id uuid not null references public.price_alerts(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    symbol text not null,
    direction text not null check (direction in ('above', 'below')),
    event_type text not null check (event_type in ('created', 'price_changed', 'triggered', 'cancelled')),
    target_price numeric(18, 6) not null,
    market_price numeric(18, 6),
    created_at timestamptz not null default now()
);

alter table public.price_alert_events add column if not exists direction text;
update public.price_alert_events as events set direction = alerts.direction
from public.price_alerts as alerts
where events.alert_id = alerts.id and events.direction is null;
alter table public.price_alert_events alter column direction set not null;
alter table public.price_alert_events drop constraint if exists price_alert_events_direction_check;
alter table public.price_alert_events add constraint price_alert_events_direction_check
    check (direction in ('above', 'below'));

create index if not exists price_alert_events_user_symbol_created_idx
    on public.price_alert_events(user_id, symbol, created_at desc);
alter table public.price_alert_events enable row level security;
drop policy if exists "Users read their own price alert events" on public.price_alert_events;
create policy "Users read their own price alert events" on public.price_alert_events
    for select using (auth.uid() = user_id);
grant select on public.price_alert_events to authenticated;
grant select, insert on public.price_alert_events to service_role;

create or replace function public.log_price_alert_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_event_type text;
begin
    if tg_op = 'INSERT' then
        v_event_type := 'created';
    elsif old.target_price is distinct from new.target_price then
        v_event_type := 'price_changed';
    elsif old.status is distinct from new.status and new.status in ('triggered', 'cancelled') then
        v_event_type := new.status;
    end if;

    if v_event_type is not null then
        insert into public.price_alert_events (alert_id, user_id, symbol, direction, event_type, target_price, market_price)
        values (new.id, new.user_id, new.symbol, new.direction, v_event_type, new.target_price, new.triggered_price);
    end if;
    return new;
end;
$$;

drop trigger if exists price_alerts_audit on public.price_alerts;
create trigger price_alerts_audit
    after insert or update of target_price, status on public.price_alerts
    for each row execute procedure public.log_price_alert_event();

create or replace function public.trigger_price_alert(p_alert_id uuid, p_market_price numeric)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
    if coalesce(auth.role(), '') <> 'service_role' then
        raise exception 'Yalnızca fiyat alarmı izleyicisi alarmı tetikleyebilir.';
    end if;
    if p_market_price is null or p_market_price <= 0 then
        raise exception 'Geçersiz piyasa fiyatı.';
    end if;

    update public.price_alerts
    set status = 'triggered', triggered_price = p_market_price, triggered_at = now(), updated_at = now()
    where id = p_alert_id and status = 'active'
      and ((direction = 'above' and p_market_price >= target_price)
           or (direction = 'below' and p_market_price <= target_price));
    return found;
end;
$$;

revoke all on function public.trigger_price_alert(uuid, numeric) from public;
grant execute on function public.trigger_price_alert(uuid, numeric) to service_role;

create or replace function public.create_portfolio_order(
    p_user_id uuid,
    p_symbol text,
    p_side text,
    p_order_type text,
    p_quantity numeric,
    p_trigger_price numeric default null,
    p_take_profit_price numeric default null,
    p_stop_loss_price numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_portfolio public.user_portfolios%rowtype;
    v_position public.user_positions%rowtype;
    v_order_id uuid;
begin
    if auth.uid() is distinct from p_user_id then
        raise exception 'Yetkisiz portföy emri.';
    end if;
    if p_symbol is null or p_symbol !~ '^[A-Z0-9]{3,6}$'
       or p_side is null or p_side not in ('buy', 'sell')
       or p_order_type is null or p_order_type not in ('limit', 'take_profit', 'stop_loss', 'chain')
       or p_quantity is null or p_quantity <= 0 then
        raise exception 'Geçersiz portföy emri.';
    end if;
    if p_order_type = 'limit' and (p_trigger_price is null or p_trigger_price <= 0) then
        raise exception 'Limit fiyatı sıfırdan büyük olmalıdır.';
    elsif p_order_type in ('take_profit', 'stop_loss')
       and (p_side <> 'sell' or p_trigger_price is null or p_trigger_price <= 0) then
        raise exception 'Kâr-al ve zarar-durdur emirleri geçerli satış tetik fiyatı gerektirir.';
    elsif p_order_type = 'chain'
       and (p_side <> 'sell' or p_take_profit_price is null or p_take_profit_price <= 0
            or p_stop_loss_price is null or p_stop_loss_price <= 0
            or p_take_profit_price <= p_stop_loss_price) then
        raise exception 'Zincir emir için kâr-al fiyatı zarar-durdur fiyatından yüksek olmalıdır.';
    end if;

    select * into v_portfolio from public.user_portfolios
    where user_id = p_user_id for update;
    if not found then
        raise exception 'Sanal portföy bulunamadı.';
    end if;
    if p_side = 'buy' and p_order_type = 'limit' and p_quantity * p_trigger_price > v_portfolio.balance then
        raise exception 'Limit alış tutarı kullanılabilir sanal bakiyeyi aşıyor.';
    elsif p_side = 'sell' then
        select * into v_position from public.user_positions
        where portfolio_id = v_portfolio.id and symbol = p_symbol for update;
        if not found or v_position.quantity < p_quantity then
            raise exception 'Satış adedi mevcut pozisyondan fazla olamaz.';
        end if;
    end if;

    insert into public.portfolio_orders (
        portfolio_id, symbol, side, order_type, quantity, trigger_price,
        take_profit_price, stop_loss_price
    ) values (
        v_portfolio.id, p_symbol, p_side, p_order_type, p_quantity, p_trigger_price,
        p_take_profit_price, p_stop_loss_price
    ) returning id into v_order_id;
    return v_order_id;
end;
$$;

create or replace function public.execute_immediate_limit_order(
    p_user_id uuid,
    p_symbol text,
    p_side text,
    p_quantity numeric,
    p_trigger_price numeric,
    p_market_price numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_portfolio_id uuid;
    v_order_id uuid;
begin
    if coalesce(auth.role(), '') <> 'service_role' and auth.uid() is distinct from p_user_id then
        raise exception 'Yetkisiz portföy emri.';
    end if;
    if p_symbol is null or p_symbol !~ '^[A-Z0-9]{3,6}$'
       or p_side is null or p_side not in ('buy', 'sell') or p_quantity is null or p_quantity <= 0
       or p_trigger_price is null or p_trigger_price <= 0
       or p_market_price is null or p_market_price <= 0
       or (p_side = 'buy' and p_market_price > p_trigger_price)
       or (p_side = 'sell' and p_market_price < p_trigger_price) then
        raise exception 'Limit emri için geçerli ve tetiklenmiş fiyat gereklidir.';
    end if;

    select id into v_portfolio_id
    from public.user_portfolios where user_id = p_user_id for update;
    if v_portfolio_id is null then
        raise exception 'Sanal portföy bulunamadı.';
    end if;

    perform public.process_portfolio_action(
        p_user_id, p_side, p_symbol, p_quantity, p_market_price, null
    );
    insert into public.portfolio_orders (
        portfolio_id, symbol, side, order_type, quantity, trigger_price,
        status, executed_price, updated_at
    ) values (
        v_portfolio_id, p_symbol, p_side, 'limit', p_quantity, p_trigger_price,
        'filled', p_market_price, now()
    ) returning id into v_order_id;
    return v_order_id;
end;
$$;

revoke all on function public.execute_immediate_limit_order(uuid, text, text, numeric, numeric, numeric) from public;
grant execute on function public.execute_immediate_limit_order(uuid, text, text, numeric, numeric, numeric) to authenticated;

create or replace function public.cancel_portfolio_order(p_user_id uuid, p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
    if coalesce(auth.role(), '') <> 'service_role' and auth.uid() is distinct from p_user_id then
        raise exception 'Yetkisiz portföy emri.';
    end if;
    update public.portfolio_orders as orders set status = 'cancelled', updated_at = now()
    from public.user_portfolios as portfolios
    where orders.id = p_order_id and orders.portfolio_id = portfolios.id
      and portfolios.user_id = p_user_id and orders.status = 'pending';
    return found;
end;
$$;

create or replace function public.get_portfolio_realized_pnl(p_user_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_total numeric;
begin
    if auth.uid() is distinct from p_user_id then
        raise exception 'Yetkisiz portföy sorgusu.';
    end if;
    select coalesce(sum(transactions.realized_pnl), 0) into v_total
    from public.portfolio_transactions as transactions
    join public.user_portfolios as portfolios on portfolios.id = transactions.portfolio_id
    where portfolios.user_id = p_user_id and transactions.transaction_type = 'sell';
    return v_total;
end;
$$;

create or replace function public.get_portfolio_period_pnl(
    p_user_id uuid,
    p_current_value numeric,
    p_period text
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_portfolio_id uuid;
    v_baseline_value numeric;
    v_baseline_at timestamptz;
    v_cutoff_date date;
    v_cash_adjustments numeric := 0;
begin
    if auth.uid() is distinct from p_user_id then
        raise exception 'Yetkisiz portföy sorgusu.';
    end if;
    if p_current_value is null or p_current_value < 0
       or p_period is null or p_period not in ('day', 'week', 'month', 'all') then
        raise exception 'Geçersiz portföy performans aralığı.';
    end if;

    select id into v_portfolio_id from public.user_portfolios where user_id = p_user_id;
    if v_portfolio_id is null then
        raise exception 'Sanal portföy bulunamadı.';
    end if;

    if p_period = 'all' then
        select coalesce(sum(cash_delta), 0) into v_cash_adjustments
        from public.portfolio_transactions
        where portfolio_id = v_portfolio_id and transaction_type = 'cash_adjustment';
        return p_current_value - 100000 - v_cash_adjustments;
    end if;

    v_cutoff_date := case p_period
        when 'day' then (now() at time zone 'UTC')::date
        when 'week' then (now() at time zone 'UTC')::date - 7
        else (now() at time zone 'UTC')::date - 30
    end;

    select total_value, created_at into v_baseline_value, v_baseline_at
    from public.portfolio_snapshots
    where portfolio_id = v_portfolio_id
      and ((p_period = 'day' and snapshot_date < v_cutoff_date)
           or (p_period <> 'day' and snapshot_date <= v_cutoff_date))
    order by snapshot_date desc
    limit 1;

    if v_baseline_value is null then
        return null;
    end if;

    select coalesce(sum(cash_delta), 0) into v_cash_adjustments
    from public.portfolio_transactions
    where portfolio_id = v_portfolio_id
      and transaction_type = 'cash_adjustment'
      and created_at > v_baseline_at;

    return p_current_value - v_baseline_value - v_cash_adjustments;
end;
$$;

create or replace function public.reset_portfolio(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_portfolio_id uuid;
begin
    if auth.uid() is distinct from p_user_id then
        raise exception 'Yetkisiz portföy sıfırlama işlemi.';
    end if;
    select id into v_portfolio_id from public.user_portfolios where user_id = p_user_id;
    if v_portfolio_id is null then
        raise exception 'Sanal portföy bulunamadı.';
    end if;

    perform id from public.portfolio_orders
    where portfolio_id = v_portfolio_id order by id for update;
    perform id from public.user_portfolios
    where id = v_portfolio_id for update;

    delete from public.portfolio_orders where portfolio_id = v_portfolio_id;
    delete from public.user_positions where portfolio_id = v_portfolio_id;
    delete from public.portfolio_transactions where portfolio_id = v_portfolio_id;
    delete from public.portfolio_snapshots where portfolio_id = v_portfolio_id;
    update public.user_portfolios set balance = 100000, updated_at = now()
    where id = v_portfolio_id;
    return true;
end;
$$;

create or replace function public.execute_portfolio_order(p_order_id uuid, p_market_price numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_order public.portfolio_orders%rowtype;
    v_portfolio public.user_portfolios%rowtype;
    v_position public.user_positions%rowtype;
    v_quantity numeric(18, 6);
    v_average_price numeric(18, 6);
    v_realized_pnl numeric(18, 4) := 0;
    v_total_value numeric(18, 4);
    v_triggered boolean := false;
begin
    if coalesce(auth.role(), '') <> 'service_role' then
        raise exception 'Yalnızca portföy emir izleyicisi emir çalıştırabilir.';
    end if;
    if p_market_price is null or p_market_price <= 0 then
        raise exception 'Geçersiz piyasa fiyatı.';
    end if;
    select * into v_order from public.portfolio_orders where id = p_order_id for update;
    if not found or v_order.status <> 'pending' then
        return jsonb_build_object('executed', false, 'reason', 'not_pending');
    end if;

    v_triggered := case v_order.order_type
        when 'limit' then case v_order.side
            when 'buy' then p_market_price <= v_order.trigger_price
            else p_market_price >= v_order.trigger_price
        end
        when 'take_profit' then p_market_price >= v_order.trigger_price
        when 'stop_loss' then p_market_price <= v_order.trigger_price
        when 'chain' then p_market_price >= v_order.take_profit_price or p_market_price <= v_order.stop_loss_price
        else false
    end;
    if not v_triggered then
        return jsonb_build_object('executed', false, 'reason', 'price_not_triggered');
    end if;

    begin
        select * into v_portfolio from public.user_portfolios
        where id = v_order.portfolio_id for update;
        select * into v_position from public.user_positions
        where portfolio_id = v_order.portfolio_id and symbol = v_order.symbol for update;

        if v_order.side = 'buy' then
            if v_order.quantity * p_market_price > v_portfolio.balance then
                raise exception 'Emir gerçekleşemedi: sanal bakiye yetersiz.';
            end if;
            v_quantity := coalesce(v_position.quantity, 0) + v_order.quantity;
            v_average_price := case when coalesce(v_position.quantity, 0) = 0 then p_market_price
                else ((v_position.quantity * v_position.average_price) + (v_order.quantity * p_market_price)) / v_quantity end;
            update public.user_portfolios set balance = balance - (v_order.quantity * p_market_price)
            where id = v_portfolio.id returning * into v_portfolio;
            insert into public.user_positions (portfolio_id, symbol, quantity, average_price, current_price, pnl)
            values (v_portfolio.id, v_order.symbol, v_quantity, v_average_price, p_market_price, 0)
            on conflict (portfolio_id, symbol) do update set quantity = excluded.quantity,
                average_price = excluded.average_price, current_price = excluded.current_price,
                pnl = (excluded.current_price - excluded.average_price) * excluded.quantity;
        else
            if not found or v_order.quantity > v_position.quantity then
                raise exception 'Emir gerçekleşemedi: satış adedi mevcut pozisyondan fazla.';
            end if;
            v_realized_pnl := (p_market_price - v_position.average_price) * v_order.quantity;
            update public.user_portfolios set balance = balance + (v_order.quantity * p_market_price)
            where id = v_portfolio.id returning * into v_portfolio;
            v_quantity := v_position.quantity - v_order.quantity;
            if v_quantity = 0 then
                delete from public.user_positions where id = v_position.id;
            else
                update public.user_positions set quantity = v_quantity, current_price = p_market_price,
                    pnl = (p_market_price - average_price) * v_quantity where id = v_position.id;
            end if;
        end if;

        insert into public.portfolio_transactions
            (portfolio_id, symbol, transaction_type, quantity, price, realized_pnl, balance_after)
        values (v_order.portfolio_id, v_order.symbol, v_order.side, v_order.quantity, p_market_price, v_realized_pnl, v_portfolio.balance);

        select v_portfolio.balance + coalesce(sum(quantity * current_price), 0) into v_total_value
        from public.user_positions where portfolio_id = v_order.portfolio_id;
        insert into public.portfolio_snapshots (portfolio_id, snapshot_date, cash_balance, total_value)
        values (v_order.portfolio_id, (timezone('utc', now()))::date, v_portfolio.balance, v_total_value)
        on conflict (portfolio_id, snapshot_date) do update set cash_balance = excluded.cash_balance,
            total_value = excluded.total_value, created_at = now();
    exception when others then
        update public.portfolio_orders set status = 'failed', error = left(sqlerrm, 180), updated_at = now()
        where id = v_order.id;
        return jsonb_build_object('executed', false, 'reason', 'execution_failed', 'error', left(sqlerrm, 180));
    end;

    update public.portfolio_orders
    set status = 'filled', executed_price = p_market_price, updated_at = now(), error = null
    where id = v_order.id;
    return jsonb_build_object('executed', true, 'orderId', v_order.id, 'price', p_market_price);
end;
$$;

revoke all on function public.create_portfolio_order(uuid, text, text, text, numeric, numeric, numeric, numeric) from public;
revoke all on function public.cancel_portfolio_order(uuid, uuid) from public;
revoke all on function public.get_portfolio_realized_pnl(uuid) from public;
revoke all on function public.get_portfolio_period_pnl(uuid, numeric, text) from public;
revoke all on function public.reset_portfolio(uuid) from public;
revoke all on function public.execute_portfolio_order(uuid, numeric) from public;
grant execute on function public.create_portfolio_order(uuid, text, text, text, numeric, numeric, numeric, numeric) to authenticated;
grant execute on function public.cancel_portfolio_order(uuid, uuid) to authenticated;
grant execute on function public.get_portfolio_realized_pnl(uuid) to authenticated;
grant execute on function public.get_portfolio_period_pnl(uuid, numeric, text) to authenticated;
grant execute on function public.reset_portfolio(uuid) to authenticated;
grant execute on function public.execute_portfolio_order(uuid, numeric) to service_role;

notify pgrst, 'reload schema';
