begin;

alter table public.portfolio_transactions
    add column if not exists commission_amount numeric(18, 4) not null default 0,
    add column if not exists slippage_amount numeric(18, 4) not null default 0;

create table if not exists public.bist_trading_calendar (
    trading_date date primary key,
    is_open boolean not null default false,
    open_time time,
    close_time time,
    title text not null default 'BİST seans istisnası',
    message text,
    notification_sent boolean not null default false,
    updated_by uuid references auth.users(id) on delete set null,
    updated_at timestamptz not null default now(),
    constraint bist_trading_calendar_session_check check (
        (is_open and open_time is not null and close_time is not null and close_time > open_time)
        or (not is_open and open_time is null and close_time is null)
    )
);

alter table public.bist_trading_calendar enable row level security;
drop policy if exists "Admins manage BIST trading calendar" on public.bist_trading_calendar;
create policy "Admins manage BIST trading calendar" on public.bist_trading_calendar
    for all using (public.has_admin_role()) with check (public.has_admin_role());
grant select, insert, update, delete on public.bist_trading_calendar to authenticated;
grant all on public.bist_trading_calendar to service_role;

create or replace function public.get_bist_trading_status(p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_date date := (p_at at time zone 'Europe/Istanbul')::date;
    v_time time := (p_at at time zone 'Europe/Istanbul')::time;
    v_open_time time := time '10:00';
    v_close_time time := time '18:00';
    v_is_open_day boolean := extract(isodow from (p_at at time zone 'Europe/Istanbul')) between 1 and 5;
    v_note text;
    v_is_open boolean;
    v_override public.bist_trading_calendar%rowtype;
begin
    select * into v_override
    from public.bist_trading_calendar
    where trading_date = v_date;

    if found then
        v_is_open_day := v_override.is_open;
        v_open_time := v_override.open_time;
        v_close_time := v_override.close_time;
        v_note := coalesce(nullif(v_override.message, ''), v_override.title);
    elsif not v_is_open_day then
        v_note := 'BİST pay piyasası hafta sonu kapalıdır.';
    end if;

    v_is_open := v_is_open_day and v_time >= v_open_time and v_time < v_close_time;
    if v_is_open_day and not v_is_open and v_note is null then
        v_note := 'Sürekli işlem seansı Türkiye saatiyle 10:00–18:00 arasındadır.';
    elsif not v_is_open_day and v_note is null then
        v_note := 'BİST pay piyasası bugün işleme kapalıdır.';
    end if;

    return jsonb_build_object(
        'isOpen', v_is_open,
        'date', to_char(v_date, 'YYYY-MM-DD'),
        'localTime', to_char(v_time, 'HH24:MI'),
        'openTime', case when v_open_time is null then null else to_char(v_open_time, 'HH24:MI') end,
        'closeTime', case when v_close_time is null then null else to_char(v_close_time, 'HH24:MI') end,
        'message', v_note
    );
end;
$$;

create or replace function public.is_bist_trading_open(p_at timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select coalesce((public.get_bist_trading_status(p_at)->>'isOpen')::boolean, false);
$$;

create or replace function public.is_valid_bist_price_tick(p_price numeric)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
    v_tick numeric;
begin
    if p_price is null or p_price <= 0 then
        return false;
    end if;

    v_tick := case
        when p_price < 20 then 0.01
        when p_price < 50 then 0.02
        when p_price < 100 then 0.05
        when p_price < 250 then 0.10
        when p_price < 500 then 0.25
        when p_price < 1000 then 0.50
        else 1.00
    end;
    return mod(p_price, v_tick) = 0;
end;
$$;

create or replace function public.validate_bist_trade()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if new.transaction_type in ('buy', 'sell') then
        if new.quantity is null or new.quantity <= 0 or new.quantity <> trunc(new.quantity) then
            raise exception 'BİST hisse adetleri pozitif tam sayı olmalıdır.';
        end if;
        if not public.is_bist_trading_open(now()) then
            raise exception 'BİST sürekli işlem seansı kapalı. Emirler Türkiye saatiyle 10:00–18:00 arasında gerçekleşir.';
        end if;
        if not public.is_valid_bist_price_tick(new.price) then
            raise exception 'İşlem fiyatı BİST fiyat adımına uygun değil.';
        end if;
        new.commission_amount := 0;
        new.slippage_amount := 0;
    end if;
    return new;
end;
$$;

drop trigger if exists portfolio_transactions_bist_rules on public.portfolio_transactions;
create trigger portfolio_transactions_bist_rules
    before insert on public.portfolio_transactions
    for each row execute function public.validate_bist_trade();

create or replace function public.validate_bist_order_ticks()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if new.quantity is null or new.quantity <= 0 or new.quantity <> trunc(new.quantity) then
        raise exception 'BİST hisse adetleri pozitif tam sayı olmalıdır.';
    end if;
    if new.trigger_price is not null and not public.is_valid_bist_price_tick(new.trigger_price) then
        raise exception 'Tetik fiyatı BİST fiyat adımına uygun değil.';
    end if;
    if new.take_profit_price is not null and not public.is_valid_bist_price_tick(new.take_profit_price) then
        raise exception 'Kâr-al fiyatı BİST fiyat adımına uygun değil.';
    end if;
    if new.stop_loss_price is not null and not public.is_valid_bist_price_tick(new.stop_loss_price) then
        raise exception 'Zarar-durdur fiyatı BİST fiyat adımına uygun değil.';
    end if;
    return new;
end;
$$;

drop trigger if exists portfolio_orders_bist_price_ticks on public.portfolio_orders;
create trigger portfolio_orders_bist_price_ticks
    before insert or update of quantity, trigger_price, take_profit_price, stop_loss_price
    on public.portfolio_orders
    for each row execute function public.validate_bist_order_ticks();

create or replace function public.execute_portfolio_order(p_order_id uuid, p_market_price numeric)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
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
    if not public.is_bist_trading_open(now()) then
        return jsonb_build_object('executed', false, 'reason', 'market_closed');
    end if;
    if not public.is_valid_bist_price_tick(p_market_price) then
        return jsonb_build_object('executed', false, 'reason', 'invalid_price_tick');
    end if;

    return public.execute_portfolio_order_without_expiry(p_order_id, p_market_price);
end;
$$;

create or replace function public.admin_set_bist_trading_day(
    p_trading_date date,
    p_is_open boolean,
    p_open_time time default null,
    p_close_time time default null,
    p_title text default 'BİST seans istisnası',
    p_message text default null,
    p_notify boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
    v_actor uuid := auth.uid();
    v_title text := trim(coalesce(p_title, ''));
    v_message text := trim(coalesce(p_message, ''));
    v_already_notified boolean := false;
begin
    if v_actor is null or not public.has_admin_role() then
        raise exception 'Administrator access required.';
    end if;
    if p_trading_date is null or p_trading_date < (now() at time zone 'Europe/Istanbul')::date then
        raise exception 'Seans tarihi bugün veya gelecekte olmalıdır.';
    end if;
    if p_is_open and (p_open_time is null or p_close_time is null or p_close_time <= p_open_time) then
        raise exception 'Özel işlem günü için geçerli açılış ve kapanış saatleri girin.';
    end if;
    if p_notify and (char_length(v_title) not between 1 and 120 or char_length(v_message) not between 1 and 500) then
        raise exception 'Bildirim başlığı 1-120, mesajı 1-500 karakter olmalıdır.';
    end if;

    select notification_sent into v_already_notified
    from public.bist_trading_calendar
    where trading_date = p_trading_date
    for update;

    insert into public.bist_trading_calendar (
        trading_date, is_open, open_time, close_time, title, message, notification_sent, updated_by, updated_at
    ) values (
        p_trading_date, p_is_open,
        case when p_is_open then p_open_time else null end,
        case when p_is_open then p_close_time else null end,
        coalesce(nullif(v_title, ''), 'BİST seans istisnası'),
        nullif(v_message, ''),
        (p_notify or coalesce(v_already_notified, false)), v_actor, now()
    )
    on conflict (trading_date) do update set
        is_open = excluded.is_open,
        open_time = excluded.open_time,
        close_time = excluded.close_time,
        title = excluded.title,
        message = excluded.message,
        notification_sent = excluded.notification_sent,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

    if p_notify and not coalesce(v_already_notified, false) then
        perform public.admin_publish_announcement(
            v_title,
            v_message,
            'market',
            case when p_is_open then 'info' else 'warning' end,
            now(),
            null,
            'all',
            true
        );
    end if;

    return jsonb_build_object('success', true, 'tradingDate', p_trading_date);
end;
$$;

create or replace function public.admin_delete_bist_trading_day(p_trading_date date)
returns boolean
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
    if auth.uid() is null or not public.has_admin_role() then
        raise exception 'Administrator access required.';
    end if;
    delete from public.bist_trading_calendar where trading_date = p_trading_date;
    return found;
end;
$$;

revoke all on function public.get_bist_trading_status(timestamptz) from public, anon;
revoke all on function public.is_bist_trading_open(timestamptz) from public, anon;
revoke all on function public.is_valid_bist_price_tick(numeric) from public, anon, authenticated;
revoke all on function public.validate_bist_trade() from public, anon, authenticated;
revoke all on function public.validate_bist_order_ticks() from public, anon, authenticated;
revoke all on function public.execute_portfolio_order(uuid, numeric) from public, anon, authenticated;
revoke all on function public.admin_set_bist_trading_day(date, boolean, time, time, text, text, boolean) from public, anon;
revoke all on function public.admin_delete_bist_trading_day(date) from public, anon;
grant execute on function public.get_bist_trading_status(timestamptz) to authenticated, service_role;
grant execute on function public.is_bist_trading_open(timestamptz) to authenticated, service_role;
grant execute on function public.execute_portfolio_order(uuid, numeric) to service_role;
grant execute on function public.admin_set_bist_trading_day(date, boolean, time, time, text, text, boolean) to authenticated;
grant execute on function public.admin_delete_bist_trading_day(date) to authenticated;

notify pgrst, 'reload schema';
commit;
