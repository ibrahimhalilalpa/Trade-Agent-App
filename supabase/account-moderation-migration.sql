begin;

create table if not exists public.account_moderation_reasons (
    id uuid primary key default gen_random_uuid(),
    title text not null check (char_length(trim(title)) between 2 and 80),
    explanation text not null check (char_length(trim(explanation)) between 10 and 1000),
    is_active boolean not null default true,
    created_by uuid references auth.users(id) on delete set null,
    updated_at timestamptz not null default now()
);

create table if not exists public.account_moderation_restrictions (
    user_id uuid primary key references auth.users(id) on delete cascade,
    email_hash text not null,
    restriction_type text not null check (restriction_type in ('suspension', 'closure')),
    reason_id uuid references public.account_moderation_reasons(id) on delete set null,
    reason_title text not null check (char_length(trim(reason_title)) between 2 and 80),
    explanation text not null check (char_length(trim(explanation)) between 10 and 1000),
    starts_at timestamptz not null default now(),
    ends_at timestamptz,
    is_active boolean not null default true,
    moderator_id uuid references auth.users(id) on delete set null,
    updated_at timestamptz not null default now(),
    constraint account_moderation_restrictions_duration check (
        (restriction_type = 'closure' and ends_at is null)
        or (restriction_type = 'suspension' and ends_at > starts_at)
    )
);

create index if not exists account_moderation_restrictions_email_hash_idx
    on public.account_moderation_restrictions(email_hash) where is_active;

create table if not exists public.account_moderation_appeals (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    email text not null,
    restriction_type text not null check (restriction_type in ('suspension', 'closure')),
    reason_title text not null,
    restriction_explanation text not null,
    restriction_ends_at timestamptz,
    details text not null check (char_length(trim(details)) between 20 and 1000),
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'superseded')),
    admin_note text,
    moderator_id uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    decided_at timestamptz
);

alter table public.account_moderation_appeals
    drop constraint if exists account_moderation_appeals_status_check;
alter table public.account_moderation_appeals
    add constraint account_moderation_appeals_status_check
    check (status in ('pending', 'approved', 'rejected', 'superseded'));

create index if not exists account_moderation_appeals_status_created_idx
    on public.account_moderation_appeals(status, created_at desc);
create index if not exists account_moderation_appeals_user_created_idx
    on public.account_moderation_appeals(user_id, created_at desc);
create unique index if not exists account_moderation_appeals_one_open_per_user_idx
    on public.account_moderation_appeals(user_id) where status = 'pending';

alter table public.account_moderation_reasons enable row level security;
alter table public.account_moderation_restrictions enable row level security;
alter table public.account_moderation_appeals enable row level security;

drop policy if exists "Admins manage account moderation reasons" on public.account_moderation_reasons;
create policy "Admins manage account moderation reasons"
    on public.account_moderation_reasons for all to authenticated
    using (public.forum_is_admin()) with check (public.forum_is_admin());

drop policy if exists "Admins read account moderation restrictions" on public.account_moderation_restrictions;
create policy "Admins read account moderation restrictions"
    on public.account_moderation_restrictions for select to authenticated
    using (public.forum_is_admin());

drop policy if exists "Admins read account moderation appeals" on public.account_moderation_appeals;
create policy "Admins read account moderation appeals"
    on public.account_moderation_appeals for select to authenticated
    using (public.forum_is_admin());

grant select, insert, update, delete on public.account_moderation_reasons to authenticated;
grant select on public.account_moderation_restrictions, public.account_moderation_appeals to authenticated;
grant all on public.account_moderation_reasons, public.account_moderation_restrictions,
    public.account_moderation_appeals to service_role;

insert into public.account_moderation_reasons (title, explanation)
select seed.title, seed.explanation
from (values
    ('Topluluk kurallarının ihlali', 'Paylaşımlarınızın topluluk kurallarına uygunluğunu gözden geçirmeniz ve benzer ihlalleri tekrarlamamanız gerekir.'),
    ('Spam veya yanıltıcı içerik', 'Hesap etkinliğiniz spam, istenmeyen tanıtım veya yanıltıcı içerik politikamızla çelişiyor.'),
    ('Taciz veya hakaret', 'Başka kullanıcılara yönelik taciz, hakaret veya hedef gösterme içeren davranışlar incelenmiştir.'),
    ('Güvenlik incelemesi', 'Hesabınızın güvenliği veya olağan dışı etkinlik nedeniyle erişim geçici olarak kısıtlanmıştır.'),
    ('Diğer', 'Hesap etkinliğiniz platform kurallarına göre incelenmiş ve bu işlem uygulanmıştır.')
) as seed(title, explanation)
where not exists (
    select 1 from public.account_moderation_reasons existing
    where existing.title = seed.title
);

commit;
