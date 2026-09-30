begin;

create or replace function public.is_valid_bist_price_tick(p_price numeric)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
    v_tick numeric;
begin
    if p_price is null or p_price <= 0 then
        return false;
    end if;

    v_tick := case
        when p_price < 20 then 0.01
        when p_price < 50 then 0.02
        when p_price < 100 then 0.05
        when p_price < 250 then 0.10
        when p_price < 500 then 0.25
        when p_price < 1000 then 0.50
        else 1.00
    end;

    return abs(p_price - v_tick * round(p_price / v_tick)) < 0.000001;
end;
$$;

revoke all on function public.is_valid_bist_price_tick(numeric) from public, anon, authenticated;
grant execute on function public.is_valid_bist_price_tick(numeric) to service_role;

notify pgrst, 'reload schema';
commit;
