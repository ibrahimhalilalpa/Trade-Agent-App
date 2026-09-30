begin;

update public.notification_event_templates
set message = '{{symbol}} alarmın {{target_price}} TL hedefi, piyasa fiyatı {{market_price}} TL olduğunda tetiklendi.'
where event_key = 'price_alert_triggered'
  and message = '{{symbol}} alarmın {{market_price}} TL seviyesinde tetiklendi.';

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
            'market_price', replace(trim_scale(coalesce(new.market_price, 0))::text, '.', ','),
            'target_price', replace(trim_scale(new.target_price)::text, '.', ',')
        ));
    end if;
    return new;
end;
$$;

revoke all on function public.notify_price_alert_triggered() from public, anon, authenticated;

commit;
