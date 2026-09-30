begin;

alter table public.price_alerts
    add column if not exists repeat_interval_minutes integer not null default 0,
    add column if not exists last_triggered_at timestamptz,
    add column if not exists expires_at timestamptz;

alter table public.price_alerts
    drop constraint if exists price_alerts_status_check;
alter table public.price_alerts
    add constraint price_alerts_status_check
    check (status in ('active', 'triggered', 'cancelled', 'expired'));

alter table public.price_alerts
    drop constraint if exists price_alerts_repeat_interval_minutes_check;
alter table public.price_alerts
    add constraint price_alerts_repeat_interval_minutes_check
    check (repeat_interval_minutes in (0, 5, 15, 30, 60));

create index if not exists price_alerts_expiration_idx
    on public.price_alerts(expires_at) where status = 'active' and expires_at is not null;

alter table public.price_alert_events
    drop constraint if exists price_alert_events_event_type_check;
alter table public.price_alert_events
    add constraint price_alert_events_event_type_check
    check (event_type in ('created', 'price_changed', 'triggered', 'cancelled', 'expired'));

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
    elsif old.status is distinct from new.status and new.status in ('triggered', 'cancelled', 'expired') then
        v_event_type := new.status;
    elsif old.last_triggered_at is distinct from new.last_triggered_at then
        v_event_type := 'triggered';
    elsif old.target_price is distinct from new.target_price
       or old.direction is distinct from new.direction then
        v_event_type := 'price_changed';
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
    after insert or update of target_price, direction, status, last_triggered_at on public.price_alerts
    for each row execute procedure public.log_price_alert_event();

with ranked_active_alerts as (
    select id,
           row_number() over (
               partition by user_id, symbol, round(target_price, 2)
               order by created_at, id
           ) as alert_rank
    from public.price_alerts
    where status = 'active'
)
update public.price_alerts as alerts
set status = 'cancelled', updated_at = now()
from ranked_active_alerts
where alerts.id = ranked_active_alerts.id
  and ranked_active_alerts.alert_rank > 1;

create unique index if not exists price_alerts_active_price_unique_idx
    on public.price_alerts(user_id, symbol, (round(target_price, 2)))
    where status = 'active';

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
    set status = 'expired', updated_at = now()
    where id = p_alert_id and status = 'active' and expires_at is not null and expires_at <= now();
    if found then
        return false;
    end if;

    update public.price_alerts
    set status = case when repeat_interval_minutes = 0 then 'triggered' else 'active' end,
        triggered_price = p_market_price,
        triggered_at = coalesce(triggered_at, now()),
        last_triggered_at = now(),
        updated_at = now()
    where id = p_alert_id
      and status = 'active'
      and (expires_at is null or expires_at > now())
      and (last_triggered_at is null
           or repeat_interval_minutes = 0
           or last_triggered_at + make_interval(mins => repeat_interval_minutes) <= now())
      and ((direction = 'above' and p_market_price >= target_price)
           or (direction = 'below' and p_market_price <= target_price));
    return found;
end;
$$;

revoke all on function public.trigger_price_alert(uuid, numeric) from public;
grant execute on function public.trigger_price_alert(uuid, numeric) to service_role;

commit;
