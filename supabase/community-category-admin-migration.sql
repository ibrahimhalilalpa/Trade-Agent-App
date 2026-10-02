begin;

create table if not exists public.forum_categories (
    slug text primary key check (slug ~ '^[a-z][a-z0-9_]{1,39}$'),
    label text not null check (char_length(label) between 2 and 48),
    sort_order integer not null default 0,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

insert into public.forum_categories (slug, label, sort_order)
values
    ('serbest_konu', 'Serbest Konu', 10),
    ('hisse_analiz', 'Hisse Analiz', 20),
    ('bist30', 'BİST 30', 30),
    ('bist100', 'BİST 100', 40),
    ('bist500', 'BİST 500', 50),
    ('soru_cevap', 'Soru-Cevap', 60),
    ('strateji_egitim', 'Strateji & Eğitim', 70),
    ('makro_ekonomi', 'Makro Ekonomi', 80)
on conflict (slug) do nothing;

alter table public.forum_topics
    drop constraint if exists forum_topics_category_check;

create or replace function public.enforce_active_forum_category()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if not exists (
        select 1 from public.forum_categories
        where slug = new.category and is_active
    ) then
        raise exception 'Forum category is unavailable.';
    end if;
    return new;
end;
$$;

drop trigger if exists forum_topics_active_category_guard on public.forum_topics;
create trigger forum_topics_active_category_guard
    before insert or update of category on public.forum_topics
    for each row execute function public.enforce_active_forum_category();

alter table public.forum_categories enable row level security;
revoke all on public.forum_categories from anon, authenticated;
grant select on public.forum_categories to anon, authenticated;
drop policy if exists "Anyone can read active forum categories" on public.forum_categories;
create policy "Anyone can read active forum categories" on public.forum_categories
    for select to anon, authenticated
    using (is_active or public.has_admin_role());

create or replace function public.admin_forum_user_stats()
returns table (
    user_id uuid,
    topics_count bigint,
    comments_count bigint,
    reports_count bigint,
    pending_reports_count bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if coalesce(auth.role(), '') <> 'service_role' and not public.has_admin_role() then
        raise exception 'Administrator access required.';
    end if;

    return query
    with topic_stats as (
        select t.user_id, count(*)::bigint as total
        from public.forum_topics t
        group by t.user_id
    ), comment_stats as (
        select c.user_id, count(*)::bigint as total
        from public.forum_comments c
        group by c.user_id
    ), report_stats as (
        select r.reported_user_id as user_id,
            count(*)::bigint as total,
            count(*) filter (where r.status = 'pending')::bigint as pending
        from public.forum_reports r
        where r.reported_user_id is not null
        group by r.reported_user_id
    )
    select p.user_id,
        coalesce(ts.total, 0),
        coalesce(cs.total, 0),
        coalesce(rs.total, 0),
        coalesce(rs.pending, 0)
    from public.user_profiles p
    left join topic_stats ts on ts.user_id = p.user_id
    left join comment_stats cs on cs.user_id = p.user_id
    left join report_stats rs on rs.user_id = p.user_id
    order by p.user_id;
end;
$$;

revoke all on function public.enforce_active_forum_category() from public, anon, authenticated;
revoke all on function public.admin_forum_user_stats() from public, anon;
grant execute on function public.admin_forum_user_stats() to authenticated;

notify pgrst, 'reload schema';
commit;
