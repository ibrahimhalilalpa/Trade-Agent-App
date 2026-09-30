do $$
declare
    v_url constant text := 'https://ptbjskzipuazzfdchbfd.supabase.co/functions/v1/portfolio-order-monitor';
    v_url_id uuid;
begin
    select id into v_url_id
    from vault.decrypted_secrets
    where name = 'portfolio_order_monitor_url';

    if v_url_id is null then
        perform vault.create_secret(
            v_url,
            'portfolio_order_monitor_url',
            'URL of the portfolio order monitor Edge Function'
        );
    else
        perform vault.update_secret(
            v_url_id,
            v_url,
            'portfolio_order_monitor_url',
            'URL of the portfolio order monitor Edge Function'
        );
    end if;
end;
$$;

select name
from vault.decrypted_secrets
where name in ('portfolio_order_monitor_url', 'portfolio_order_monitor_token')
order by name;
