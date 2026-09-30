begin;

alter table public.user_profiles
    add column if not exists username text;

do $$
declare
    profile_row record;
    candidate text;
    base_name text;
begin
    for profile_row in
        select user_id, display_name, full_name
        from public.user_profiles
        where username is null or btrim(username) = ''
        order by user_id
    loop
        base_name := trim(both '_' from regexp_replace(
            lower(coalesce(nullif(profile_row.display_name, ''), profile_row.full_name, '')),
            '[^a-z0-9]+', '_', 'g'
        ));
        if char_length(base_name) < 3 then
            base_name := 'trader';
        end if;
        if base_name !~ '^[a-z]' then
            base_name := 'trader_' || base_name;
        end if;
        candidate := left(base_name, 24);
        if exists (select 1 from public.user_profiles where lower(username) = candidate) then
            candidate := left(base_name, 20) || '_' || replace(profile_row.user_id::text, '-', '');
        end if;
        if exists (select 1 from public.user_profiles where lower(username) = candidate) then
            candidate := 'trader_' || replace(profile_row.user_id::text, '-', '');
        end if;
        update public.user_profiles
        set username = candidate, display_name = candidate
        where user_id = profile_row.user_id;
    end loop;
end;
$$;

update public.user_profiles
set display_name = username
where display_name is distinct from username;

alter table public.user_profiles
    alter column username set not null;

alter table public.user_profiles
    drop constraint if exists user_profiles_username_format_check;
alter table public.user_profiles
    add constraint user_profiles_username_format_check
    check (username ~ '^[a-z][a-z0-9_]{2,59}$');

create unique index if not exists user_profiles_username_unique_idx
    on public.user_profiles (lower(username));

create or replace function public.normalize_profile_username()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    candidate text;
begin
    if tg_op = 'INSERT'
       and coalesce(btrim(new.username), '') <> '' then
        candidate := lower(btrim(new.username));
        if candidate !~ '^[a-z][a-z0-9_]{2,59}$' then
            raise exception 'Username must contain 3 to 60 lowercase letters, numbers, or underscores and start with a letter.';
        end if;
    elsif tg_op = 'UPDATE'
       and new.username is distinct from old.username then
        candidate := lower(btrim(new.username));
        if candidate !~ '^[a-z][a-z0-9_]{2,59}$' then
            raise exception 'Username must contain 3 to 60 lowercase letters, numbers, or underscores and start with a letter.';
        end if;
    elsif tg_op = 'UPDATE'
       and new.display_name is distinct from old.display_name then
        candidate := trim(both '_' from regexp_replace(lower(btrim(new.display_name)), '[^a-z0-9]+', '_', 'g'));
        if candidate !~ '^[a-z][a-z0-9_]{2,59}$' then
            raise exception 'Username must contain at least 3 valid characters.';
        end if;
    else
        candidate := lower(btrim(coalesce(new.username, '')));
        if candidate !~ '^[a-z][a-z0-9_]{2,59}$' then
            candidate := trim(both '_' from regexp_replace(
                lower(btrim(coalesce(nullif(new.display_name, ''), new.full_name, ''))),
                '[^a-z0-9]+', '_', 'g'
            ));
        end if;
        if candidate !~ '^[a-z][a-z0-9_]{2,59}$' then
            candidate := 'trader_' || replace(new.user_id::text, '-', '');
        end if;
        if exists (select 1 from public.user_profiles where lower(username) = candidate and user_id <> new.user_id) then
            candidate := left(candidate, 20) || '_' || replace(new.user_id::text, '-', '');
        end if;
    end if;

    new.username := candidate;
    new.display_name := candidate;
    return new;
end;
$$;

drop trigger if exists user_profiles_normalize_username on public.user_profiles;
create trigger user_profiles_normalize_username
    before insert or update of username, display_name
    on public.user_profiles
    for each row execute function public.normalize_profile_username();

notify pgrst, 'reload schema';
commit;
