begin;

alter table public.user_notifications
    add column if not exists event_key text;

create table if not exists public.user_notification_preferences (
    user_id uuid not null references auth.users(id) on delete cascade,
    event_key text not null check (event_key ~ '^[a-z][a-z0-9_]{1,79}$'),
    enabled boolean not null default true,
    updated_at timestamptz not null default now(),
    primary key (user_id, event_key)
);

grant select on public.notification_event_templates to authenticated;
drop policy if exists "Authenticated users read notification templates" on public.notification_event_templates;
create policy "Authenticated users read notification templates" on public.notification_event_templates
    for select to authenticated using (true);

alter table public.user_notification_preferences enable row level security;
grant select, insert, update, delete on public.user_notification_preferences to authenticated;
drop policy if exists "Users manage own notification preferences" on public.user_notification_preferences;
create policy "Users manage own notification preferences" on public.user_notification_preferences
    for all using (user_id = auth.uid()) with check (user_id = auth.uid());

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
    insert into public.user_notifications (user_id, event_key, category, severity, title, message)
    values (p_user_id, p_event_key, v_template.category, v_template.severity, v_title, v_message);
end;
$$;

create or replace function public.apply_notification_preference()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_event_key text := coalesce(new.event_key, case when new.announcement_id is not null then 'announcement' end);
    v_enabled boolean;
begin
    if v_event_key is null then
        return new;
    end if;
    select enabled into v_enabled
    from public.user_notification_preferences
    where user_id = new.user_id and event_key = v_event_key;
    if v_enabled is false then
        return null;
    end if;
    new.event_key := v_event_key;
    return new;
end;
$$;

drop trigger if exists user_notification_preference_gate on public.user_notifications;
create trigger user_notification_preference_gate
    before insert on public.user_notifications
    for each row execute function public.apply_notification_preference();

revoke all on function public.apply_notification_preference() from public, anon, authenticated;
revoke all on function public.deliver_event_notification(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.deliver_event_notification(uuid, text, jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
