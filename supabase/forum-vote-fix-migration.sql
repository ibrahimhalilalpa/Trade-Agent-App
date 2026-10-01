begin;

-- Run this after forum-engagement-replies-migration.sql to restore table-safe
-- content-rule checks if the engagement migration replaced the trigger function.

drop policy if exists "Users can read their own topic votes" on public.topic_votes;
create policy "Users can read their own topic votes" on public.topic_votes
    for select to authenticated using (user_id = auth.uid() or public.forum_is_admin());

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

revoke all on function public.set_forum_vote(uuid, uuid, text) from public, anon;
grant execute on function public.set_forum_vote(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
commit;
