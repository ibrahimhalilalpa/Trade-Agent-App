begin;

alter table public.forum_topics
    add column if not exists visibility text not null default 'public',
    add column if not exists helpful_count integer not null default 0,
    add column if not exists unhelpful_count integer not null default 0,
    add column if not exists views_count integer not null default 0,
    add column if not exists is_pinned boolean not null default false,
    add column if not exists is_closed boolean not null default false,
    add column if not exists updated_at timestamptz not null default now();

alter table public.forum_comments
    add column if not exists helpful_count integer not null default 0,
    add column if not exists unhelpful_count integer not null default 0,
    add column if not exists updated_at timestamptz not null default now();

alter table public.topic_votes
    add column if not exists id uuid default gen_random_uuid(),
    add column if not exists topic_id uuid references public.forum_topics(id) on delete cascade,
    add column if not exists comment_id uuid references public.forum_comments(id) on delete cascade,
    add column if not exists user_id uuid references auth.users(id) on delete cascade,
    add column if not exists vote text,
    add column if not exists created_at timestamptz not null default now();

alter table public.topic_votes alter column id set default gen_random_uuid();
update public.topic_votes set id = gen_random_uuid() where id is null;
alter table public.topic_votes alter column id set not null;

with ranked_topic_votes as (
    select ctid, row_number() over (
        partition by user_id, topic_id order by created_at desc nulls last, id
    ) as duplicate_rank
    from public.topic_votes
    where topic_id is not null
)
delete from public.topic_votes v
using ranked_topic_votes ranked
where v.ctid = ranked.ctid and ranked.duplicate_rank > 1;

with ranked_comment_votes as (
    select ctid, row_number() over (
        partition by user_id, comment_id order by created_at desc nulls last, id
    ) as duplicate_rank
    from public.topic_votes
    where comment_id is not null
)
delete from public.topic_votes v
using ranked_comment_votes ranked
where v.ctid = ranked.ctid and ranked.duplicate_rank > 1;

create unique index if not exists topic_votes_user_topic_unique
    on public.topic_votes(user_id, topic_id) where topic_id is not null;
create unique index if not exists topic_votes_user_comment_unique
    on public.topic_votes(user_id, comment_id) where comment_id is not null;

alter table public.forum_topic_views
    add column if not exists topic_id uuid references public.forum_topics(id) on delete cascade,
    add column if not exists user_id uuid references auth.users(id) on delete cascade,
    add column if not exists view_date date not null default (timezone('utc', now()))::date;

alter table public.forum_comments
    add column if not exists parent_comment_id uuid;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.forum_comments'::regclass
          and conname = 'forum_comments_parent_comment_id_fkey'
    ) then
        alter table public.forum_comments
            add constraint forum_comments_parent_comment_id_fkey
            foreign key (parent_comment_id) references public.forum_comments(id) on delete cascade;
    end if;
end;
$$;

create index if not exists forum_comments_parent_created_idx
    on public.forum_comments(parent_comment_id, created_at)
    where parent_comment_id is not null;

create or replace function public.enforce_forum_comment_parent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_parent_topic_id uuid;
begin
    if tg_op = 'UPDATE' and new.parent_comment_id is distinct from old.parent_comment_id then
        raise exception 'A comment reply target cannot be changed.';
    end if;
    if new.parent_comment_id is null then
        return new;
    end if;
    if new.parent_comment_id = new.id then
        raise exception 'A comment cannot reply to itself.';
    end if;

    select c.topic_id into v_parent_topic_id
    from public.forum_comments c
    where c.id = new.parent_comment_id;
    if not found then
        raise exception 'The parent comment does not exist.';
    end if;
    if v_parent_topic_id is distinct from new.topic_id then
        raise exception 'A reply must belong to the same topic as its parent comment.';
    end if;
    return new;
end;
$$;

drop trigger if exists forum_comment_parent_guard on public.forum_comments;
create trigger forum_comment_parent_guard
    before insert or update of parent_comment_id, topic_id on public.forum_comments
    for each row execute function public.enforce_forum_comment_parent();

drop policy if exists "Authors can edit recent topics and admins can edit all" on public.forum_topics;
create policy "Authors can edit recent topics and admins can edit all" on public.forum_topics
    for update to authenticated
    using (public.forum_is_admin() or user_id = auth.uid())
    with check (public.forum_is_admin() or user_id = auth.uid());

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
            if tg_table_name = 'forum_topics' then
                if new.title is not distinct from old.title
                    and new.content is not distinct from old.content
                    and new.category is not distinct from old.category
                    and new.related_symbol is not distinct from old.related_symbol
                    and new.cover_image_url is not distinct from old.cover_image_url
                    and new.images is not distinct from old.images
                    and new.tags is not distinct from old.tags
                    and new.visibility is distinct from old.visibility then
                    null;
                else
                    raise exception 'The one-hour edit window has expired.';
                end if;
            else
                raise exception 'The one-hour edit window has expired.';
            end if;
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
create trigger topic_votes_sync_counts
    after insert or update or delete on public.topic_votes
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
create trigger forum_topic_views_increment_count
    after insert on public.forum_topic_views
    for each row execute function public.increment_forum_topic_views();

create or replace function public.record_forum_topic_view(p_topic_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
    if auth.uid() is null then
        raise exception 'Authentication required to record a forum view.';
    end if;
    insert into public.forum_topic_views(topic_id, user_id)
    select t.id, auth.uid()
    from public.forum_topics t
    where t.id = p_topic_id
      and public.forum_topic_is_visible(t.user_id, t.visibility)
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
    v_vote text;
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
        return jsonb_build_object('removed', v_affected > 0);
    end if;

    if p_topic_id is not null then
        insert into public.topic_votes(user_id, topic_id, vote)
        values (v_user_id, p_topic_id, p_vote)
        on conflict (user_id, topic_id) where topic_id is not null
        do update set vote = excluded.vote
        returning vote into v_vote;
    else
        insert into public.topic_votes(user_id, comment_id, vote)
        values (v_user_id, p_comment_id, p_vote)
        on conflict (user_id, comment_id) where comment_id is not null
        do update set vote = excluded.vote
        returning vote into v_vote;
    end if;
    return jsonb_build_object('vote', v_vote, 'removed', false);
end;
$$;

drop policy if exists "Users can read their own topic votes" on public.topic_votes;
create policy "Users can read their own topic votes" on public.topic_votes
    for select to authenticated using (user_id = auth.uid() or public.forum_is_admin());
revoke insert, update, delete on public.topic_votes from authenticated;
grant select on public.topic_votes to authenticated;
grant all on public.topic_votes to service_role;

revoke all on function public.enforce_forum_comment_parent() from public, anon, authenticated;
revoke all on function public.sync_forum_vote_counts() from public, anon, authenticated;
revoke all on function public.increment_forum_topic_views() from public, anon, authenticated;
revoke all on function public.record_forum_topic_view(uuid) from public, anon;
revoke all on function public.set_forum_vote(uuid, uuid, text) from public, anon;
grant execute on function public.record_forum_topic_view(uuid) to authenticated;
grant execute on function public.set_forum_vote(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
commit;
