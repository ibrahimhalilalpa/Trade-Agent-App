begin;

alter table public.price_alerts
    add column if not exists reference_price numeric(18, 6);

create or replace function public.trigger_price_alert(p_alert_id uuid, p_market_price numeric)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_alert public.price_alerts%rowtype;
    v_condition_met boolean;
    v_crossed_target boolean;
    v_repeat_ready boolean;
begin
    if coalesce(auth.role(), '') <> 'service_role' then
        raise exception 'Yalnızca fiyat alarmı izleyicisi alarmı tetikleyebilir.';
    end if;
    if p_market_price is null or p_market_price <= 0 then
        raise exception 'Geçersiz piyasa fiyatı.';
    end if;

    select * into v_alert
    from public.price_alerts
    where id = p_alert_id and status = 'active'
    for update;
    if not found then
        return false;
    end if;

    if v_alert.expires_at is not null and v_alert.expires_at <= now() then
        update public.price_alerts set status = 'expired', updated_at = now() where id = p_alert_id;
        return false;
    end if;

    if v_alert.reference_price is null then
        update public.price_alerts
        set reference_price = p_market_price, updated_at = now()
        where id = p_alert_id;
        return false;
    end if;

    v_condition_met := (v_alert.direction = 'above' and p_market_price >= v_alert.target_price)
        or (v_alert.direction = 'below' and p_market_price <= v_alert.target_price);
    v_crossed_target := (v_alert.direction = 'above'
            and v_alert.reference_price < v_alert.target_price
            and p_market_price >= v_alert.target_price)
        or (v_alert.direction = 'below'
            and v_alert.reference_price > v_alert.target_price
            and p_market_price <= v_alert.target_price);
    v_repeat_ready := v_alert.repeat_interval_minutes > 0
        and v_condition_met
        and (v_alert.last_triggered_at is null
            or v_alert.last_triggered_at + make_interval(mins => v_alert.repeat_interval_minutes) <= now());

    if not v_crossed_target and not v_repeat_ready then
        update public.price_alerts
        set reference_price = p_market_price, updated_at = now()
        where id = p_alert_id;
        return false;
    end if;

    update public.price_alerts
    set status = case when repeat_interval_minutes = 0 then 'triggered' else 'active' end,
        triggered_price = p_market_price,
        triggered_at = coalesce(triggered_at, now()),
        last_triggered_at = now(),
        reference_price = p_market_price,
        updated_at = now()
    where id = p_alert_id;
    return found;
end;
$$;

revoke all on function public.trigger_price_alert(uuid, numeric) from public;
grant execute on function public.trigger_price_alert(uuid, numeric) to service_role;

commit;
