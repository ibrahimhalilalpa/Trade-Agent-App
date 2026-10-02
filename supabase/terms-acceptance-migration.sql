begin;

alter table public.user_profiles
    add column if not exists terms_accepted boolean not null default false,
    add column if not exists terms_accepted_at timestamptz,
    add column if not exists terms_version text;

insert into public.user_profiles (
    user_id, terms_accepted, terms_accepted_at, terms_version
)
select
    users.id, true, now(), '2026-10-02'
from auth.users as users
on conflict (user_id) do update set
    terms_accepted = true,
    terms_accepted_at = coalesce(public.user_profiles.terms_accepted_at, now()),
    terms_version = coalesce(public.user_profiles.terms_version, '2026-10-02');

create or replace function public.record_signup_terms_acceptance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.raw_user_meta_data->>'terms_accepted' = 'true'
       and new.raw_user_meta_data->>'terms_version' = '2026-10-02' then
        insert into public.user_profiles (
            user_id, terms_accepted, terms_accepted_at, terms_version
        )
        values (new.id, true, now(), '2026-10-02')
        on conflict (user_id) do update set
            terms_accepted = true,
            terms_accepted_at = coalesce(public.user_profiles.terms_accepted_at, now()),
            terms_version = coalesce(public.user_profiles.terms_version, '2026-10-02');
    end if;
    return new;
end;
$$;

drop trigger if exists zz_record_signup_terms_acceptance on auth.users;
create trigger zz_record_signup_terms_acceptance
    after insert on auth.users
    for each row execute procedure public.record_signup_terms_acceptance();

create or replace function public.protect_terms_acceptance()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if auth.uid() is not null and tg_op = 'INSERT'
       and (new.terms_accepted or new.terms_accepted_at is not null or new.terms_version is not null) then
        raise exception 'Kullanım şartları onay kaydı doğrudan oluşturulamaz.';
    end if;
    if auth.uid() is not null and tg_op = 'UPDATE'
       and (
           new.terms_accepted is distinct from old.terms_accepted
           or new.terms_accepted_at is distinct from old.terms_accepted_at
           or new.terms_version is distinct from old.terms_version
       ) then
        raise exception 'Kullanım şartları onay kaydı doğrudan değiştirilemez.';
    end if;
    return new;
end;
$$;

drop trigger if exists user_profiles_terms_acceptance_guard on public.user_profiles;
create trigger user_profiles_terms_acceptance_guard
    before update on public.user_profiles
    for each row execute procedure public.protect_terms_acceptance();

notify pgrst, 'reload schema';

commit;
