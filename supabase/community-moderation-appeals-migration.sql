create table if not exists public.forum_moderation_appeals (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    details text not null check (char_length(trim(details)) between 20 and 1000),
    status text not null default 'pending' check (status in ('pending', 'reviewing', 'approved', 'rejected')),
    admin_note text,
    moderator_id uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    decided_at timestamptz
);

create index if not exists forum_moderation_appeals_status_created_idx
    on public.forum_moderation_appeals(status, created_at desc);
create index if not exists forum_moderation_appeals_user_created_idx
    on public.forum_moderation_appeals(user_id, created_at desc);
create unique index if not exists forum_moderation_appeals_one_open_per_user_idx
    on public.forum_moderation_appeals(user_id)
    where status in ('pending', 'reviewing');

alter table public.forum_moderation_appeals enable row level security;

drop policy if exists "Users can view their own forum appeals" on public.forum_moderation_appeals;
create policy "Users can view their own forum appeals"
    on public.forum_moderation_appeals for select to authenticated
    using (user_id = auth.uid() or public.forum_is_admin());

drop policy if exists "Users can submit their own forum appeals" on public.forum_moderation_appeals;
create policy "Users can submit their own forum appeals"
    on public.forum_moderation_appeals for insert to authenticated
    with check (user_id = auth.uid() and status = 'pending' and moderator_id is null and admin_note is null);

drop policy if exists "Admins can manage forum appeals" on public.forum_moderation_appeals;
create policy "Admins can manage forum appeals"
    on public.forum_moderation_appeals for all to authenticated
    using (public.forum_is_admin())
    with check (public.forum_is_admin());

grant select, insert on public.forum_moderation_appeals to authenticated;
grant all on public.forum_moderation_appeals to service_role;
