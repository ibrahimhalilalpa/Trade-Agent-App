begin;

-- Run after community-forum-migration.sql and forum-engagement-replies-migration.sql.
-- This repairs installations where a legacy topic_votes table or stale RPC remained.

alter table public.topic_votes
    add column if not exists id uuid default gen_random_uuid(),
    add column if not exists topic_id uuid,
    add column if not exists comment_id uuid,
    add column if not exists user_id uuid,
    add column if not exists vote text,
    add column if not exists created_at timestamptz not null default now();

alter table public.topic_votes alter column id set default gen_random_uuid();
update public.topic_votes set id = gen_random_uuid() where id is null;
alter table public.topic_votes alter column id set not null;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.topic_votes'::regclass
          and conname = 'topic_votes_topic_id_fkey'
    ) then
        alter table public.topic_votes
            add constraint topic_votes_topic_id_fkey
            foreign key (topic_id) references public.forum_topics(id) on delete cascade;
    end if;
    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.topic_votes'::regclass
          and conname = 'topic_votes_comment_id_fkey'
    ) then
        alter table public.topic_votes
            add constraint topic_votes_comment_id_fkey
            foreign key (comment_id) references public.forum_comments(id) on delete cascade;
    end if;
end;
$$;

create unique index if not exists topic_votes_user_topic_unique
    on public.topic_votes(user_id, topic_id) where topic_id is not null;
create unique index if not exists topic_votes_user_comment_unique
    on public.topic_votes(user_id, comment_id) where comment_id is not null;
create index if not exists topic_votes_topic_id_idx
    on public.topic_votes(topic_id);

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

create or replace function public.sync_forum_vote_counts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
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

    if tg_op = 'UPDATE' and old.topic_id is distinct from new.topic_id and old.topic_id is not null then
        update public.forum_topics
        set helpful_count = (select count(*)::integer from public.topic_votes where topic_id = old.topic_id and vote = 'helpful'),
            unhelpful_count = (select count(*)::integer from public.topic_votes where topic_id = old.topic_id and vote = 'unhelpful')
        where id = old.topic_id;
    end if;
    if tg_op = 'UPDATE' and old.comment_id is distinct from new.comment_id and old.comment_id is not null then
        update public.forum_comments
        set helpful_count = (select count(*)::integer from public.topic_votes where comment_id = old.comment_id and vote = 'helpful'),
            unhelpful_count = (select count(*)::integer from public.topic_votes where comment_id = old.comment_id and vote = 'unhelpful')
        where id = old.comment_id;
    end if;

    if v_topic_id is not null then
        update public.forum_topics
        set helpful_count = (select count(*)::integer from public.topic_votes where topic_id = v_topic_id and vote = 'helpful'),
            unhelpful_count = (select count(*)::integer from public.topic_votes where topic_id = v_topic_id and vote = 'unhelpful')
        where id = v_topic_id;
    elsif v_comment_id is not null then
        update public.forum_comments
        set helpful_count = (select count(*)::integer from public.topic_votes where comment_id = v_comment_id and vote = 'helpful'),
            unhelpful_count = (select count(*)::integer from public.topic_votes where comment_id = v_comment_id and vote = 'unhelpful')
        where id = v_comment_id;
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
end;
$$;

do $$
declare
    v_trigger record;
begin
    for v_trigger in
        select n.nspname as schema_name, c.relname as table_name, t.tgname as trigger_name
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        where not t.tgisinternal
          and n.nspname = 'public'
          and (
              t.tgfoid = 'public.sync_forum_vote_counts()'::regprocedure
              or t.tgname = 'topic_votes_sync_counts'
          )
    loop
        execute format(
            'drop trigger %I on %I.%I',
            v_trigger.trigger_name,
            v_trigger.schema_name,
            v_trigger.table_name
        );
    end loop;
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
set search_path = public, pg_temp
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

do $$
declare
    v_trigger record;
begin
    for v_trigger in
        select n.nspname as schema_name, c.relname as table_name, t.tgname as trigger_name
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        where not t.tgisinternal
          and n.nspname = 'public'
          and (
              t.tgfoid = 'public.increment_forum_topic_views()'::regprocedure
              or t.tgname = 'forum_topic_views_increment_count'
          )
    loop
        execute format(
            'drop trigger %I on %I.%I',
            v_trigger.trigger_name,
            v_trigger.schema_name,
            v_trigger.table_name
        );
    end loop;
end;
$$;

create trigger forum_topic_views_increment_count
    after insert on public.forum_topic_views
    for each row execute function public.increment_forum_topic_views();

create or replace function public.set_forum_vote(p_topic_id uuid, p_comment_id uuid, p_vote text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
    v_user_id uuid := auth.uid();
    v_owner_id uuid;
    v_visibility text;
    v_vote_id uuid;
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
        select user_id, visibility into v_owner_id, v_visibility
        from public.forum_topics where id = p_topic_id;
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

revoke all on function public.sync_forum_vote_counts() from public, anon, authenticated;
revoke all on function public.set_forum_vote(uuid, uuid, text) from public, anon;
grant execute on function public.set_forum_vote(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
commit;

select table_schema, table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'topic_votes'
  and column_name in ('topic_id', 'comment_id', 'user_id', 'vote')
order by column_name;
