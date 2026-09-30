begin;

alter table public.user_profiles
    add column if not exists leaderboard_gain_visible boolean not null default true;

drop function if exists public.get_public_leaderboard(text);

create function public.get_public_leaderboard(p_period text default 'all')
returns table (
    user_id uuid,
    display_name text,
    trader_rank text,
    xp bigint,
    pnl_percent numeric,
    pnl_amount numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if p_period is null or p_period not in ('day', 'week', 'month', 'all') then
        raise exception 'Invalid leaderboard period.';
    end if;
    return query
    with eligible as (
        select pf.id as portfolio_id, pf.user_id, pf.balance,
            coalesce(up.display_name, '') as display_name,
            up.leaderboard_gain_visible,
            coalesce(up.rank_xp_adjustment, 0) as rank_xp_adjustment,
            coalesce((select sum(pos.quantity * pos.current_price) from public.user_positions pos where pos.portfolio_id = pf.id), 0) as positions_value,
            coalesce((select sum(t.cash_delta) from public.portfolio_transactions t
                where t.portfolio_id = pf.id and t.transaction_type = 'cash_adjustment'), 0) as total_cash_adjustments,
            (select count(*) from public.user_education_progress ep where ep.user_id = pf.user_id and ep.completed) as lessons,
            (select count(distinct a.created_at::date) from public.user_activity_logs a where a.user_id = pf.user_id) as active_days,
            baseline.snapshot_date as baseline_date,
            baseline.total_value as baseline_value,
            coalesce(period_cash.adjustments, 0) as period_cash_adjustments
        from public.user_portfolios pf
        join public.user_profiles up on up.user_id = pf.user_id and up.leaderboard_visible
        left join lateral (
            select s.snapshot_date, s.total_value
            from public.portfolio_snapshots s
            where s.portfolio_id = pf.id
              and case p_period
                when 'day' then s.snapshot_date < (now() at time zone 'UTC')::date
                when 'week' then s.snapshot_date <= (now() at time zone 'UTC')::date - 7
                when 'month' then s.snapshot_date <= (now() at time zone 'UTC')::date - 30
                else false end
            order by s.snapshot_date desc
            limit 1
        ) baseline on p_period <> 'all'
        left join lateral (
            select coalesce(sum(t.cash_delta), 0) as adjustments
            from public.portfolio_transactions t
            where t.portfolio_id = pf.id
              and t.transaction_type = 'cash_adjustment'
              and t.created_at::date > baseline.snapshot_date
        ) period_cash on p_period <> 'all' and baseline.snapshot_date is not null
    ), scores as (
        select e.*,
            case when p_period = 'all'
                then e.balance + e.positions_value - 100000 - e.total_cash_adjustments
                else e.balance + e.positions_value - e.baseline_value - coalesce(e.period_cash_adjustments, 0)
            end as period_pnl,
            case when p_period = 'all' then 100000 + e.total_cash_adjustments
                else e.baseline_value + coalesce(e.period_cash_adjustments, 0) end as capital_base
        from eligible e
        where p_period = 'all' or e.baseline_value is not null
    ), ranked as (
        select s.*,
            case when s.capital_base > 0 then s.period_pnl / s.capital_base * 100 else 0 end as return_percent,
            greatest(0, s.lessons * 100 + s.active_days * 10
                + floor(greatest(
                    case when 100000 + s.total_cash_adjustments > 0
                        then (s.balance + s.positions_value - 100000 - s.total_cash_adjustments)
                            / (100000 + s.total_cash_adjustments) * 100 else 0 end, 0) * 100)::bigint
                + s.rank_xp_adjustment) as total_xp
        from scores s
    )
    select r.user_id,
        coalesce(nullif(r.display_name, ''), 'Trader-' || left(r.user_id::text, 6)),
        case when r.total_xp >= 5000 then 'Piyasa Yapıcı'
             when r.total_xp >= 2000 then 'Üstat'
             when r.total_xp >= 500 then 'Analist'
             else 'Çaylak' end,
        r.total_xp,
        r.return_percent,
        case when r.leaderboard_gain_visible then r.period_pnl else null::numeric end
    from ranked r
    where r.period_pnl is not null
    order by r.return_percent desc
    limit 50;
end;
$$;

revoke all on function public.get_public_leaderboard(text) from public;
grant execute on function public.get_public_leaderboard(text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
