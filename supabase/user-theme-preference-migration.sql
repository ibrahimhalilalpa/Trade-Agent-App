begin;

alter table public.user_profiles
    add column if not exists theme text not null default 'dark';

alter table public.user_profiles
    drop constraint if exists user_profiles_theme_check;
alter table public.user_profiles
    add constraint user_profiles_theme_check check (theme in ('dark', 'light'));

notify pgrst, 'reload schema';
commit;