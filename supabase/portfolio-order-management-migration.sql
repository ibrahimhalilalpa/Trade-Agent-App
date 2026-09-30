begin;

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
    v_position_quantity numeric(18, 6);
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
    if v_order.order_type = 'chain' then
        if p_take_profit_price is null or p_stop_loss_price is null
           or p_take_profit_price <= p_stop_loss_price or p_stop_loss_price <= 0 then
            raise exception 'Zincir emrinde kâr-al fiyatı zarar-durdur fiyatından yüksek olmalıdır.';
        end if;
    elsif p_trigger_price is null or p_trigger_price <= 0 then
        raise exception 'Emir tetik fiyatı sıfırdan büyük olmalıdır.';
    end if;

    if v_order.side = 'sell' then
        select quantity into v_position_quantity
        from public.user_positions
        where portfolio_id = v_order.portfolio_id and symbol = v_order.symbol
        for update;
        if v_position_quantity is null or p_quantity > v_position_quantity then
            raise exception 'Satış emri adedi mevcut pozisyondan fazla olamaz.';
        end if;
    end if;

    update public.portfolio_orders
    set quantity = p_quantity,
        trigger_price = case when v_order.order_type = 'chain' then null else p_trigger_price end,
        take_profit_price = case when v_order.order_type = 'chain' then p_take_profit_price else null end,
        stop_loss_price = case when v_order.order_type = 'chain' then p_stop_loss_price else null end,
        error = null,
        updated_at = now()
    where id = v_order.id and status = 'pending';
    return found;
end;
$$;

revoke all on function public.update_portfolio_order(uuid, uuid, numeric, numeric, numeric, numeric) from public;
grant execute on function public.update_portfolio_order(uuid, uuid, numeric, numeric, numeric, numeric) to authenticated;

notify pgrst, 'reload schema';
commit;
