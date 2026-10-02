create or replace function public.get_portfolio_period_pnl(
    p_user_id uuid,
    p_current_value numeric,
    p_period text
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_portfolio_id uuid;
    v_baseline_value numeric;
    v_baseline_at timestamptz;
    v_cutoff_date date;
    v_cash_adjustments numeric := 0;
begin
    if auth.uid() is distinct from p_user_id then
        raise exception 'Yetkisiz portföy sorgusu.';
    end if;
    if p_current_value is null or p_current_value < 0
       or p_period is null or p_period not in ('day', 'week', 'month', 'year', 'all') then
        raise exception 'Geçersiz portföy performans aralığı.';
    end if;

    select id into v_portfolio_id from public.user_portfolios where user_id = p_user_id;
    if v_portfolio_id is null then
        raise exception 'Sanal portföy bulunamadı.';
    end if;

    if p_period = 'all' then
        select coalesce(sum(cash_delta), 0) into v_cash_adjustments
        from public.portfolio_transactions
        where portfolio_id = v_portfolio_id and transaction_type = 'cash_adjustment';
        return p_current_value - 100000 - v_cash_adjustments;
    end if;

    v_cutoff_date := case p_period
        when 'day' then (now() at time zone 'UTC')::date
        when 'week' then (now() at time zone 'UTC')::date - 7
        when 'month' then (now() at time zone 'UTC')::date - 30
        else (now() at time zone 'UTC')::date - 365
    end;

    select total_value, created_at into v_baseline_value, v_baseline_at
    from public.portfolio_snapshots
    where portfolio_id = v_portfolio_id
      and ((p_period = 'day' and snapshot_date < v_cutoff_date)
           or (p_period <> 'day' and snapshot_date <= v_cutoff_date))
    order by snapshot_date desc
    limit 1;

    if v_baseline_value is null then
        if p_period <> 'day' then
            select coalesce(sum(cash_delta), 0) into v_cash_adjustments
            from public.portfolio_transactions
            where portfolio_id = v_portfolio_id and transaction_type = 'cash_adjustment';
            return p_current_value - 100000 - v_cash_adjustments;
        end if;
        return null;
    end if;

    select coalesce(sum(cash_delta), 0) into v_cash_adjustments
    from public.portfolio_transactions
    where portfolio_id = v_portfolio_id
      and transaction_type = 'cash_adjustment'
      and created_at > v_baseline_at;

    return p_current_value - v_baseline_value - v_cash_adjustments;
end;
$$;
