begin;

insert into public.notification_event_templates
    (event_key, title, message, category, severity, active)
values
    ('admin_rank_adjustment', 'Trader Rank güncellendi',
     'Trader Rank''in {{rank}} olarak güncellendi ({{xp}} XP). {{note}}',
     'system', 'info', true)
on conflict (event_key) do nothing;

create or replace function public.admin_set_rank_xp_adjustment(
    p_actor_id uuid,
    p_target_id uuid,
    p_adjustment integer,
    p_note text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_role text;
    v_rank_before jsonb;
    v_rank_after jsonb;
    v_note text := trim(coalesce(p_note, ''));
    v_activity_id uuid;
begin
    if coalesce(auth.role(), '') <> 'service_role'
       and (auth.uid() is null or auth.uid() is distinct from p_actor_id) then
        raise exception 'Rank updates require the authenticated administrator.';
    end if;
    select role into v_actor_role from public.user_roles where user_id = p_actor_id;
    if v_actor_role not in ('admin', 'super_admin') then
        raise exception 'Unauthorized rank update.';
    end if;
    if p_adjustment is null or p_adjustment not between -1000000 and 1000000 then
        raise exception 'XP adjustment is out of range.';
    end if;
    if char_length(v_note) > 180 then
        raise exception 'Rank update note is too long.';
    end if;

    v_rank_before := public.get_trader_rank(p_target_id);
    insert into public.user_profiles (user_id, rank_xp_adjustment)
    values (p_target_id, p_adjustment)
    on conflict (user_id) do update set rank_xp_adjustment = excluded.rank_xp_adjustment;
    insert into public.user_activity_logs (user_id, event_type, description, metadata)
    values (
        p_target_id,
        'admin_rank_adjusted',
        case when v_note = '' then 'Yönetici Trader Rank ataması yaptı.'
             else left('Yönetici Trader Rank ataması yaptı: ' || v_note, 180) end,
        jsonb_build_object(
            'actor_id', p_actor_id,
            'previous_rank', v_rank_before ->> 'rank',
            'previous_xp', v_rank_before ->> 'xp',
            'xp_adjustment', p_adjustment,
            'note', nullif(v_note, '')
        )
    )
    returning id into v_activity_id;

    v_rank_after := public.get_trader_rank(p_target_id);
    update public.user_activity_logs
    set metadata = metadata || jsonb_build_object('rank', v_rank_after ->> 'rank', 'xp', v_rank_after ->> 'xp')
    where id = v_activity_id;

    perform public.deliver_event_notification(
        p_target_id,
        'admin_rank_adjustment',
        jsonb_build_object(
            'rank', v_rank_after ->> 'rank',
            'xp', replace(to_char((v_rank_after ->> 'xp')::bigint, 'FM999,999,999,990'), ',', '.'),
            'note', case when v_note = '' then '' else 'Yönetici notu: ' || v_note end
        )
    );
    return true;
end;
$$;

revoke all on function public.admin_set_rank_xp_adjustment(uuid, uuid, integer, text) from public, anon;
grant execute on function public.admin_set_rank_xp_adjustment(uuid, uuid, integer, text) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
