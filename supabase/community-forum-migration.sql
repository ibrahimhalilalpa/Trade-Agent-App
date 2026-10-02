begin;

alter table public.user_activity_logs drop constraint if exists user_activity_logs_event_type_check;
alter table public.user_activity_logs add constraint user_activity_logs_event_type_check
    check (event_type in (
        'login', 'logout', 'user_registered', 'profile_updated', 'password_changed', 'password_failed',
        'password_reset_requested', 'list_created', 'list_renamed', 'list_deleted',
        'stock_added', 'stock_removed', 'portfolio_order', 'portfolio_cash_adjustment',
        'lesson_completed', 'lesson_uncompleted', 'admin_cash_adjustment',
        'admin_role_changed', 'admin_account_status', 'admin_order_status',
        'admin_alert_status', 'admin_position_adjusted', 'admin_rank_adjusted',
        'admin_profile_updated', 'admin_user_invited', 'forum_topic_created',
        'account_freeze_requested', 'account_reactivated', 'account_deletion_requested'
    ));

alter table public.user_profiles
    add column if not exists avatar_url text,
    add column if not exists gender text not null default 'unspecified'
        check (gender in ('male', 'female', 'unspecified')),
    add column if not exists xp_points integer not null default 0 check (xp_points >= 0),
    add column if not exists rank_title text not null default 'Çaylak',
    add column if not exists is_banned boolean not null default false,
    add column if not exists forum_ban_until timestamptz,
    add column if not exists is_profile_public boolean not null default true;

