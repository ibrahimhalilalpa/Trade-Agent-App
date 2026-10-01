begin;

-- Apply after notifications-migration.sql, notification-preferences-migration.sql,
-- community-forum-migration.sql, forum-engagement-replies-migration.sql,
-- community-profile-privacy-migration.sql, and community-reports-moderation-migration.sql.

alter table public.topic_votes
    add column if not exists topic_id uuid references public.forum_topics(id) on delete cascade;
create index if not exists topic_votes_topic_id_idx on public.topic_votes(topic_id);

alter table public.user_notifications
    add column if not exists action_url text;

alter table public.user_notifications
    drop constraint if exists user_notifications_category_check;
alter table public.user_notifications
    add constraint user_notifications_category_check
    check (category in ('announcement', 'market', 'portfolio', 'academy', 'system', 'community'));

alter table public.notification_event_templates
    drop constraint if exists notification_event_templates_category_check;
alter table public.notification_event_templates
    add constraint notification_event_templates_category_check
    check (category in ('announcement', 'market', 'portfolio', 'academy', 'system', 'community'));

insert into public.notification_event_templates (event_key, title, message, category, severity)
values
    ('community_followed_topic', 'Takip ettiğin kullanıcı yeni bir konu paylaştı', '@{{username}}: {{title}}', 'community', 'info'),
    ('community_topic_comment', 'Konuna yeni bir yorum geldi', '@{{username}} konuna yorum yaptı: {{excerpt}}', 'community', 'info'),
    ('community_comment_reply', 'Yorumuna yanıt geldi', '@{{username}} yorumuna yanıt verdi: {{excerpt}}', 'community', 'info'),
    ('community_topic_vote', 'Konun faydalı bulundu', '@{{username}} konuna faydalı oyu verdi: {{title}}', 'community', 'success'),
    ('community_comment_vote', 'Yorumun faydalı bulundu', '@{{username}} yorumuna faydalı oyu verdi: {{excerpt}}', 'community', 'success'),
    ('community_mention', 'Toplulukta senden bahsedildi', '@{{username}} bir {{content_type}} içinde senden bahsetti: {{excerpt}}', 'community', 'info')
on conflict (event_key) do update
set title = excluded.title, message = excluded.message, category = excluded.category,
    severity = excluded.severity, active = true, updated_at = now();

