begin;

alter table public.portfolio_orders
    add column if not exists reserved_cash numeric(18, 4) not null default 0
    check (reserved_cash >= 0);

alter table public.portfolio_order_events
    drop constraint if exists portfolio_order_events_event_type_check;
alter table public.portfolio_order_events
    add constraint portfolio_order_events_event_type_check
    check (event_type in ('created', 'updated', 'filled', 'cancelled', 'failed'));

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
    elsif old.quantity is distinct from new.quantity
       or old.trigger_price is distinct from new.trigger_price
       or old.take_profit_price is distinct from new.take_profit_price
       or old.stop_loss_price is distinct from new.stop_loss_price then
        v_event_type := 'updated';
    end if;

    if v_event_type is not null then
        insert into public.portfolio_order_events (
            portfolio_id, order_id, symbol, side, order_type, quantity, event_type, price, error
        ) values (
            new.portfolio_id, new.id, new.symbol, new.side, new.order_type, new.quantity,
            v_event_type, coalesce(new.executed_price, new.trigger_price, new.take_profit_price, new.stop_loss_price), new.error
        );
    end if;
    return new;
end;
$$;

drop trigger if exists portfolio_orders_audit on public.portfolio_orders;
create trigger portfolio_orders_audit
    after insert or update of status, quantity, trigger_price, take_profit_price, stop_loss_price
    on public.portfolio_orders
    for each row execute procedure public.log_portfolio_order_event();

do $$
begin
    if exists (
        select 1
        from public.portfolio_orders as orders
        join public.user_portfolios as portfolios on portfolios.id = orders.portfolio_id
        where orders.status = 'pending' and orders.side = 'buy'
        group by portfolios.id, portfolios.balance
        having portfolios.balance < sum(ceil(orders.quantity * orders.trigger_price * 10000) / 10000)
    ) then
        raise exception 'Existing pending buy orders exceed portfolio cash. Cancel or update excess orders, then rerun this migration; no orders were changed.';
    end if;

    if exists (
        select 1
        from public.portfolio_orders as orders
        left join public.user_positions as positions
          on positions.portfolio_id = orders.portfolio_id and positions.symbol = orders.symbol
        where orders.status = 'pending' and orders.side = 'sell'
        group by orders.portfolio_id, orders.symbol, positions.quantity
        having sum(orders.quantity) > coalesce(positions.quantity, 0)
    ) then
        raise exception 'Existing pending sell orders exceed available positions. Cancel or update excess orders, then rerun this migration; no orders were changed.';
    end if;

    update public.portfolio_orders
    set reserved_cash = ceil(quantity * trigger_price * 10000) / 10000
    where status = 'pending' and side = 'buy';
end;
$$;

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
    v_position_quantity numeric(18, 6);
    v_reserved_cash numeric(18, 4);
    v_reserved_quantity numeric(18, 6);
    v_order_id uuid;
begin
    if coalesce(auth.role(), '') <> 'service_role' and auth.uid() is distinct from p_user_id then
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

    select * into v_portfolio
    from public.user_portfolios
    where user_id = p_user_id
    for update;
    if not found then
        raise exception 'Sanal portföy bulunamadı.';
    end if;

    if p_side = 'buy' then
        v_reserved_cash := ceil(p_quantity * p_trigger_price * 10000) / 10000;
        if v_portfolio.balance - (
            select coalesce(sum(reserved_cash), 0)
            from public.portfolio_orders
            where portfolio_id = v_portfolio.id and side = 'buy' and status = 'pending'
        ) < v_reserved_cash then
            raise exception 'Limit alış tutarı diğer bekleyen emirler ayrıldıktan sonraki kullanılabilir bakiyeyi aşıyor.';
        end if;
    else
        select quantity into v_position_quantity
        from public.user_positions
        where portfolio_id = v_portfolio.id and symbol = p_symbol
        for update;
        select coalesce(sum(quantity), 0) into v_reserved_quantity
        from public.portfolio_orders
        where portfolio_id = v_portfolio.id and symbol = p_symbol
          and side = 'sell' and status = 'pending';
        if v_position_quantity is null or v_position_quantity - v_reserved_quantity < p_quantity then
            raise exception 'Satış emri adedi, diğer bekleyen satışlar ayrıldıktan sonraki kullanılabilir pozisyonu aşıyor.';
        end if;
        v_reserved_cash := 0;
    end if;

    insert into public.portfolio_orders (
        portfolio_id, symbol, side, order_type, quantity, trigger_price,
        take_profit_price, stop_loss_price, reserved_cash
    ) values (
        v_portfolio.id, p_symbol, p_side, p_order_type, p_quantity, p_trigger_price,
        p_take_profit_price, p_stop_loss_price, v_reserved_cash
    ) returning id into v_order_id;
    return v_order_id;
