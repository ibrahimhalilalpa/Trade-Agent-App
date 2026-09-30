begin;

do $$
begin
    if to_regclass('cron.job') is null then
        raise exception 'Enable the pg_cron extension before scheduling the portfolio monitor.';
    end if;
    if to_regclass('net.http_request_queue') is null then
        raise exception 'Enable the pg_net extension before scheduling the portfolio monitor.';
    end if;
    if to_regclass('vault.decrypted_secrets') is null then
        raise exception 'Enable the supabase_vault extension before scheduling the portfolio monitor.';
    end if;
    if not exists (
        select 1 from vault.decrypted_secrets where name = 'portfolio_order_monitor_url'
    ) then
        raise exception 'Missing portfolio_order_monitor_url in Database > Vault. Edge Function Secrets are separate.';
    end if;
    if not exists (
        select 1 from vault.decrypted_secrets where name = 'portfolio_order_monitor_token'
    ) then
        raise exception 'Missing portfolio_order_monitor_token in Database > Vault. Add the same value as PORTFOLIO_MONITOR_TOKEN; Edge Function Secrets are separate.';
    end if;
end;
$$;

select cron.unschedule(jobid)
from cron.job
where jobname = 'portfolio-order-monitor-every-minute';

select cron.schedule(
    'portfolio-order-monitor-every-minute',
    '* * * * *',
    $job$
    select net.http_post(
        url := (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'portfolio_order_monitor_url'
        ),
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (
                select decrypted_secret
                from vault.decrypted_secrets
                where name = 'portfolio_order_monitor_token'
            )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
    );
    $job$
);

commit;
