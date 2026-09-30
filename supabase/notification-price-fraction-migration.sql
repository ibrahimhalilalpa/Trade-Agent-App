begin;

create or replace function public.format_notification_price(p_value numeric)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
    v_value text := replace(trim_scale(coalesce(p_value, 0))::text, '.', ',');
    v_fractional_digits integer;
begin
    if position(',' in v_value) = 0 then
        return v_value || ',00';
    end if;

    v_fractional_digits := length(split_part(v_value, ',', 2));
    if v_fractional_digits < 2 then
        return rpad(v_value, length(v_value) + 2 - v_fractional_digits, '0');
    end if;

    return v_value;
end;
$$;

create or replace function public.notify_portfolio_transaction()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
    v_user_id uuid;
    v_event_key text;
begin
    if new.transaction_type not in ('buy', 'sell') then
        return new;
    end if;
    select user_id into v_user_id from public.user_portfolios where id = new.portfolio_id;
    if v_user_id is not null then
        v_event_key := case new.transaction_type when 'buy' then 'transaction_buy' else 'transaction_sell' end;
        perform public.deliver_event_notification(v_user_id, v_event_key, jsonb_build_object(
            'symbol', coalesce(new.symbol, ''),
            'quantity', trim(to_char(new.quantity, 'FM999999999990D######')),
            'price', public.format_notification_price(new.price)
        ));
    end if;
    return new;
end;
$$;

create or replace function public.notify_price_alert_triggered()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
    if new.event_type = 'triggered' then
        perform public.deliver_event_notification(new.user_id, 'price_alert_triggered', jsonb_build_object(
            'symbol', new.symbol,
            'market_price', public.format_notification_price(new.market_price),
            'target_price', public.format_notification_price(new.target_price)
        ));
    end if;
    return new;
end;
$$;

create or replace function public.notify_portfolio_order_event()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
    v_user_id uuid;
    v_event_key text;
begin
    v_event_key := case new.event_type
        when 'created' then 'order_created'
        when 'filled' then 'order_filled'
        when 'cancelled' then 'order_cancelled'
        when 'failed' then 'order_failed'
        when 'expired' then 'order_expired'
        else null
    end;
    if v_event_key is null then
        return new;
    end if;
    select user_id into v_user_id from public.user_portfolios where id = new.portfolio_id;
    if v_user_id is not null then
        perform public.deliver_event_notification(v_user_id, v_event_key, jsonb_build_object(
            'symbol', new.symbol,
            'side', case new.side when 'buy' then 'alış' else 'satış' end,
            'order_type', new.order_type,
            'quantity', trim(to_char(new.quantity, 'FM999999999990D######')),
            'price', public.format_notification_price(new.price),
            'error', coalesce(new.error, '')
        ));
    end if;
    return new;
end;
$$;

create or replace function public.notify_price_alert_created()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
    if new.event_type = 'created' then
        perform public.deliver_event_notification(new.user_id, 'price_alert_created', jsonb_build_object(
            'symbol', new.symbol,
            'direction', case new.direction when 'above' then 'yukarı' else 'aşağı' end,
            'target_price', public.format_notification_price(new.target_price)
        ));
    end if;
    return new;
end;
$$;

update public.notification_event_templates
set message = '{{symbol}} için {{quantity}} adetlik sanal alış işlemin {{price}} TL birim fiyatla tamamlandı.'
where event_key = 'transaction_buy'
  and message = '{{symbol}} için {{quantity}} adetlik sanal alış işlemin tamamlandı.';

update public.notification_event_templates
set message = '{{symbol}} için {{quantity}} adetlik sanal satış işlemin {{price}} TL birim fiyatla tamamlandı.'
where event_key = 'transaction_sell'
  and message = '{{symbol}} için {{quantity}} adetlik sanal satış işlemin tamamlandı.';

revoke all on function public.format_notification_price(numeric) from public, anon, authenticated;
revoke all on function public.notify_portfolio_transaction() from public, anon, authenticated;
revoke all on function public.notify_price_alert_triggered() from public, anon, authenticated;
revoke all on function public.notify_portfolio_order_event() from public, anon, authenticated;
revoke all on function public.notify_price_alert_created() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
