begin;

grant update (error) on table public.portfolio_orders to service_role;

notify pgrst, 'reload schema';
commit;
