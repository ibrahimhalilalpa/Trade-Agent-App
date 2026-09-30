begin;

alter table public.portfolio_orders
    add column if not exists expires_at timestamptz;

alter table public.portfolio_orders
    drop constraint if exists portfolio_orders_status_check;
alter table public.portfolio_orders
    add constraint portfolio_orders_status_check
    check (status in ('pending', 'filled', 'cancelled', 'failed', 'expired'));

alter table public.portfolio_order_events
    drop constraint if exists portfolio_order_events_event_type_check;
alter table public.portfolio_order_events
    add constraint portfolio_order_events_event_type_check
    check (event_type in ('created', 'updated', 'filled', 'cancelled', 'failed', 'expired'));

create or replace function public.log_portfolio_order_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_event_type text;
begin
    if current_setting('app.portfolio_order_audit_suppressed', true) = '1' then
        return new;
    end if;
    if tg_op = 'INSERT' then
        v_event_type := 'created';
    elsif old.status is distinct from new.status then
        v_event_type := case new.status
            when 'filled' then 'filled'
            when 'cancelled' then 'cancelled'
            when 'failed' then 'failed'
            when 'expired' then 'expired'
            else null
        end;
    elsif old.quantity is distinct from new.quantity
       or old.trigger_price is distinct from new.trigger_price
       or old.take_profit_price is distinct from new.take_profit_price
       or old.stop_loss_price is distinct from new.stop_loss_price
       or old.expires_at is distinct from new.expires_at then
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
    after insert or update of status, quantity, trigger_price, take_profit_price, stop_loss_price, expires_at
    on public.portfolio_orders
    for each row execute procedure public.log_portfolio_order_event();

create or replace function public.create_portfolio_order_with_expiry(
    p_user_id uuid,
    p_symbol text,
    p_side text,
    p_order_type text,
    p_quantity numeric,
    p_trigger_price numeric default null,
    p_take_profit_price numeric default null,
    p_stop_loss_price numeric default null,
    p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_order_id uuid;
begin
    if coalesce(auth.role(), '') <> 'service_role' and auth.uid() is distinct from p_user_id then
        raise exception 'Yetkisiz portföy emri.';
    end if;
    if p_expires_at is not null
       and (p_expires_at <= now() or p_expires_at > now() + interval '31 days') then
        raise exception 'Emir bitiş zamanı gelecekte ve en fazla 30 gün içinde olmalıdır.';
    end if;

    v_order_id := public.create_portfolio_order(
        p_user_id, p_symbol, p_side, p_order_type, p_quantity,
        p_trigger_price, p_take_profit_price, p_stop_loss_price
    );
    perform set_config('app.portfolio_order_audit_suppressed', '1', true);
    update public.portfolio_orders
    set expires_at = p_expires_at, updated_at = now()
    where id = v_order_id;
    perform set_config('app.portfolio_order_audit_suppressed', '0', true);
    return v_order_id;
end;
$$;

create or replace function public.update_portfolio_order_with_expiry(
    p_user_id uuid,
    p_order_id uuid,
    p_quantity numeric,
    p_trigger_price numeric default null,
    p_take_profit_price numeric default null,
    p_stop_loss_price numeric default null,
    p_expires_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_updated boolean;
    v_order public.portfolio_orders%rowtype;
begin
    if p_expires_at is not null
       and (p_expires_at <= now() or p_expires_at > now() + interval '31 days') then
        raise exception 'Emir bitiş zamanı gelecekte ve en fazla 30 gün içinde olmalıdır.';
    end if;

    perform set_config('app.portfolio_order_audit_suppressed', '1', true);
    v_updated := public.update_portfolio_order(
        p_user_id, p_order_id, p_quantity,
        p_trigger_price, p_take_profit_price, p_stop_loss_price
    );
    perform set_config('app.portfolio_order_audit_suppressed', '0', true);
    if not v_updated then
        return false;
    end if;
    perform set_config('app.portfolio_order_audit_suppressed', '1', true);
    update public.portfolio_orders
    set expires_at = p_expires_at, updated_at = now()
    where id = p_order_id and status = 'pending';
    if not found then
        perform set_config('app.portfolio_order_audit_suppressed', '0', true);
        return false;
    end if;
    perform set_config('app.portfolio_order_audit_suppressed', '0', true);

    select * into v_order from public.portfolio_orders where id = p_order_id;
    insert into public.portfolio_order_events (
        portfolio_id, order_id, symbol, side, order_type, quantity, event_type, price, error
    ) values (
        v_order.portfolio_id, v_order.id, v_order.symbol, v_order.side, v_order.order_type,
        v_order.quantity, 'updated',
        coalesce(v_order.executed_price, v_order.trigger_price, v_order.take_profit_price, v_order.stop_loss_price),
        v_order.error
    );
    return true;
end;
$$;

create or replace function public.expire_portfolio_order(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
    if coalesce(auth.role(), '') <> 'service_role' then
        raise exception 'Yalnızca portföy emir izleyicisi emri süresi doldu olarak işaretleyebilir.';
    end if;
    update public.portfolio_orders
    set status = 'expired', error = null, updated_at = now()
    where id = p_order_id and status = 'pending'
      and expires_at is not null and expires_at <= now();
    return found;
end;
$$;

do $$
begin
    if to_regprocedure('public.execute_portfolio_order_without_expiry(uuid,numeric)') is null then
        alter function public.execute_portfolio_order(uuid, numeric)
            rename to execute_portfolio_order_without_expiry;
    end if;
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
begin
    if coalesce(auth.role(), '') <> 'service_role' then
        raise exception 'Yalnızca portföy emir izleyicisi emir çalıştırabilir.';
    end if;
    select * into v_order from public.portfolio_orders where id = p_order_id for update;
    if not found or v_order.status <> 'pending' then
        return jsonb_build_object('executed', false, 'reason', 'not_pending');
    end if;
    if v_order.expires_at is not null and v_order.expires_at <= now() then
        update public.portfolio_orders
        set status = 'expired', error = null, updated_at = now()
        where id = v_order.id and status = 'pending';
        return jsonb_build_object('executed', false, 'reason', 'expired');
    end if;

    return public.execute_portfolio_order_without_expiry(p_order_id, p_market_price);
end;
$$;

revoke all on function public.create_portfolio_order_with_expiry(uuid, text, text, text, numeric, numeric, numeric, numeric, timestamptz) from public;
revoke all on function public.update_portfolio_order_with_expiry(uuid, uuid, numeric, numeric, numeric, numeric, timestamptz) from public;
revoke all on function public.expire_portfolio_order(uuid) from public;
revoke all on function public.execute_portfolio_order(uuid, numeric) from public;
revoke all on function public.execute_portfolio_order_without_expiry(uuid, numeric) from public;
grant execute on function public.create_portfolio_order_with_expiry(uuid, text, text, text, numeric, numeric, numeric, numeric, timestamptz) to authenticated;
grant execute on function public.update_portfolio_order_with_expiry(uuid, uuid, numeric, numeric, numeric, numeric, timestamptz) to authenticated;
grant execute on function public.expire_portfolio_order(uuid) to service_role;
grant execute on function public.execute_portfolio_order(uuid, numeric) to service_role;
grant execute on function public.execute_portfolio_order_without_expiry(uuid, numeric) to service_role;

notify pgrst, 'reload schema';
commit;
