begin;

alter table public.system_announcements
    add column if not exists category text not null default 'system',
    add column if not exists audience_role text not null default 'all';

alter table public.system_announcements
    drop constraint if exists system_announcements_category_check,
    add constraint system_announcements_category_check
        check (category in ('announcement', 'market', 'portfolio', 'academy', 'system')),
    drop constraint if exists system_announcements_audience_role_check,
    add constraint system_announcements_audience_role_check
        check (audience_role in ('all', 'user', 'pro_trader', 'analyst', 'admin', 'super_admin')),
    drop constraint if exists system_announcements_severity_check,
    add constraint system_announcements_severity_check
        check (severity in ('info', 'success', 'warning', 'critical'));

create table if not exists public.user_notifications (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    announcement_id uuid references public.system_announcements(id) on delete cascade,
    category text not null check (category in ('announcement', 'market', 'portfolio', 'academy', 'system')),
    severity text not null default 'info' check (severity in ('info', 'success', 'warning', 'critical')),
    title text not null check (char_length(title) between 1 and 120),
    message text not null check (char_length(message) between 1 and 500),
    created_at timestamptz not null default now(),
    read_at timestamptz
);

create table if not exists public.notification_event_templates (
    event_key text primary key check (event_key ~ '^[a-z][a-z0-9_]{1,79}$'),
    title text not null check (char_length(title) between 1 and 120),
    message text not null check (char_length(message) between 1 and 500),
    category text not null check (category in ('announcement', 'market', 'portfolio', 'academy', 'system')),
    severity text not null default 'info' check (severity in ('info', 'success', 'warning', 'critical')),
    active boolean not null default true,
    updated_at timestamptz not null default now(),
    updated_by uuid references auth.users(id) on delete set null
);

alter table public.notification_event_templates
    drop constraint if exists notification_event_templates_event_key_check,
    add constraint notification_event_templates_event_key_check
        check (event_key ~ '^[a-z][a-z0-9_]{1,79}$');

alter table public.notification_event_templates enable row level security;
grant all on public.notification_event_templates to service_role;
drop policy if exists "Admins manage notification event templates" on public.notification_event_templates;
create policy "Admins manage notification event templates" on public.notification_event_templates
    for all using (public.has_admin_role()) with check (public.has_admin_role());

insert into public.notification_event_templates (event_key, title, message, category, severity) values
    ('user_registered', 'Trade Agent''a hoş geldin', 'Hesabın oluşturuldu. Piyasa ekranını keşfet ve ilk izleme listeni hazırla.', 'system', 'success'),
    ('transaction_buy', 'Alış işlemi gerçekleşti', '{{symbol}} için {{quantity}} adetlik sanal alış işlemin tamamlandı.', 'portfolio', 'info'),
    ('transaction_sell', 'Satış işlemi gerçekleşti', '{{symbol}} için {{quantity}} adetlik sanal satış işlemin tamamlandı.', 'portfolio', 'info'),
    ('lesson_completed', 'Ders tamamlandı', '{{lesson_id}} akademi dersini tamamladın. Öğrenmeye devam et!', 'academy', 'success'),
    ('price_alert_triggered', 'Fiyat alarmın tetiklendi', '{{symbol}} alarmın {{target_price}} TL hedefi, piyasa fiyatı {{market_price}} TL olduğunda tetiklendi.', 'market', 'warning'),
    ('price_alert_created', 'Fiyat alarmı oluşturuldu', '{{symbol}} için {{direction}} alarmı {{target_price}} TL seviyesinde kuruldu.', 'market', 'info'),
    ('order_created', 'Emrin oluşturuldu', '{{symbol}} için {{side}} emrin oluşturuldu. Emir türü: {{order_type}}.', 'portfolio', 'info'),
    ('order_filled', 'Emrin gerçekleşti', '{{symbol}} için {{quantity}} adetlik {{side}} emrin {{price}} TL seviyesinde gerçekleşti.', 'portfolio', 'success'),
    ('order_cancelled', 'Emrin iptal edildi', '{{symbol}} için {{side}} emrin iptal edildi.', 'portfolio', 'warning'),
    ('order_failed', 'Emir gerçekleştirilemedi', '{{symbol}} için {{side}} emrin tamamlanamadı. {{error}}', 'portfolio', 'critical'),
    ('order_expired', 'Emrinin süresi doldu', '{{symbol}} için bekleyen {{side}} emrinin süresi doldu.', 'portfolio', 'warning')
on conflict (event_key) do nothing;