create or replace function public.deliver_event_notification(
    p_user_id uuid,
    p_event_key text,
    p_values jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
    v_template public.notification_event_templates%rowtype;
    v_title text;
    v_message text;
    v_action_url text;
    v_key text;
    v_value text;
begin
    select * into v_template
    from public.notification_event_templates
    where event_key = p_event_key and active;
    if not found then
        return;
    end if;
    v_title := v_template.title;
    v_message := v_template.message;
    v_action_url := nullif(p_values ->> 'action_url', '');
    for v_key, v_value in
        select key, value #>> '{}' from jsonb_each(coalesce(p_values, '{}'::jsonb))
    loop
        v_title := replace(v_title, '{{' || v_key || '}}', coalesce(v_value, ''));
        v_message := replace(v_message, '{{' || v_key || '}}', coalesce(v_value, ''));
    end loop;
    insert into public.user_notifications (user_id, event_key, category, severity, title, message, action_url)
    values (p_user_id, p_event_key, v_template.category, v_template.severity, v_title, v_message, v_action_url);
end;
$$;

create or replace function public.forum_suggest_usernames(p_query text)
returns table(username text)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
    select p.username
    from public.user_profiles p
    where auth.uid() is not null
      and char_length(p_query) between 1 and 24
      and p_query ~ '^[[:alnum:]_]+$'
      and p.username ilike p_query || '%'
      and (
          public.forum_profile_is_visible(p.user_id)
          or exists (
              select 1 from public.user_follows f
              where f.follower_id = auth.uid() and f.followed_id = p.user_id
          )
      )
    order by p.username
    limit 8
$$;

create or replace function public.notify_forum_topic_events()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
    v_username text;
    v_mention record;
    v_recipient uuid;
    v_action_url text := '/forum/' || new.id::text;
begin
    select coalesce(nullif(username, ''), 'Bir kullanıcı') into v_username
    from public.user_profiles where user_id = new.user_id;

    perform public.deliver_event_notification(
        f.follower_id, 'community_followed_topic',
        jsonb_build_object('username', coalesce(v_username, 'Bir kullanıcı'),
            'title', left(new.title, 100), 'action_url', v_action_url)
    )
    from public.user_follows f
    where f.followed_id = new.user_id and f.follower_id <> new.user_id;

    for v_mention in
        select distinct matches.parts[2] as username
        from regexp_matches(
            coalesce(new.title, '') || E'\n' || coalesce(new.content, ''),
            '(^|[^[:alnum:]_])@([[:alnum:]_]{3,24})', 'g'
        ) as matches(parts)
    loop
        select p.user_id into v_recipient
        from public.user_profiles p
        where lower(p.username) = lower(v_mention.username)
        limit 1;
        if v_recipient is not null and v_recipient <> new.user_id then
            perform public.deliver_event_notification(
                v_recipient, 'community_mention',
                jsonb_build_object('username', coalesce(v_username, 'Bir kullanıcı'),
                    'content_type', 'konu', 'excerpt', left(new.title, 100),
                    'action_url', v_action_url)
            );
        end if;
        v_recipient := null;
    end loop;
    return new;
end;
$$;

create or replace function public.notify_forum_comment_events()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
    v_topic_owner uuid;
    v_topic_title text;
    v_parent_owner uuid;
    v_username text;
    v_mention record;
    v_recipient uuid;
    v_action_url text := '/forum/' || new.topic_id::text;
begin
    select t.user_id, t.title into v_topic_owner, v_topic_title
    from public.forum_topics t where t.id = new.topic_id;
    select coalesce(nullif(username, ''), 'Bir kullanıcı') into v_username
    from public.user_profiles where user_id = new.user_id;

    if v_topic_owner is not null and v_topic_owner <> new.user_id then
        perform public.deliver_event_notification(
            v_topic_owner, 'community_topic_comment',
            jsonb_build_object('username', coalesce(v_username, 'Bir kullanıcı'),
                'excerpt', left(new.content, 140), 'action_url', v_action_url)
        );
    end if;
    if new.parent_comment_id is not null then
        select c.user_id into v_parent_owner
        from public.forum_comments c where c.id = new.parent_comment_id;
        if v_parent_owner is not null and v_parent_owner <> new.user_id and v_parent_owner is distinct from v_topic_owner then
            perform public.deliver_event_notification(
                v_parent_owner, 'community_comment_reply',
                jsonb_build_object('username', coalesce(v_username, 'Bir kullanıcı'),
                    'excerpt', left(new.content, 140), 'action_url', v_action_url)
            );
        end if;
    end if;

    for v_mention in
        select distinct matches.parts[2] as username
        from regexp_matches(coalesce(new.content, ''), '(^|[^[:alnum:]_])@([[:alnum:]_]{3,24})', 'g') as matches(parts)
    loop
        select p.user_id into v_recipient
        from public.user_profiles p
        where lower(p.username) = lower(v_mention.username)
        limit 1;
        if v_recipient is not null and v_recipient <> new.user_id then
            perform public.deliver_event_notification(
                v_recipient, 'community_mention',
                jsonb_build_object('username', coalesce(v_username, 'Bir kullanıcı'),
                    'content_type', 'yorum', 'excerpt', left(coalesce(v_topic_title, new.content), 100),
                    'action_url', v_action_url)
            );
        end if;
        v_recipient := null;
    end loop;
    return new;
end;
$$;

create or replace function public.notify_forum_vote_event()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
    v_owner uuid;
    v_title text;
    v_content text;
    v_actor text;
    v_target text;
    v_action_url text;
begin
    if new.vote is distinct from 'helpful' or (tg_op = 'UPDATE' and old.vote is not distinct from new.vote) then
        return new;
    end if;
    select coalesce(nullif(username, ''), 'Bir kullanıcı') into v_actor
    from public.user_profiles where user_id = new.user_id;
    if new.topic_id is not null then
        select t.user_id, t.title into v_owner, v_title from public.forum_topics t where t.id = new.topic_id;
        v_target := 'community_topic_vote';
        v_action_url := '/forum/' || new.topic_id::text;
    elsif new.comment_id is not null then
        select c.user_id, c.content, t.title into v_owner, v_content, v_title
        from public.forum_comments c join public.forum_topics t on t.id = c.topic_id
        where c.id = new.comment_id;
        v_target := 'community_comment_vote';
        v_action_url := '/forum/' || (select c.topic_id::text from public.forum_comments c where c.id = new.comment_id);
    else
        return new;
    end if;
    if v_owner is not null and v_owner <> new.user_id then
        perform public.deliver_event_notification(
            v_owner, v_target,
            jsonb_build_object('username', coalesce(v_actor, 'Bir kullanıcı'),
                'title', left(coalesce(v_title, ''), 100),
                'excerpt', left(coalesce(v_content, v_title, ''), 140),
                'action_url', v_action_url)
        );
    end if;
    return new;
end;
$$;

drop trigger if exists forum_topic_social_notifications on public.forum_topics;
create trigger forum_topic_social_notifications after insert on public.forum_topics
    for each row execute function public.notify_forum_topic_events();
drop trigger if exists forum_comment_social_notifications on public.forum_comments;
create trigger forum_comment_social_notifications after insert on public.forum_comments
    for each row execute function public.notify_forum_comment_events();
drop trigger if exists forum_vote_social_notifications on public.topic_votes;
create trigger forum_vote_social_notifications after insert or update on public.topic_votes
    for each row execute function public.notify_forum_vote_event();

revoke all on function public.notify_forum_topic_events() from public, anon, authenticated;
revoke all on function public.notify_forum_comment_events() from public, anon, authenticated;
revoke all on function public.notify_forum_vote_event() from public, anon, authenticated;
revoke all on function public.forum_suggest_usernames(text) from public, anon;
grant execute on function public.forum_suggest_usernames(text) to authenticated;

alter table public.forum_reports
    drop constraint if exists forum_reports_status_check;
alter table public.forum_reports
    add constraint forum_reports_status_check check (status in ('pending', 'resolved', 'dismissed', 'withdrawn'));
alter table public.forum_reports
    drop constraint if exists forum_reports_reporter_id_target_type_target_id_key;
create unique index if not exists forum_reports_one_pending_per_reporter_target_idx
    on public.forum_reports(reporter_id, target_type, target_id)
    where status = 'pending';
drop policy if exists "Reporters withdraw own pending reports" on public.forum_reports;
create policy "Reporters withdraw own pending reports" on public.forum_reports
    for update to authenticated
    using (reporter_id = auth.uid() and status = 'pending')
    with check (reporter_id = auth.uid() and status = 'withdrawn');

notify pgrst, 'reload schema';
commit;