end;
$$;

create or replace function public.update_portfolio_order(
    p_user_id uuid,
    p_order_id uuid,
    p_quantity numeric,
    p_trigger_price numeric default null,
    p_take_profit_price numeric default null,
    p_stop_loss_price numeric default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_order public.portfolio_orders%rowtype;
    v_portfolio public.user_portfolios%rowtype;
    v_position_quantity numeric(18, 6);
    v_reserved_cash numeric(18, 4);
    v_other_reserved_cash numeric(18, 4);
    v_other_reserved_quantity numeric(18, 6);
begin
    if auth.uid() is distinct from p_user_id then
        raise exception 'Yetkisiz portföy emri güncellemesi.';
    end if;
    if p_quantity is null or p_quantity <= 0 then
        raise exception 'Emir adedi sıfırdan büyük olmalıdır.';
    end if;

    select orders.* into v_order
    from public.portfolio_orders as orders
    join public.user_portfolios as portfolios on portfolios.id = orders.portfolio_id
    where orders.id = p_order_id and portfolios.user_id = p_user_id
    for update of orders;
    if not found or v_order.status <> 'pending' then
        return false;
    end if;
    select * into v_portfolio from public.user_portfolios where id = v_order.portfolio_id for update;

    if v_order.order_type = 'chain' then
        if p_take_profit_price is null or p_stop_loss_price is null
           or p_take_profit_price <= p_stop_loss_price or p_stop_loss_price <= 0 then
            raise exception 'Zincir emrinde kâr-al fiyatı zarar-durdur fiyatından yüksek olmalıdır.';
        end if;
    elsif p_trigger_price is null or p_trigger_price <= 0 then
        raise exception 'Emir tetik fiyatı sıfırdan büyük olmalıdır.';
    end if;

    if v_order.side = 'buy' then
        v_reserved_cash := ceil(p_quantity * p_trigger_price * 10000) / 10000;
        select coalesce(sum(reserved_cash), 0) into v_other_reserved_cash
        from public.portfolio_orders
        where portfolio_id = v_order.portfolio_id and side = 'buy'
          and status = 'pending' and id <> v_order.id;
        if v_portfolio.balance - v_other_reserved_cash < v_reserved_cash then
            raise exception 'Güncellenen emir, diğer bekleyen emirler ayrıldıktan sonraki kullanılabilir bakiyeyi aşıyor.';
        end if;
    else
        select quantity into v_position_quantity
        from public.user_positions
        where portfolio_id = v_order.portfolio_id and symbol = v_order.symbol
        for update;
        select coalesce(sum(quantity), 0) into v_other_reserved_quantity
        from public.portfolio_orders
        where portfolio_id = v_order.portfolio_id and symbol = v_order.symbol
          and side = 'sell' and status = 'pending' and id <> v_order.id;
        if v_position_quantity is null or v_position_quantity - v_other_reserved_quantity < p_quantity then
            raise exception 'Satış emri adedi, diğer bekleyen satışlar ayrıldıktan sonraki kullanılabilir pozisyonu aşıyor.';
        end if;
        v_reserved_cash := 0;
    end if;

    update public.portfolio_orders
    set quantity = p_quantity,
        trigger_price = case when v_order.order_type = 'chain' then null else p_trigger_price end,
        take_profit_price = case when v_order.order_type = 'chain' then p_take_profit_price else null end,
        stop_loss_price = case when v_order.order_type = 'chain' then p_stop_loss_price else null end,
        reserved_cash = v_reserved_cash,
        error = null,
        updated_at = now()
    where id = v_order.id and status = 'pending';
    return found;
end;
$$;

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
    update public.portfolio_orders as orders
    set status = 'cancelled', updated_at = now()
    from public.user_portfolios as portfolios
    where orders.id = p_order_id and orders.portfolio_id = portfolios.id
      and portfolios.user_id = p_user_id and orders.status = 'pending';
    return found;
end;
$$;

create or replace function public.get_portfolio_reserved_cash(p_user_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if auth.uid() is distinct from p_user_id then
        raise exception 'Yetkisiz portföy rezervasyon sorgusu.';
    end if;
    return coalesce((
        select sum(orders.reserved_cash)
        from public.portfolio_orders as orders
        join public.user_portfolios as portfolios on portfolios.id = orders.portfolio_id
        where portfolios.user_id = p_user_id and orders.side = 'buy' and orders.status = 'pending'
    ), 0);
end;
$$;

create or replace function public.enforce_portfolio_cash_reservations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_reserved_cash numeric(18, 4);
begin
    if new.balance < old.balance then
        select coalesce(sum(reserved_cash), 0) into v_reserved_cash
        from public.portfolio_orders
        where portfolio_id = new.id and side = 'buy' and status = 'pending';
        if new.balance < v_reserved_cash then
            raise exception 'İşlem, bekleyen alış emirleri için rezerve edilen nakdi kullanamaz.';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists user_portfolios_cash_reservations on public.user_portfolios;
create trigger user_portfolios_cash_reservations
    before update of balance on public.user_portfolios
    for each row execute procedure public.enforce_portfolio_cash_reservations();

create or replace function public.enforce_portfolio_position_reservations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_reserved_quantity numeric(18, 6);
    v_remaining_quantity numeric(18, 6);
begin
    if tg_op = 'DELETE' then
        v_remaining_quantity := 0;
    else
        if new.quantity >= old.quantity then
            return new;
        end if;
        v_remaining_quantity := new.quantity;
    end if;

    select coalesce(sum(quantity), 0) into v_reserved_quantity
    from public.portfolio_orders
    where portfolio_id = old.portfolio_id and symbol = old.symbol
      and side = 'sell' and status = 'pending';
    if v_remaining_quantity < v_reserved_quantity then
        raise exception 'İşlem, bekleyen satış emirleri için rezerve edilen pozisyon adedini kullanamaz.';
    end if;
    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;

drop trigger if exists user_positions_order_reservations on public.user_positions;
create trigger user_positions_order_reservations
    before update of quantity or delete on public.user_positions
    for each row execute procedure public.enforce_portfolio_position_reservations();

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

        if v_order.side = 'buy' and v_order.quantity * p_market_price > v_order.reserved_cash then
            raise exception 'Emir gerçekleşemedi: gerçekleşme tutarı nakit rezervini aşıyor.';
        end if;
        if v_order.side = 'sell' and (not found or v_order.quantity > v_position.quantity) then
            raise exception 'Emir gerçekleşemedi: satış adedi mevcut pozisyondan fazla.';
        end if;

        update public.portfolio_orders
        set status = 'filled', executed_price = p_market_price, updated_at = now(), error = null
        where id = v_order.id and status = 'pending';
        if not found then
            return jsonb_build_object('executed', false, 'reason', 'not_pending');
        end if;

        if v_order.side = 'buy' then
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

    return jsonb_build_object('executed', true, 'orderId', v_order.id, 'price', p_market_price);
end;
$$;

revoke all on function public.create_portfolio_order(uuid, text, text, text, numeric, numeric, numeric, numeric) from public;
revoke all on function public.update_portfolio_order(uuid, uuid, numeric, numeric, numeric, numeric) from public;
revoke all on function public.cancel_portfolio_order(uuid, uuid) from public;
revoke all on function public.get_portfolio_reserved_cash(uuid) from public;
revoke all on function public.execute_portfolio_order(uuid, numeric) from public;
grant execute on function public.create_portfolio_order(uuid, text, text, text, numeric, numeric, numeric, numeric) to authenticated;
grant execute on function public.update_portfolio_order(uuid, uuid, numeric, numeric, numeric, numeric) to authenticated;
grant execute on function public.cancel_portfolio_order(uuid, uuid) to authenticated;
grant execute on function public.get_portfolio_reserved_cash(uuid) to authenticated;
grant execute on function public.execute_portfolio_order(uuid, numeric) to service_role;

notify pgrst, 'reload schema';
commit;