create or replace function public.deliver_event_notification(
    p_user_id uuid,
    p_event_key text,
    p_values jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
    v_template public.notification_event_templates%rowtype;
    v_title text;
    v_message text;
    v_key text;
    v_value text;
begin
    select * into v_template
    from public.notification_event_templates
    where event_key = p_event_key and active;
    if not found then
        return;
    end if;
    v_title := v_template.title;
    v_message := v_template.message;
    for v_key, v_value in select key, value #>> '{}' from jsonb_each(coalesce(p_values, '{}'::jsonb))
    loop
        v_title := replace(v_title, '{{' || v_key || '}}', coalesce(v_value, ''));
        v_message := replace(v_message, '{{' || v_key || '}}', coalesce(v_value, ''));
    end loop;
    insert into public.user_notifications (user_id, category, severity, title, message)
    values (p_user_id, v_template.category, v_template.severity, v_title, v_message);
end;
$$;

create or replace function public.notify_user_registered()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
    perform public.deliver_event_notification(new.id, 'user_registered');
    return new;
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
            'price', trim(to_char(new.price, 'FM999999999990D######'))
        ));
    end if;
    return new;
end;
$$;

create or replace function public.notify_lesson_completed()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
    if new.completed and (
        tg_op = 'INSERT'
        or (tg_op = 'UPDATE' and not old.completed)
    ) then
        perform public.deliver_event_notification(new.user_id, 'lesson_completed', jsonb_build_object('lesson_id', new.lesson_id));
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
            'market_price', replace(trim_scale(coalesce(new.market_price, 0))::text, '.', ','),
            'target_price', replace(trim_scale(new.target_price)::text, '.', ',')
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
            'price', trim(to_char(coalesce(new.price, 0), 'FM999999999990D######')),
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
            'target_price', trim(to_char(new.target_price, 'FM999999999990D######'))
        ));
    end if;
    return new;
end;
$$;

drop trigger if exists auth_user_registered_notification on auth.users;
create trigger auth_user_registered_notification after insert on auth.users
    for each row execute function public.notify_user_registered();
drop trigger if exists portfolio_transaction_notification on public.portfolio_transactions;
create trigger portfolio_transaction_notification after insert on public.portfolio_transactions
    for each row execute function public.notify_portfolio_transaction();
drop trigger if exists education_lesson_completed_notification on public.user_education_progress;
create trigger education_lesson_completed_notification after insert or update of completed on public.user_education_progress
    for each row execute function public.notify_lesson_completed();
drop trigger if exists price_alert_triggered_notification on public.price_alert_events;
create trigger price_alert_triggered_notification after insert on public.price_alert_events
    for each row execute function public.notify_price_alert_triggered();
drop trigger if exists portfolio_order_event_notification on public.portfolio_order_events;
create trigger portfolio_order_event_notification after insert on public.portfolio_order_events
    for each row execute function public.notify_portfolio_order_event();
drop trigger if exists price_alert_created_notification on public.price_alert_events;
create trigger price_alert_created_notification after insert on public.price_alert_events
    for each row execute function public.notify_price_alert_created();

