begin;

alter table public.notification_event_templates
    drop constraint if exists notification_event_templates_event_key_check,
    add constraint notification_event_templates_event_key_check
        check (event_key ~ '^[a-z][a-z0-9_]{1,79}$');

insert into public.notification_event_templates
    (event_key, title, message, category, severity, active)
values
    ('admin_balance_adjustment', 'Sanal bakiye güncellendi',
     'Sanal bakiyene yönetici tarafından {{amount}} TL {{action}}. Açıklama: {{description}} Yeni bakiyen: {{balance}} TL.',
     'portfolio', 'info', true)
on conflict (event_key) do nothing;

create or replace function public.admin_adjust_portfolio_cash(
    p_actor_id uuid,
    p_target_id uuid,
    p_delta numeric,
    p_note text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_role text;
    v_portfolio public.user_portfolios%rowtype;
    v_total_value numeric(18, 4);
begin
    if coalesce(auth.role(), '') <> 'service_role'
       and (auth.uid() is null or auth.uid() is distinct from p_actor_id) then
        raise exception 'Portfolio adjustments require the authenticated super administrator.';
    end if;
    select role into v_actor_role from public.user_roles where user_id = p_actor_id;
    if v_actor_role <> 'super_admin' then
        raise exception 'Only a super administrator may adjust portfolio cash.';
    end if;
    if p_delta is null or p_delta = 0 or abs(p_delta) > 1000000000
       or char_length(trim(coalesce(p_note, ''))) not between 1 and 180 then
        raise exception 'Invalid cash adjustment.';
    end if;

    select * into v_portfolio from public.user_portfolios where user_id = p_target_id for update;
    if not found then
        raise exception 'Target portfolio not found.';
    end if;
    update public.user_portfolios
    set balance = balance + p_delta, updated_at = now()
    where id = v_portfolio.id
    returning * into v_portfolio;

    insert into public.portfolio_transactions
        (portfolio_id, transaction_type, quantity, price, cash_delta, realized_pnl, balance_after)
    values (v_portfolio.id, 'cash_adjustment', 0, 0, p_delta, 0, v_portfolio.balance);

    select v_portfolio.balance + coalesce(sum(quantity * current_price), 0)
    into v_total_value from public.user_positions where portfolio_id = v_portfolio.id;
    insert into public.portfolio_snapshots (portfolio_id, snapshot_date, cash_balance, total_value)
    values (v_portfolio.id, (timezone('utc', now()))::date, v_portfolio.balance, v_total_value)
    on conflict (portfolio_id, snapshot_date) do update
    set cash_balance = excluded.cash_balance, total_value = excluded.total_value, created_at = now();

    insert into public.user_activity_logs (user_id, event_type, description, metadata)
    values (p_target_id, 'admin_cash_adjustment', left(trim(p_note), 180),
        jsonb_build_object('actor_id', p_actor_id, 'delta', p_delta));

    perform public.deliver_event_notification(p_target_id, 'admin_balance_adjustment', jsonb_build_object(
        'amount', replace(to_char(abs(p_delta), 'FM999999999990D00'), '.', ','),
        'action', case when p_delta > 0 then 'eklendi' else 'düşürüldü' end,
        'description', trim(p_note),
        'balance', replace(to_char(v_portfolio.balance, 'FM999999999990D00'), '.', ',')
    ));

    return true;
end;
$$;

notify pgrst, 'reload schema';
commit;
