begin;

-- Apply after user-roles-rank-migration.sql and forum-community-notifications-migration.sql.
insert into public.notification_event_templates
    (event_key, title, message, category, severity, active)
values
    ('trader_rank_up', 'Yeni Trader Rank seviyesine ulaştın!',
     '{{rank}} seviyesine yükseldin. Toplam deneyim puanın {{xp}} XP. Tebrikler!',
     'academy', 'success', true)
on conflict (event_key) do update
set title = excluded.title,
    message = excluded.message,
    category = excluded.category,
    severity = excluded.severity,
    active = true,
    updated_at = now();

create or replace function public.notify_trader_rank_up(p_user_id uuid, p_xp_delta bigint)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
    v_rank_after jsonb;
    v_xp_before bigint;
    v_rank_before text;
begin
    v_rank_after := public.get_trader_rank(p_user_id);
    v_xp_before := greatest(0, (v_rank_after ->> 'xp')::bigint - p_xp_delta);
    v_rank_before := case
        when v_xp_before >= 5000 then 'Piyasa Yapıcı'
        when v_xp_before >= 2000 then 'Üstat'
        when v_xp_before >= 500 then 'Analist'
        else 'Çaylak'
    end;

    if v_rank_before <> (v_rank_after ->> 'rank') then
        perform public.deliver_event_notification(
            p_user_id,
            'trader_rank_up',
            jsonb_build_object(
                'rank', v_rank_after ->> 'rank',
                'xp', replace(to_char((v_rank_after ->> 'xp')::bigint, 'FM999,999,999,990'), ',', '.'),
                'action_url', '/profile'
            )
        );
    end if;
end;
$$;

create or replace function public.notify_lesson_rank_up()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
    if tg_op = 'INSERT' and new.completed then
        perform public.notify_trader_rank_up(new.user_id, 100);
    elsif tg_op = 'UPDATE' and new.completed and not old.completed then
        perform public.notify_trader_rank_up(new.user_id, 100);
    end if;
    return new;
end;
$$;

create or replace function public.notify_activity_rank_up()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
    v_activity_count integer;
begin
    select count(*) into v_activity_count
    from public.user_activity_logs
    where user_id = new.user_id
      and created_at::date = new.created_at::date;
    if v_activity_count = 1 then
        perform public.notify_trader_rank_up(new.user_id, 10);
    end if;
    return new;
end;
$$;

drop trigger if exists education_lesson_rank_up_notification on public.user_education_progress;
create trigger education_lesson_rank_up_notification
    after insert or update of completed on public.user_education_progress
    for each row execute function public.notify_lesson_rank_up();

drop trigger if exists user_activity_rank_up_notification on public.user_activity_logs;
create trigger user_activity_rank_up_notification
    after insert on public.user_activity_logs
    for each row execute function public.notify_activity_rank_up();

revoke all on function public.notify_lesson_rank_up() from public, anon, authenticated;
revoke all on function public.notify_activity_rank_up() from public, anon, authenticated;
revoke all on function public.notify_trader_rank_up(uuid, bigint) from public, anon, authenticated;

commit;