revoke all on function public.deliver_event_notification(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.notify_user_registered() from public, anon, authenticated;
revoke all on function public.notify_portfolio_transaction() from public, anon, authenticated;
revoke all on function public.notify_lesson_completed() from public, anon, authenticated;
revoke all on function public.notify_price_alert_triggered() from public, anon, authenticated;
revoke all on function public.notify_portfolio_order_event() from public, anon, authenticated;
revoke all on function public.notify_price_alert_created() from public, anon, authenticated;

create unique index if not exists user_notifications_announcement_recipient_idx
    on public.user_notifications (announcement_id, user_id)
    where announcement_id is not null;
create index if not exists user_notifications_unread_idx
    on public.user_notifications (user_id, created_at desc)
    where read_at is null;

alter table public.user_notifications enable row level security;
grant select on public.user_notifications to authenticated;
grant update (read_at) on public.user_notifications to authenticated;
grant all on public.user_notifications to service_role;
drop policy if exists "Users read own notifications" on public.user_notifications;
create policy "Users read own notifications" on public.user_notifications
    for select using (user_id = auth.uid());
drop policy if exists "Users update own notification read state" on public.user_notifications;
create policy "Users update own notification read state" on public.user_notifications
    for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Admins read notification delivery" on public.user_notifications;
create policy "Admins read notification delivery" on public.user_notifications
    for select using (public.has_admin_role());

create or replace function public.admin_publish_announcement(
    p_title text,
    p_message text,
    p_category text,
    p_severity text,
    p_starts_at timestamptz,
    p_ends_at timestamptz,
    p_audience_role text,
    p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
    v_actor uuid := auth.uid();
    v_announcement_id uuid;
begin
    if v_actor is null or not public.has_admin_role() then
        raise exception 'Administrator access required.';
    end if;
    if char_length(trim(coalesce(p_title, ''))) not between 1 and 120
       or char_length(trim(coalesce(p_message, ''))) not between 1 and 500
       or p_category not in ('announcement', 'market', 'portfolio', 'academy', 'system')
       or p_severity not in ('info', 'success', 'warning', 'critical')
       or p_audience_role not in ('all', 'user', 'pro_trader', 'analyst', 'admin', 'super_admin')
       or (p_ends_at is not null and p_ends_at <= p_starts_at) then
        raise exception 'Invalid announcement fields.';
    end if;

    insert into public.system_announcements (
        title, message, category, severity, starts_at, ends_at, audience_role, active, created_by
    ) values (
        trim(p_title), trim(p_message), p_category, p_severity, p_starts_at, p_ends_at, p_audience_role, p_active, v_actor
    ) returning id into v_announcement_id;

    insert into public.user_notifications (
        user_id, announcement_id, category, severity, title, message
    )
    select u.id, v_announcement_id, p_category, p_severity, trim(p_title), trim(p_message)
    from auth.users u
    left join public.user_roles r on r.user_id = u.id
    where p_audience_role = 'all' or coalesce(r.role, 'user') = p_audience_role;

    return v_announcement_id;
end;
$$;

create or replace function public.admin_update_announcement(
    p_announcement_id uuid,
    p_title text,
    p_message text,
    p_category text,
    p_severity text,
    p_starts_at timestamptz,
    p_ends_at timestamptz,
    p_audience_role text,
    p_active boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
    v_actor uuid := auth.uid();
    v_announcement public.system_announcements%rowtype;
begin
    if v_actor is null or not public.has_admin_role() then
        raise exception 'Administrator access required.';
    end if;
    if char_length(trim(coalesce(p_title, ''))) not between 1 and 120
       or char_length(trim(coalesce(p_message, ''))) not between 1 and 500
       or p_category not in ('announcement', 'market', 'portfolio', 'academy', 'system')
       or p_severity not in ('info', 'success', 'warning', 'critical')
       or p_audience_role not in ('all', 'user', 'pro_trader', 'analyst', 'admin', 'super_admin')
       or (p_ends_at is not null and p_ends_at <= p_starts_at) then
        raise exception 'Invalid announcement fields.';
    end if;

    update public.system_announcements
    set title = trim(p_title), message = trim(p_message), category = p_category,
        severity = p_severity, starts_at = p_starts_at, ends_at = p_ends_at,
        audience_role = p_audience_role, active = p_active
    where id = p_announcement_id
    returning * into v_announcement;
    if not found then
        raise exception 'Announcement not found.';
    end if;

    delete from public.user_notifications n
    where n.announcement_id = p_announcement_id
      and not exists (
          select 1 from auth.users u
          left join public.user_roles r on r.user_id = u.id
          where u.id = n.user_id
            and (p_audience_role = 'all' or coalesce(r.role, 'user') = p_audience_role)
      );

    insert into public.user_notifications (user_id, announcement_id, category, severity, title, message)
    select u.id, p_announcement_id, p_category, p_severity, trim(p_title), trim(p_message)
    from auth.users u
    left join public.user_roles r on r.user_id = u.id
    where (p_audience_role = 'all' or coalesce(r.role, 'user') = p_audience_role)
      and not exists (
          select 1 from public.user_notifications n
          where n.announcement_id = p_announcement_id and n.user_id = u.id
      );

    update public.user_notifications
    set category = p_category, severity = p_severity, title = trim(p_title), message = trim(p_message)
    where announcement_id = p_announcement_id;

    return true;
end;
$$;

create or replace function public.admin_remove_announcement(p_announcement_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
    if auth.uid() is null or not public.has_admin_role() then
        raise exception 'Administrator access required.';
    end if;
    delete from public.system_announcements where id = p_announcement_id;
    return found;
end;
$$;

create or replace function public.get_user_unread_notification_count()
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
    select count(*)
    from public.user_notifications n
    left join public.system_announcements a on a.id = n.announcement_id
    where n.user_id = auth.uid()
      and n.read_at is null
      and (
          n.announcement_id is null
          or (a.active and a.starts_at <= now() and (a.ends_at is null or a.ends_at > now()))
      );
$$;

revoke all on function public.admin_publish_announcement(text, text, text, text, timestamptz, timestamptz, text, boolean) from public;
revoke all on function public.admin_update_announcement(uuid, text, text, text, text, timestamptz, timestamptz, text, boolean) from public;
revoke all on function public.admin_remove_announcement(uuid) from public;
revoke all on function public.get_user_unread_notification_count() from public, anon;
grant execute on function public.admin_publish_announcement(text, text, text, text, timestamptz, timestamptz, text, boolean) to authenticated;
grant execute on function public.admin_update_announcement(uuid, text, text, text, text, timestamptz, timestamptz, text, boolean) to authenticated;
grant execute on function public.admin_remove_announcement(uuid) to authenticated;
grant execute on function public.get_user_unread_notification_count() to authenticated;

insert into public.user_notifications (user_id, announcement_id, category, severity, title, message)
select u.id, a.id, a.category, a.severity, a.title, a.message
from public.system_announcements a
cross join auth.users u
left join public.user_roles r on r.user_id = u.id
where a.active
  and (a.ends_at is null or a.ends_at > now())
  and (a.audience_role = 'all' or coalesce(r.role, 'user') = a.audience_role)
on conflict (announcement_id, user_id) where announcement_id is not null do nothing;

notify pgrst, 'reload schema';
commit;