create table if not exists public.forum_topics (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    title text not null check (char_length(title) between 3 and 180),
    content text not null check (char_length(content) between 1 and 14000),
    category text not null check (category in (
        'serbest_konu', 'hisse_analiz', 'bist30', 'bist100', 'bist500',
        'soru_cevap', 'strateji_egitim', 'makro_ekonomi'
    )),
    related_symbol text check (related_symbol is null or related_symbol ~ '^[A-Z0-9]{3,6}$'),
    cover_image_url text,
    images text[] not null default '{}',
    tags text[] not null default '{}',
    visibility text not null default 'public' check (visibility in ('public', 'followers')),
    is_pinned boolean not null default false,
    is_closed boolean not null default false,
    helpful_count integer not null default 0 check (helpful_count >= 0),
    unhelpful_count integer not null default 0 check (unhelpful_count >= 0),
    views_count integer not null default 0 check (views_count >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create or replace function public.forum_tags_are_valid(p_tags text[])
returns boolean
language sql
immutable
set search_path = public
as $$
    select coalesce(cardinality(p_tags), 0) <= 5
        and not exists (
            select 1 from unnest(coalesce(p_tags, '{}'::text[])) tag
            where char_length(tag) not between 1 and 30
                or tag !~ '^[[:alnum:]_-]+$'
        )
$$;

alter table public.forum_topics
    add column if not exists images text[] not null default '{}',
    add column if not exists tags text[] not null default '{}',
    add column if not exists visibility text not null default 'public';
alter table public.forum_topics drop constraint if exists forum_topics_content_check;
alter table public.forum_topics add constraint forum_topics_content_check
    check (char_length(content) between 1 and 14000);
alter table public.forum_topics drop constraint if exists forum_topics_images_check;
alter table public.forum_topics add constraint forum_topics_images_check
    check (cardinality(images) <= 5 and array_position(images, null) is null);
alter table public.forum_topics drop constraint if exists forum_topics_tags_check;
alter table public.forum_topics add constraint forum_topics_tags_check
    check (public.forum_tags_are_valid(tags) and array_position(tags, null) is null);
alter table public.forum_topics drop constraint if exists forum_topics_visibility_check;
alter table public.forum_topics add constraint forum_topics_visibility_check
    check (visibility in ('public', 'followers'));

create table if not exists public.forum_comments (
    id uuid primary key default gen_random_uuid(),
    topic_id uuid not null references public.forum_topics(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    content text not null check (char_length(content) between 1 and 6000),
    attachment_url text,
    helpful_count integer not null default 0 check (helpful_count >= 0),
    unhelpful_count integer not null default 0 check (unhelpful_count >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.user_follows (
    follower_id uuid not null references auth.users(id) on delete cascade,
    followed_id uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (follower_id, followed_id),
    check (follower_id <> followed_id)
);

create table if not exists public.topic_votes (
    id uuid primary key default gen_random_uuid(),
    topic_id uuid references public.forum_topics(id) on delete cascade,
    comment_id uuid references public.forum_comments(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    vote text not null check (vote in ('helpful', 'unhelpful')),
    created_at timestamptz not null default now(),
    check ((topic_id is null) <> (comment_id is null))
);

create unique index if not exists topic_votes_user_topic_unique
    on public.topic_votes(user_id, topic_id) where topic_id is not null;
create unique index if not exists topic_votes_user_comment_unique
    on public.topic_votes(user_id, comment_id) where comment_id is not null;
create index if not exists forum_topics_feed_idx
    on public.forum_topics(is_pinned desc, created_at desc);
create index if not exists forum_topics_symbol_idx
    on public.forum_topics(related_symbol, created_at desc) where related_symbol is not null;
create index if not exists forum_topics_category_idx
    on public.forum_topics(category, created_at desc);
create index if not exists forum_comments_topic_created_idx
    on public.forum_comments(topic_id, created_at);
create index if not exists user_follows_followed_idx
    on public.user_follows(followed_id);

create table if not exists public.forum_topic_views (
    topic_id uuid not null references public.forum_topics(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    view_date date not null default (timezone('utc', now()))::date,
    primary key (topic_id, user_id, view_date)
);

create or replace function public.forum_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
    select coalesce(auth.role(), '') = 'service_role' or exists (
        select 1 from public.user_roles r
        where r.user_id = auth.uid() and r.role in ('admin', 'super_admin')
    )
$$;

create or replace function public.forum_profile_is_visible(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
    select exists (
        select 1 from public.user_profiles p
        where p.user_id = p_user_id
          and (p.is_profile_public or p.user_id = auth.uid() or public.forum_is_admin())
    )
$$;

create or replace function public.forum_topic_is_visible(p_owner_id uuid, p_visibility text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
    select p_owner_id = auth.uid()
        or public.forum_is_admin()
        or (p_visibility = 'public' and public.forum_profile_is_visible(p_owner_id))
        or (p_visibility = 'followers' and auth.uid() is not null and exists (
            select 1 from public.user_follows f
            where f.follower_id = auth.uid() and f.followed_id = p_owner_id
        ))
$$;

revoke all on function public.forum_topic_is_visible(uuid, text) from public;
grant execute on function public.forum_topic_is_visible(uuid, text) to anon, authenticated;

alter table public.forum_topics enable row level security;
alter table public.forum_comments enable row level security;
alter table public.user_follows enable row level security;
alter table public.topic_votes enable row level security;
alter table public.forum_topic_views enable row level security;

grant select, insert, update, delete on public.forum_topics, public.forum_comments,
    public.user_follows, public.topic_votes to authenticated;
grant select on public.forum_topics, public.forum_comments to anon;
grant all on public.forum_topics, public.forum_comments, public.user_follows,
    public.topic_votes, public.forum_topic_views to service_role;

drop policy if exists "Public can read visible forum topics" on public.forum_topics;
create policy "Public can read visible forum topics" on public.forum_topics
    for select to anon, authenticated
    using (public.forum_topic_is_visible(forum_topics.user_id, forum_topics.visibility));

drop policy if exists "Authors and admins create forum topics" on public.forum_topics;
create policy "Authors and admins create forum topics" on public.forum_topics
    for insert to authenticated
    with check (user_id = auth.uid()
        and exists (select 1 from public.user_profiles p where p.user_id = auth.uid()
            and not p.is_banned and (p.forum_ban_until is null or p.forum_ban_until <= now())));

drop policy if exists "Authors can edit recent topics and admins can edit all" on public.forum_topics;
create policy "Authors can edit recent topics and admins can edit all" on public.forum_topics
    for update to authenticated
    using (public.forum_is_admin() or (user_id = auth.uid() and created_at > now() - interval '1 hour'))
    with check (public.forum_is_admin() or (user_id = auth.uid() and created_at > now() - interval '1 hour'));

drop policy if exists "Authors and admins delete forum topics" on public.forum_topics;
create policy "Authors and admins delete forum topics" on public.forum_topics
    for delete to authenticated using (user_id = auth.uid() or public.forum_is_admin());

drop policy if exists "Public can read comments on visible topics" on public.forum_comments;
create policy "Public can read comments on visible topics" on public.forum_comments
    for select to anon, authenticated using (exists (
        select 1 from public.forum_topics t where t.id = topic_id
            and public.forum_topic_is_visible(t.user_id, t.visibility)
    ));

drop policy if exists "Eligible users can add forum comments" on public.forum_comments;
create policy "Eligible users can add forum comments" on public.forum_comments
    for insert to authenticated with check (
        user_id = auth.uid()
        and exists (
            select 1 from public.user_profiles p where p.user_id = auth.uid()
              and not p.is_banned and (p.forum_ban_until is null or p.forum_ban_until <= now())
        )
        and exists (select 1 from public.forum_topics t where t.id = topic_id and not t.is_closed)
    );

drop policy if exists "Authors can edit recent comments and admins can edit all" on public.forum_comments;
create policy "Authors can edit recent comments and admins can edit all" on public.forum_comments
    for update to authenticated
    using (public.forum_is_admin() or (user_id = auth.uid() and created_at > now() - interval '1 hour'))
    with check (public.forum_is_admin() or (user_id = auth.uid() and created_at > now() - interval '1 hour'));

drop policy if exists "Authors and admins delete forum comments" on public.forum_comments;
create policy "Authors and admins delete forum comments" on public.forum_comments
    for delete to authenticated using (user_id = auth.uid() or public.forum_is_admin());

drop policy if exists "Public can read follows" on public.user_follows;
drop policy if exists "Users follow and unfollow themselves" on public.user_follows;
create policy "Users follow and unfollow themselves" on public.user_follows
    for all to authenticated using (follower_id = auth.uid())
    with check (follower_id = auth.uid() and followed_id <> auth.uid());

drop policy if exists "Public can read topic votes" on public.topic_votes;
drop policy if exists "Users can read their own topic votes" on public.topic_votes;
create policy "Users can read their own topic votes" on public.topic_votes
    for select to authenticated using (user_id = auth.uid() or public.forum_is_admin());
drop policy if exists "Users manage their own votes" on public.topic_votes;
create policy "Users manage their own votes" on public.topic_votes
    for all to authenticated using (
        user_id = auth.uid() and (
            (topic_id is not null and exists (
                select 1 from public.forum_topics t
                where t.id = topic_votes.topic_id and public.forum_topic_is_visible(t.user_id, t.visibility)
            ))
            or (comment_id is not null and exists (
                select 1 from public.forum_comments c
                join public.forum_topics t on t.id = c.topic_id
                where c.id = topic_votes.comment_id and public.forum_topic_is_visible(t.user_id, t.visibility)
            ))
        )
    )
    with check (user_id = auth.uid() and (
        (topic_id is not null and exists (
            select 1 from public.forum_topics t
            where t.id = topic_votes.topic_id and public.forum_topic_is_visible(t.user_id, t.visibility)
        ))
        or (comment_id is not null and exists (
            select 1 from public.forum_comments c
            join public.forum_topics t on t.id = c.topic_id
            where c.id = topic_votes.comment_id and public.forum_topic_is_visible(t.user_id, t.visibility)
        ))
    ));

drop policy if exists "Users read own topic view rows" on public.forum_topic_views;
create policy "Users read own topic view rows" on public.forum_topic_views
    for select to authenticated using (user_id = auth.uid());

create or replace function public.clean_forum_text(p_text text)
returns text
language sql
immutable
set search_path = public
as $$
    select regexp_replace(
        coalesce(p_text, ''),
        '\m(amcik|amk|amq|aq|ananı|ananin|anneni|orospu|piç|pic|sik|sikiş|sikis|siktir|sikeyim|sikiyim|sikerim|sikik|sikim|yarrak|yarak|göt|got|kahpe|pezevenk|ibne|yavşak|yavsak|şerefsiz|serefsiz|boktan|dangalak|gerizekalı|gerizekali|fuck|shit|bitch|asshole|dick|cunt|bastard|slut|whore)\M',
        '***',
        'gi'
    )
$$;

create or replace function public.enforce_forum_profile_rules()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
    if not public.forum_is_admin() and pg_trigger_depth() <= 1 and tg_op = 'UPDATE' and (
        new.xp_points is distinct from old.xp_points
        or new.rank_title is distinct from old.rank_title
        or new.is_banned is distinct from old.is_banned
        or new.forum_ban_until is distinct from old.forum_ban_until
    ) then
        raise exception 'Only administrators can change forum rank or ban status.';
    end if;
    if coalesce(btrim(new.username), '') <> '' then
        new.username := lower(btrim(new.username));
        if public.clean_forum_text(new.username) is distinct from new.username then
            raise exception 'Username contains prohibited language.';
        end if;
    end if;
    new.bio := public.clean_forum_text(left(coalesce(new.bio, ''), 280));
    if new.avatar_url is not null and (
        char_length(new.avatar_url) > 2048
        or new.avatar_url !~ '^https://'
    ) then
        raise exception 'Avatar URL must be an HTTPS URL.';
    end if;
    return new;
end;
$$;

drop trigger if exists user_profiles_forum_rules on public.user_profiles;
create trigger user_profiles_forum_rules before insert or update on public.user_profiles
    for each row execute function public.enforce_forum_profile_rules();

create or replace function public.refresh_forum_rank_fields()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
    v_rank jsonb;
begin
    v_rank := public.get_trader_rank(new.user_id);
    update public.user_profiles
    set xp_points = greatest(0, coalesce((v_rank ->> 'xp')::integer, 0)),
        rank_title = coalesce(v_rank ->> 'rank', 'Çaylak')
    where user_id = new.user_id;
    return new;
end;
$$;

drop trigger if exists user_profiles_refresh_forum_rank on public.user_profiles;
create trigger user_profiles_refresh_forum_rank
    after update of rank_xp_adjustment on public.user_profiles
    for each row execute function public.refresh_forum_rank_fields();

create or replace function public.enforce_forum_content_rules()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
    v_is_admin boolean := public.forum_is_admin();
begin
    if tg_op = 'INSERT' then
        if coalesce(auth.role(), '') <> 'service_role' and new.user_id is distinct from auth.uid() then
            raise exception 'Forum content must belong to the authenticated user.';
        end if;
        if not v_is_admin and exists (
            select 1 from public.user_profiles p where p.user_id = new.user_id
              and (p.is_banned or (p.forum_ban_until is not null and p.forum_ban_until > now()))
        ) then
            raise exception 'This account is not allowed to post in the forum.';
        end if;
    else
        if new.user_id is distinct from old.user_id or new.id is distinct from old.id
            or new.created_at is distinct from old.created_at then
            raise exception 'Forum content ownership cannot be changed.';
        end if;
        if not v_is_admin and pg_trigger_depth() <= 1
            and old.created_at <= now() - interval '1 hour' then
            raise exception 'The one-hour edit window has expired.';
        end if;
        if not v_is_admin and pg_trigger_depth() <= 1 then
            if tg_table_name = 'forum_topics' then
                if new.is_pinned is distinct from old.is_pinned or new.is_closed is distinct from old.is_closed
                    or new.helpful_count is distinct from old.helpful_count
                    or new.unhelpful_count is distinct from old.unhelpful_count
                    or new.views_count is distinct from old.views_count then
                    raise exception 'Only administrators can moderate topics.';
                end if;
            elsif tg_table_name = 'forum_comments' then
                if new.topic_id is distinct from old.topic_id
                    or new.helpful_count is distinct from old.helpful_count
                    or new.unhelpful_count is distinct from old.unhelpful_count then
                    raise exception 'Only vote records can change comment vote counts.';
                end if;
            end if;
        end if;
        if pg_trigger_depth() <= 1 then
            new.updated_at := now();
        end if;
    end if;

    if tg_op = 'INSERT' or pg_trigger_depth() <= 1 then
        if tg_table_name = 'forum_topics' then
            new.title := public.clean_forum_text(new.title);
            new.content := public.clean_forum_text(new.content);
            new.related_symbol := nullif(upper(trim(new.related_symbol)), '');
            new.tags := coalesce((
                select array_agg(distinct lower(trim(public.clean_forum_text(tag))))
                from unnest(coalesce(new.tags, '{}'::text[])) tag
                where trim(tag) <> ''
            ), '{}'::text[]);
            if right(rtrim(new.content), char_length('Yasal Uyarı: Burada yer alan yatırım bilgi, yorum ve tavsiyeleri yatırım danışmanlığı kapsamında değildir. Yer alan görüşler kişisel analizlere dayanmaktadır.'))
                <> 'Yasal Uyarı: Burada yer alan yatırım bilgi, yorum ve tavsiyeleri yatırım danışmanlığı kapsamında değildir. Yer alan görüşler kişisel analizlere dayanmaktadır.' then
                new.content := rtrim(new.content) || E'\n\n' ||
                    'Yasal Uyarı: Burada yer alan yatırım bilgi, yorum ve tavsiyeleri yatırım danışmanlığı kapsamında değildir. Yer alan görüşler kişisel analizlere dayanmaktadır.';
            end if;
            if char_length(new.content) > 14000 then
                raise exception 'Topic content exceeds the maximum length including the required disclaimer.';
            end if;
        else
            new.content := public.clean_forum_text(new.content);
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists forum_topics_content_rules on public.forum_topics;
create trigger forum_topics_content_rules before insert or update on public.forum_topics
    for each row execute function public.enforce_forum_content_rules();
drop trigger if exists forum_comments_content_rules on public.forum_comments;
create trigger forum_comments_content_rules before insert or update on public.forum_comments
    for each row execute function public.enforce_forum_content_rules();

create or replace function public.log_forum_topic_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.user_activity_logs(user_id, event_type, description, metadata)
    values (
        new.user_id,
        'forum_topic_created',
        'Forum konusu oluşturuldu: ' || left(new.title, 120),
        jsonb_build_object('topic_id', new.id, 'category', new.category, 'visibility', new.visibility,
            'related_symbol', new.related_symbol, 'tags', new.tags)
    );
    return new;
end;
$$;

drop trigger if exists forum_topics_activity_log on public.forum_topics;
create trigger forum_topics_activity_log after insert on public.forum_topics
    for each row execute function public.log_forum_topic_created();

create or replace function public.sync_forum_vote_counts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_topic_id uuid;
    v_comment_id uuid;
begin
    if tg_table_schema <> 'public' or tg_table_name <> 'topic_votes' then
        if tg_op = 'DELETE' then return old; end if;
        return new;
    end if;

    if tg_op = 'DELETE' then
        v_topic_id := old.topic_id;
        v_comment_id := old.comment_id;
    else
        v_topic_id := new.topic_id;
        v_comment_id := new.comment_id;
    end if;

    if tg_op = 'UPDATE' and old.topic_id is not null and old.topic_id is distinct from new.topic_id then
        update public.forum_topics t set
            helpful_count = (select count(*)::integer from public.topic_votes v where v.topic_id = t.id and v.vote = 'helpful'),
            unhelpful_count = (select count(*)::integer from public.topic_votes v where v.topic_id = t.id and v.vote = 'unhelpful')
        where t.id = old.topic_id;
    elsif tg_op = 'UPDATE' and old.comment_id is not null and old.comment_id is distinct from new.comment_id then
        update public.forum_comments c set
            helpful_count = (select count(*)::integer from public.topic_votes v where v.comment_id = c.id and v.vote = 'helpful'),
            unhelpful_count = (select count(*)::integer from public.topic_votes v where v.comment_id = c.id and v.vote = 'unhelpful')
        where c.id = old.comment_id;
    end if;
    if v_topic_id is not null then
        update public.forum_topics t set
            helpful_count = (select count(*)::integer from public.topic_votes v where v.topic_id = t.id and v.vote = 'helpful'),
            unhelpful_count = (select count(*)::integer from public.topic_votes v where v.topic_id = t.id and v.vote = 'unhelpful')
        where t.id = v_topic_id;
    elsif v_comment_id is not null then
        update public.forum_comments c set
            helpful_count = (select count(*)::integer from public.topic_votes v where v.comment_id = c.id and v.vote = 'helpful'),
            unhelpful_count = (select count(*)::integer from public.topic_votes v where v.comment_id = c.id and v.vote = 'unhelpful')
        where c.id = v_comment_id;
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
end;
$$;

drop trigger if exists topic_votes_sync_counts on public.topic_votes;
create trigger topic_votes_sync_counts after insert or update or delete on public.topic_votes
    for each row execute function public.sync_forum_vote_counts();

create or replace function public.increment_forum_topic_views()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if tg_table_schema <> 'public' or tg_table_name <> 'forum_topic_views' then
        if tg_op = 'DELETE' then return old; end if;
        return new;
    end if;

    update public.forum_topics
    set views_count = views_count + 1
    where id = new.topic_id;
    return new;
end;
$$;

drop trigger if exists forum_topic_views_increment_count on public.forum_topic_views;
create trigger forum_topic_views_increment_count after insert on public.forum_topic_views
    for each row execute function public.increment_forum_topic_views();

create or replace function public.record_forum_topic_view(p_topic_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
    if auth.uid() is null then return; end if;
    insert into public.forum_topic_views(topic_id, user_id)
    select t.id, auth.uid() from public.forum_topics t
    where t.id = p_topic_id and public.forum_topic_is_visible(t.user_id, t.visibility)
    on conflict do nothing;
end;
$$;

create or replace function public.set_forum_vote(p_topic_id uuid, p_comment_id uuid, p_vote text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
    v_user_id uuid := auth.uid();
    v_owner_id uuid;
    v_visibility text;
    v_vote_id uuid;
    v_vote text;
    v_removed boolean := false;
    v_affected integer;
begin
    if v_user_id is null then
        raise exception 'Authentication required.';
    end if;
    if (p_topic_id is null) = (p_comment_id is null) then
        raise exception 'Exactly one topic or comment must be specified.';
    end if;
    if p_vote is not null and p_vote not in ('helpful', 'unhelpful') then
        raise exception 'Vote must be helpful, unhelpful, or null.';
    end if;

    if p_topic_id is not null then
        select t.user_id, t.visibility into v_owner_id, v_visibility
        from public.forum_topics t where t.id = p_topic_id;
    else
        select t.user_id, t.visibility into v_owner_id, v_visibility
        from public.forum_comments c
        join public.forum_topics t on t.id = c.topic_id
        where c.id = p_comment_id;
    end if;
    if v_owner_id is null or not public.forum_topic_is_visible(v_owner_id, v_visibility) then
        raise exception 'Topic or comment is not available.';
    end if;

    if p_vote is null then
        if p_topic_id is not null then
            delete from public.topic_votes where user_id = v_user_id and topic_id = p_topic_id;
        else
            delete from public.topic_votes where user_id = v_user_id and comment_id = p_comment_id;
        end if;
        get diagnostics v_affected = row_count;
        v_removed := v_affected > 0;
        return jsonb_build_object('removed', v_removed);
    end if;

    if p_topic_id is not null then
        insert into public.topic_votes(user_id, topic_id, vote)
        values (v_user_id, p_topic_id, p_vote)
        on conflict (user_id, topic_id) where topic_id is not null
        do update set vote = excluded.vote
        returning id, vote into v_vote_id, v_vote;
    else
        insert into public.topic_votes(user_id, comment_id, vote)
        values (v_user_id, p_comment_id, p_vote)
        on conflict (user_id, comment_id) where comment_id is not null
        do update set vote = excluded.vote
        returning id, vote into v_vote_id, v_vote;
    end if;
    return jsonb_build_object('id', v_vote_id, 'vote', v_vote, 'removed', false);
end;
$$;

drop function if exists public.forum_public_profiles(uuid[]);
create function public.forum_public_profiles(p_user_ids uuid[])
returns table (
    user_id uuid, username text, display_name text, avatar_url text, bio text,
    gender text, xp_points integer, rank_title text, is_profile_public boolean,
    followers_count bigint, following_count bigint, is_following boolean
)
language sql
stable
security definer
set search_path = public, auth
as $$
    select p.user_id, p.username, p.display_name, p.avatar_url, p.bio, p.gender,
        p.xp_points,
        p.rank_title,
        p.is_profile_public,
        (select count(*) from public.user_follows f where f.followed_id = p.user_id) as followers_count,
        (select count(*) from public.user_follows f where f.follower_id = p.user_id) as following_count,
        exists(select 1 from public.user_follows f where f.follower_id = auth.uid() and f.followed_id = p.user_id) as is_following
    from public.user_profiles p
    where p.user_id = any(p_user_ids)
      and (p.is_profile_public or p.user_id = auth.uid() or public.forum_is_admin())
$$;

drop function if exists public.forum_public_profile(text);
create function public.forum_public_profile(p_username text)
returns table (
    user_id uuid, username text, display_name text, avatar_url text, bio text,
    gender text, xp_points integer, rank_title text, is_profile_public boolean,
    followers_count bigint, following_count bigint, is_following boolean
)
language sql
stable
security definer
set search_path = public, auth
as $$
    select p.user_id, p.username, p.display_name, p.avatar_url, p.bio, p.gender,
        p.xp_points,
        p.rank_title,
        p.is_profile_public,
        (select count(*) from public.user_follows f where f.followed_id = p.user_id) as followers_count,
        (select count(*) from public.user_follows f where f.follower_id = p.user_id) as following_count,
        exists(select 1 from public.user_follows f where f.follower_id = auth.uid() and f.followed_id = p.user_id) as is_following
    from public.user_profiles p
    where lower(p.username) = lower(p_username)
      and (p.is_profile_public or p.user_id = auth.uid() or public.forum_is_admin())
$$;

create or replace function public.forum_public_helpful_topics(p_user_id uuid)
returns table (topic_id uuid)
language sql
stable
security definer
set search_path = public, auth
as $$
    select v.topic_id
    from public.topic_votes v
    join public.user_profiles p on p.user_id = v.user_id
    where v.user_id = p_user_id
      and v.vote = 'helpful'
      and v.topic_id is not null
      and (p.is_profile_public or p.user_id = auth.uid() or public.forum_is_admin())
    order by v.created_at desc
    limit 20
$$;

revoke all on function public.forum_is_admin() from public;
revoke all on function public.forum_profile_is_visible(uuid) from public;
grant execute on function public.forum_is_admin() to anon, authenticated;
grant execute on function public.forum_profile_is_visible(uuid) to anon, authenticated;
revoke all on function public.clean_forum_text(text) from public, anon, authenticated;
revoke all on function public.enforce_forum_profile_rules() from public, anon, authenticated;
revoke all on function public.refresh_forum_rank_fields() from public, anon, authenticated;
revoke all on function public.enforce_forum_content_rules() from public, anon, authenticated;
revoke all on function public.sync_forum_vote_counts() from public, anon, authenticated;
revoke all on function public.increment_forum_topic_views() from public, anon, authenticated;
revoke all on function public.record_forum_topic_view(uuid) from public, anon;
revoke all on function public.set_forum_vote(uuid, uuid, text) from public, anon;
revoke all on function public.forum_public_profiles(uuid[]) from public, anon;
revoke all on function public.forum_public_profile(text) from public, anon;
revoke all on function public.forum_public_helpful_topics(uuid) from public, anon;
grant execute on function public.record_forum_topic_view(uuid) to authenticated;
grant execute on function public.set_forum_vote(uuid, uuid, text) to authenticated;
grant execute on function public.forum_public_profiles(uuid[]) to anon, authenticated;
grant execute on function public.forum_public_profile(text) to anon, authenticated;
grant execute on function public.forum_public_helpful_topics(uuid) to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-media', 'community-media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

drop policy if exists "Community images are public" on storage.objects;
create policy "Community images are public" on storage.objects
    for select to anon, authenticated using (bucket_id = 'community-media');
drop policy if exists "Eligible users upload community images" on storage.objects;
create policy "Eligible users upload community images" on storage.objects
    for insert to authenticated with check (
        bucket_id = 'community-media'
        and (storage.foldername(name))[1] = auth.uid()::text
        and exists (select 1 from public.user_profiles p where p.user_id = auth.uid()
            and not p.is_banned and (p.forum_ban_until is null or p.forum_ban_until <= now()))
    );
drop policy if exists "Users and admins delete community images" on storage.objects;
create policy "Users and admins delete community images" on storage.objects
    for delete to authenticated using (
        bucket_id = 'community-media'
        and ((storage.foldername(name))[1] = auth.uid()::text or public.has_admin_role())
    );

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.user_portfolios (user_id, balance)
    values (new.id, 100000)
    on conflict (user_id) do nothing;

    insert into public.user_profiles (user_id, full_name, display_name, gender, avatar_url)
    values (
        new.id,
        coalesce(new.raw_user_meta_data->>'full_name', ''),
        coalesce(new.raw_user_meta_data->>'display_name', ''),
        case when new.raw_user_meta_data->>'gender' in ('male', 'female', 'unspecified')
            then new.raw_user_meta_data->>'gender' else 'unspecified' end,
        case when new.raw_user_meta_data->>'avatar_url' ~ '^https://' and char_length(new.raw_user_meta_data->>'avatar_url') <= 2048
            then new.raw_user_meta_data->>'avatar_url' else null end
    )
    on conflict (user_id) do nothing;

    insert into public.watchlists (user_id, name, is_favorites) values
        (new.id, 'Favoriler', true),
        (new.id, 'Alacaklarım', false),
        (new.id, 'Aldıklarım', false),
        (new.id, 'Almayı düşündüklerim', false)
    on conflict (user_id, name) do nothing;

    insert into public.user_activity_logs (user_id, event_type, description, metadata)
    select new.id,
        'user_registered',
        'Kullanıcı kaydı: cinsiyet ' ||
            case p.gender when 'female' then 'Kadın' when 'male' then 'Erkek' else 'Belirtmedi' end ||
            '; profil görseli ' || case when p.avatar_url is null then 'yok' else 'eklendi' end ||
            '; profil ' || case when p.is_profile_public then 'herkese açık' else 'gizli' end ||
            '; liderlik görünürlüğü ' || case when p.leaderboard_visible then 'açık' else 'kapalı' end ||
            '; TL kazanç paylaşımı ' || case when p.leaderboard_gain_visible then 'açık' else 'kapalı' end || '.',
        jsonb_build_object(
            'registration_method', coalesce(new.raw_app_meta_data->>'provider', 'email'),
            'avatar_url', p.avatar_url,
            'gender', p.gender,
            'is_profile_public', p.is_profile_public,
            'leaderboard_visible', p.leaderboard_visible,
            'leaderboard_gain_visible', p.leaderboard_gain_visible
        )
    from public.user_profiles p
    where p.user_id = new.id;
    return new;
end;
$$;

create or replace function public.admin_list_users_with_profile()
returns table (
    id uuid,
    email text,
    "createdAt" timestamptz,
    "lastSignInAt" timestamptz,
    "emailVerifiedAt" timestamptz,
    banned boolean,
    "displayName" text,
    role text,
    "avatarUrl" text,
    gender text,
    "isProfilePublic" boolean,
    "leaderboardVisible" boolean,
    "leaderboardGainVisible" boolean,
    balance numeric,
    "portfolioValue" numeric,
    "realizedPnl" numeric,
    "unrealizedPnl" numeric,
    "positionsCount" bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if coalesce(auth.role(), '') <> 'service_role' and not public.has_admin_role() then
        raise exception 'Administrator access required.';
    end if;
    return query
    select u.id, u.email, u."createdAt", u."lastSignInAt", u."emailVerifiedAt", u.banned,
        u."displayName", u.role, p.avatar_url, coalesce(p.gender, 'unspecified'),
        coalesce(p.is_profile_public, true), coalesce(p.leaderboard_visible, true),
        coalesce(p.leaderboard_gain_visible, true), u.balance, u."portfolioValue",
        u."realizedPnl", u."unrealizedPnl", u."positionsCount"
    from public.admin_list_users() u
    left join public.user_profiles p on p.user_id = u.id;
end;
$$;

revoke all on function public.admin_list_users_with_profile() from public;
grant execute on function public.admin_list_users_with_profile() to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
