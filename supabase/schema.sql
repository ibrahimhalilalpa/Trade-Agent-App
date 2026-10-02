create extension if not exists pgcrypto;

create table if not exists public.watchlists (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null check (char_length(trim(name)) between 1 and 80),
    is_favorites boolean not null default false,
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, name)
);

create unique index if not exists watchlists_one_favorites_per_user
    on public.watchlists(user_id) where is_favorites;

create table if not exists public.watchlist_symbols (
    id uuid primary key default gen_random_uuid(),
    watchlist_id uuid not null references public.watchlists(id) on delete cascade,
    symbol text not null check (symbol ~ '^[A-Z0-9]{3,6}$'),
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    unique (watchlist_id, symbol)
);

alter table public.watchlists add column if not exists sort_order integer not null default 0;
alter table public.watchlist_symbols add column if not exists sort_order integer not null default 0;

create table if not exists public.user_portfolios (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null unique references auth.users(id) on delete cascade,
    balance numeric(18, 4) not null default 100000 check (balance >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.user_positions (
    id uuid primary key default gen_random_uuid(),
    portfolio_id uuid not null references public.user_portfolios(id) on delete cascade,
    symbol text not null check (symbol ~ '^[A-Z0-9]{3,6}$'),
    quantity numeric(18, 6) not null check (quantity > 0),
    average_price numeric(18, 6) not null check (average_price > 0),
    current_price numeric(18, 6) not null default 0 check (current_price >= 0),
    pnl numeric(18, 6) not null default 0,
    updated_at timestamptz not null default now(),
    unique (portfolio_id, symbol)
);

alter table public.user_portfolios alter column balance set default 100000;

create table if not exists public.portfolio_transactions (
    id uuid primary key default gen_random_uuid(),
    portfolio_id uuid not null references public.user_portfolios(id) on delete cascade,
    symbol text,
    transaction_type text not null check (transaction_type in ('buy', 'sell', 'cash_adjustment')),
    quantity numeric(18, 6) not null default 0 check (quantity >= 0),
    price numeric(18, 6) not null default 0 check (price >= 0),
    cash_delta numeric(18, 4) not null default 0,
    realized_pnl numeric(18, 4) not null default 0,
    balance_after numeric(18, 4) not null check (balance_after >= 0),
    created_at timestamptz not null default now(),
    check ((transaction_type = 'cash_adjustment' and symbol is null) or
           (transaction_type in ('buy', 'sell') and symbol ~ '^[A-Z0-9]{3,6}$' and quantity > 0 and price > 0))
);

create table if not exists public.portfolio_snapshots (
    id uuid primary key default gen_random_uuid(),
    portfolio_id uuid not null references public.user_portfolios(id) on delete cascade,
    snapshot_date date not null default (timezone('utc', now()))::date,
    cash_balance numeric(18, 4) not null check (cash_balance >= 0),
    total_value numeric(18, 4) not null check (total_value >= 0),
    created_at timestamptz not null default now(),
    unique (portfolio_id, snapshot_date)
);

create index if not exists watchlists_user_id_idx on public.watchlists(user_id);
create index if not exists watchlist_symbols_watchlist_id_idx on public.watchlist_symbols(watchlist_id);
create index if not exists user_positions_portfolio_id_idx on public.user_positions(portfolio_id);
create index if not exists portfolio_transactions_portfolio_created_idx on public.portfolio_transactions(portfolio_id, created_at desc);
create index if not exists portfolio_snapshots_portfolio_date_idx on public.portfolio_snapshots(portfolio_id, snapshot_date);
alter table public.watchlists enable row level security;
alter table public.watchlist_symbols enable row level security;
alter table public.user_portfolios enable row level security;
alter table public.user_positions enable row level security;
alter table public.portfolio_transactions enable row level security;
alter table public.portfolio_snapshots enable row level security;

drop policy if exists "Users manage their own watchlists" on public.watchlists;
create policy "Users manage their own watchlists" on public.watchlists
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users manage symbols in their watchlists" on public.watchlist_symbols;
create policy "Users manage symbols in their watchlists" on public.watchlist_symbols
    for all using (exists (select 1 from public.watchlists where id = watchlist_id and user_id = auth.uid()))
    with check (exists (select 1 from public.watchlists where id = watchlist_id and user_id = auth.uid()));

drop policy if exists "Users manage their own portfolio" on public.user_portfolios;
drop policy if exists "Users read their own portfolio" on public.user_portfolios;
create policy "Users manage their own portfolio" on public.user_portfolios
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users manage their own positions" on public.user_positions;
drop policy if exists "Users read their own positions" on public.user_positions;
create policy "Users manage their own positions" on public.user_positions
    for all using (exists (select 1 from public.user_portfolios where id = portfolio_id and user_id = auth.uid()))
    with check (exists (select 1 from public.user_portfolios where id = portfolio_id and user_id = auth.uid()));

drop policy if exists "Users read their own portfolio transactions" on public.portfolio_transactions;
create policy "Users read their own portfolio transactions" on public.portfolio_transactions
    for select using (exists (select 1 from public.user_portfolios where id = portfolio_id and user_id = auth.uid()));

drop policy if exists "Users read their own portfolio snapshots" on public.portfolio_snapshots;
create policy "Users read their own portfolio snapshots" on public.portfolio_snapshots
    for select using (exists (select 1 from public.user_portfolios where id = portfolio_id and user_id = auth.uid()));
drop policy if exists "Users insert their own portfolio snapshots" on public.portfolio_snapshots;
create policy "Users insert their own portfolio snapshots" on public.portfolio_snapshots
    for insert with check (exists (select 1 from public.user_portfolios where id = portfolio_id and user_id = auth.uid()));
drop policy if exists "Users update their own portfolio snapshots" on public.portfolio_snapshots;
create policy "Users update their own portfolio snapshots" on public.portfolio_snapshots
    for update using (exists (select 1 from public.user_portfolios where id = portfolio_id and user_id = auth.uid()))
    with check (exists (select 1 from public.user_portfolios where id = portfolio_id and user_id = auth.uid()));


grant usage on schema public to authenticated;
grant select, insert, update, delete on public.user_portfolios, public.user_positions to authenticated;
grant select, insert, update, delete on public.portfolio_snapshots to authenticated;
grant select on public.portfolio_transactions to authenticated;

create or replace function public.process_portfolio_action(
    p_user_id uuid,
    p_action text,
    p_symbol text default null,
    p_quantity numeric default 0,
    p_price numeric default 0,
    p_balance numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_portfolio public.user_portfolios%rowtype;
    v_position public.user_positions%rowtype;
    v_next_quantity numeric(18, 6);
    v_next_average numeric(18, 6);
    v_cash_delta numeric(18, 4);
    v_realized_pnl numeric(18, 4) := 0;
    v_total_value numeric(18, 4);
begin
    if auth.uid() is distinct from p_user_id then
        raise exception 'Yetkisiz portföy işlemi.';
    end if;
    if p_action is null or p_action not in ('buy', 'sell', 'cash_adjustment') then
        raise exception 'Geçersiz portföy işlemi.';
    end if;
    if p_action in ('buy', 'sell') and
       (p_symbol is null or p_symbol !~ '^[A-Z0-9]{3,6}$' or p_quantity is null or p_quantity <= 0 or p_price is null or p_price <= 0) then
        raise exception 'Geçersiz sanal emir.';
    end if;
    if p_action = 'cash_adjustment' and (p_balance is null or p_balance < 0) then
        raise exception 'Bakiye sıfır veya daha büyük olmalıdır.';
    end if;

    insert into public.user_portfolios (user_id) values (p_user_id)
    on conflict (user_id) do nothing;
    select * into v_portfolio from public.user_portfolios where user_id = p_user_id for update;

    if p_action = 'cash_adjustment' then
        v_cash_delta := p_balance - v_portfolio.balance;
        update public.user_portfolios set balance = p_balance where id = v_portfolio.id returning * into v_portfolio;
        insert into public.portfolio_transactions (portfolio_id, transaction_type, cash_delta, balance_after)
        values (v_portfolio.id, 'cash_adjustment', v_cash_delta, v_portfolio.balance);
    else
        select * into v_position from public.user_positions
        where portfolio_id = v_portfolio.id and symbol = p_symbol for update;
        if p_action = 'buy' then
            if p_quantity * p_price > v_portfolio.balance then
                raise exception 'Sanal bakiyeniz bu emir için yetersiz.';
            end if;
            v_next_quantity := coalesce(v_position.quantity, 0) + p_quantity;
            v_next_average := case when coalesce(v_position.quantity, 0) = 0 then p_price
                else ((v_position.quantity * v_position.average_price) + (p_quantity * p_price)) / v_next_quantity end;
            update public.user_portfolios set balance = balance - (p_quantity * p_price)
            where id = v_portfolio.id returning * into v_portfolio;
            insert into public.user_positions (portfolio_id, symbol, quantity, average_price, current_price, pnl)
            values (v_portfolio.id, p_symbol, v_next_quantity, v_next_average, p_price, 0)
            on conflict (portfolio_id, symbol) do update set
                quantity = excluded.quantity, average_price = excluded.average_price,
                current_price = excluded.current_price, pnl = (excluded.current_price - excluded.average_price) * excluded.quantity;
        else
            if not found or p_quantity > v_position.quantity then
                raise exception 'Satış adedi mevcut pozisyondan fazla olamaz.';
            end if;
            v_realized_pnl := (p_price - v_position.average_price) * p_quantity;
            update public.user_portfolios set balance = balance + (p_quantity * p_price)
            where id = v_portfolio.id returning * into v_portfolio;
            v_next_quantity := v_position.quantity - p_quantity;
            if v_next_quantity = 0 then
                delete from public.user_positions where id = v_position.id;
            else
                update public.user_positions set quantity = v_next_quantity, current_price = p_price,
                    pnl = (p_price - average_price) * v_next_quantity where id = v_position.id;
            end if;
        end if;
        insert into public.portfolio_transactions
            (portfolio_id, symbol, transaction_type, quantity, price, realized_pnl, balance_after)
        values (v_portfolio.id, p_symbol, p_action, p_quantity, p_price, v_realized_pnl, v_portfolio.balance);
    end if;

    select v_portfolio.balance + coalesce(sum(quantity * current_price), 0) into v_total_value
    from public.user_positions where portfolio_id = v_portfolio.id;
    insert into public.portfolio_snapshots (portfolio_id, snapshot_date, cash_balance, total_value)
    values (v_portfolio.id, (timezone('utc', now()))::date, v_portfolio.balance, v_total_value)
    on conflict (portfolio_id, snapshot_date) do update set cash_balance = excluded.cash_balance,
        total_value = excluded.total_value, created_at = now();

    return jsonb_build_object('balance', v_portfolio.balance, 'totalValue', v_total_value);
end;
$$;

revoke all on function public.process_portfolio_action(uuid, text, text, numeric, numeric, numeric) from public;
grant execute on function public.process_portfolio_action(uuid, text, text, numeric, numeric, numeric) to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
    insert into public.user_portfolios (user_id) values (new.id) on conflict (user_id) do nothing;
    insert into public.watchlists (user_id, name, is_favorites) values
        (new.id, 'Favoriler', true),
        (new.id, 'Alacaklarım', false),
        (new.id, 'Aldıklarım', false),
        (new.id, 'Almayı düşündüklerim', false)
    on conflict (user_id, name) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute procedure public.handle_new_user();

insert into public.user_portfolios (user_id, balance)
select id, 100000 from auth.users
on conflict (user_id) do nothing;

insert into public.watchlists (user_id, name, is_favorites)
select users.id, defaults.name, defaults.is_favorites
from auth.users as users
cross join (values
    ('Favoriler', true),
    ('Alacaklarım', false),
    ('Aldıklarım', false),
    ('Almayı düşündüklerim', false)
) as defaults(name, is_favorites)
on conflict (user_id, name) do nothing;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists watchlists_touch_updated_at on public.watchlists;
create trigger watchlists_touch_updated_at before update on public.watchlists for each row execute procedure public.touch_updated_at();
drop trigger if exists portfolios_touch_updated_at on public.user_portfolios;
create trigger portfolios_touch_updated_at before update on public.user_portfolios for each row execute procedure public.touch_updated_at();
drop trigger if exists positions_touch_updated_at on public.user_positions;
create trigger positions_touch_updated_at before update on public.user_positions for each row execute procedure public.touch_updated_at();

create table if not exists public.user_education_progress (
    id uuid default gen_random_uuid() primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    lesson_id text not null,
    completed boolean not null default true,
    completed_at timestamptz not null default timezone('utc'::text, now()),
    unique (user_id, lesson_id)
);

alter table public.user_education_progress enable row level security;

drop policy if exists "Users can view their education progress" on public.user_education_progress;
create policy "Users can view their education progress" on public.user_education_progress
    for select using (auth.uid() = user_id);

drop policy if exists "Users can save their education progress" on public.user_education_progress;
create policy "Users can save their education progress" on public.user_education_progress
    for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their education progress" on public.user_education_progress;
create policy "Users can update their education progress" on public.user_education_progress
    for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete their education progress" on public.user_education_progress;
create policy "Users can delete their education progress" on public.user_education_progress
    for delete using (auth.uid() = user_id);

create index if not exists user_education_progress_user_id_idx on public.user_education_progress(user_id);

create table if not exists public.user_profiles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    full_name text not null default '' check (char_length(full_name) <= 120),
    display_name text not null default '' check (char_length(display_name) <= 60),
    bio text not null default '' check (char_length(bio) <= 280),
    theme text not null default 'dark' check (theme in ('dark', 'light')),
    updated_at timestamptz not null default now()
);

create table if not exists public.user_activity_logs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    event_type text not null check (event_type in (
        'login', 'logout', 'profile_updated', 'password_changed', 'password_failed',
        'password_reset_requested', 'list_created', 'list_renamed', 'list_deleted',
        'stock_added', 'stock_removed', 'portfolio_order', 'portfolio_cash_adjustment',
        'lesson_completed', 'lesson_uncompleted', 'admin_cash_adjustment',
        'admin_role_changed', 'admin_account_status', 'admin_order_status',
        'admin_alert_status', 'admin_position_adjusted', 'admin_rank_adjusted',
        'admin_profile_updated', 'admin_user_invited', 'account_freeze_requested',
        'account_reactivated', 'account_deletion_requested', 'forum_topic_created'
    )),
    description text not null check (char_length(description) between 1 and 180),
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

alter table public.user_activity_logs drop constraint if exists user_activity_logs_event_type_check;
alter table public.user_activity_logs add constraint user_activity_logs_event_type_check
    check (event_type in (
        'login', 'logout', 'profile_updated', 'password_changed', 'password_failed',
        'password_reset_requested', 'list_created', 'list_renamed', 'list_deleted',
        'stock_added', 'stock_removed', 'portfolio_order', 'portfolio_cash_adjustment',
        'lesson_completed', 'lesson_uncompleted', 'admin_cash_adjustment',
        'admin_role_changed', 'admin_account_status', 'admin_order_status',
        'admin_alert_status', 'admin_position_adjusted', 'admin_rank_adjusted',
        'admin_profile_updated', 'admin_user_invited', 'account_freeze_requested',
        'account_reactivated', 'account_deletion_requested', 'forum_topic_created'
    ));

drop trigger if exists user_profiles_touch_updated_at on public.user_profiles;
create trigger user_profiles_touch_updated_at before update on public.user_profiles for each row execute procedure public.touch_updated_at();

create index if not exists user_activity_logs_user_created_idx on public.user_activity_logs(user_id, created_at desc);

alter table public.user_profiles enable row level security;
alter table public.user_activity_logs enable row level security;

drop policy if exists "Users manage their own profile" on public.user_profiles;
create policy "Users manage their own profile" on public.user_profiles
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users read their own activity" on public.user_activity_logs;
create policy "Users read their own activity" on public.user_activity_logs
    for select using (auth.uid() = user_id);

drop policy if exists "Users append their own activity" on public.user_activity_logs;
create policy "Users append their own activity" on public.user_activity_logs
    for insert with check (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
    insert into public.user_portfolios (user_id, balance) values (new.id, 100000) on conflict (user_id) do nothing;
    insert into public.user_profiles (user_id, full_name, display_name)
    values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), coalesce(new.raw_user_meta_data->>'display_name', ''))
    on conflict (user_id) do nothing;
    insert into public.watchlists (user_id, name, is_favorites) values
        (new.id, 'Favoriler', true),
        (new.id, 'Alacaklarım', false),
        (new.id, 'Aldıklarım', false),
        (new.id, 'Almayı düşündüklerim', false)
    on conflict (user_id, name) do nothing;
    return new;
end;
$$;

insert into public.user_profiles (user_id, full_name, display_name)
select id, coalesce(raw_user_meta_data->>'full_name', ''), coalesce(raw_user_meta_data->>'display_name', '')
from auth.users
on conflict (user_id) do nothing;

notify pgrst, 'reload schema';
