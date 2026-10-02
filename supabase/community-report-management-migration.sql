begin;

alter table public.forum_reports
    add column if not exists reporter_resolution_summary text;

update public.forum_reports
set reporter_resolution_summary = case
    when resolution_note ilike 'Kullanıcıya uyarı gönderildi:%' then 'Kullanıcıya uyarı gönderildi.'
    when resolution_note ilike '%forum erişim kısıtlaması uygulandı%' then 'Kullanıcıya forum erişim kısıtlaması uygulandı.'
    when status = 'resolved' then 'Şikâyet incelendi ve sonuçlandırıldı.'
    when status = 'dismissed' then 'Şikâyet incelendi; işlem yapılmadı.'
    else reporter_resolution_summary
end
where reporter_resolution_summary is null and resolution_note is not null;

alter table public.forum_reports
    drop constraint if exists forum_reports_status_check;
alter table public.forum_reports
    drop constraint if exists forum_reports_target_type_check;
alter table public.forum_reports
    add constraint forum_reports_target_type_check
    check (target_type in ('topic', 'comment', 'profile'));
alter table public.forum_reports
    drop constraint if exists forum_reports_reason_check;
alter table public.forum_reports
    add constraint forum_reports_reason_check
    check (reason in (
        'spam', 'harassment', 'misleading', 'personal_info', 'other',
        'inappropriate_profile_photo', 'inappropriate_username', 'impersonation', 'profile_other'
    ));
alter table public.forum_reports
    add constraint forum_reports_status_check
    check (status in ('pending', 'reviewing', 'resolved', 'dismissed', 'withdrawn'));

drop policy if exists "Forum users create reports" on public.forum_reports;
create policy "Forum users create reports" on public.forum_reports
    for insert to authenticated
    with check (
        reporter_id = auth.uid()
        and reported_user_id is distinct from auth.uid()
        and status = 'pending'
        and moderator_id is null
        and resolved_at is null
        and (
            (target_type = 'topic' and exists (
                select 1 from public.forum_topics t
                where t.id = target_id
                  and t.user_id = reported_user_id
                  and target_topic_id = t.id
                  and target_title = t.title
                  and content_snapshot = left(t.content, 6000)
                  and public.forum_topic_is_visible(t.user_id, t.visibility)
            ))
            or (target_type = 'comment' and exists (
                select 1 from public.forum_comments c
                join public.forum_topics t on t.id = c.topic_id
                where c.id = target_id
                  and c.user_id = reported_user_id
                  and target_topic_id = t.id
                  and target_title = t.title
                  and content_snapshot = left(c.content, 6000)
                  and public.forum_topic_is_visible(t.user_id, t.visibility)
            ))
            or (target_type = 'profile' and target_id = reported_user_id and target_topic_id is null
                and exists (select 1 from public.user_profiles p where p.user_id = reported_user_id))
        )
    );

create or replace function public.manage_own_forum_report(
    p_action text,
    p_report_id uuid,
    p_reason text default null,
    p_details text default null
)
returns table (
    id uuid,
    status text,
    reason text,
    details text,
    resolution_note text,
    created_at timestamptz,
    resolved_at timestamptz,
    target_type text,
    target_id uuid,
    target_topic_id uuid,
    target_title text,
    content_snapshot text
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
    v_report public.forum_reports%rowtype;
    v_reason text;
    v_details text;
begin
    if auth.uid() is null then
        raise exception 'Authentication required.';
    end if;
    if p_action not in ('withdraw', 'edit') then
        raise exception 'Invalid report action.';
    end if;
    select * into v_report
    from public.forum_reports r
    where r.id = p_report_id and r.reporter_id = auth.uid()
    for update;
    if not found then
        raise exception 'Report not found.';
    end if;
    if v_report.status not in ('pending', 'reviewing') then
        raise exception 'Only open reports can be changed.';
    end if;

    if p_action = 'withdraw' then
        update public.forum_reports r
        set status = 'withdrawn',
            resolution_note = 'Şikâyeti bildiren kullanıcı geri çekti.',
            resolved_at = now()
        where r.id = p_report_id;
    else
        v_reason := coalesce(p_reason, '');
        v_details := coalesce(p_details, '');
        if v_reason not in (
            'spam', 'harassment', 'misleading', 'personal_info', 'other',
            'inappropriate_profile_photo', 'inappropriate_username', 'impersonation', 'profile_other'
        ) then
            raise exception 'Invalid report reason.';
        end if;
        if v_report.target_type = 'profile'
           and v_reason not in ('inappropriate_profile_photo', 'inappropriate_username', 'impersonation', 'profile_other') then
            raise exception 'Invalid profile report reason.';
        end if;
        if v_report.target_type <> 'profile'
           and v_reason in ('inappropriate_profile_photo', 'inappropriate_username', 'impersonation', 'profile_other') then
            raise exception 'Profile report reasons cannot be used for content reports.';
        end if;
        if char_length(v_details) > 1000 then
            raise exception 'Report details exceed the maximum length.';
        end if;
        update public.forum_reports r
        set reason = v_reason, details = v_details
        where r.id = p_report_id;
    end if;

    return query
    select r.id, r.status, r.reason, r.details, r.resolution_note, r.created_at,
        r.resolved_at, r.target_type, r.target_id, r.target_topic_id, r.target_title,
        r.content_snapshot
    from public.forum_reports r where r.id = p_report_id;
end;
$$;

create table if not exists public.forum_follow_notification_preferences (
    follower_id uuid not null references auth.users(id) on delete cascade,
    followed_id uuid not null references auth.users(id) on delete cascade,
    mode text not null default 'none' check (mode in ('none', 'all', 'selected')),
    categories text[] not null default '{}',
    updated_at timestamptz not null default now(),
    primary key (follower_id, followed_id),
    check (follower_id <> followed_id),
    check (mode <> 'selected' or cardinality(categories) > 0)
);

alter table public.forum_follow_notification_preferences enable row level security;
revoke all on public.forum_follow_notification_preferences from anon;
grant select, insert, update, delete on public.forum_follow_notification_preferences to authenticated;
drop policy if exists "Users manage own followed-topic notification preferences" on public.forum_follow_notification_preferences;
create policy "Users manage own followed-topic notification preferences"
    on public.forum_follow_notification_preferences
    for all to authenticated
    using (
        follower_id = auth.uid()
        and exists (
            select 1 from public.user_follows f
            where f.follower_id = auth.uid()
              and f.followed_id = forum_follow_notification_preferences.followed_id
        )
    )
    with check (
        follower_id = auth.uid()
        and exists (
            select 1 from public.user_follows f
            where f.follower_id = auth.uid()
              and f.followed_id = forum_follow_notification_preferences.followed_id
        )
    );

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
        preference.follower_id, 'community_followed_topic',
        jsonb_build_object('username', coalesce(v_username, 'Bir kullanıcı'),
            'title', left(new.title, 100), 'action_url', v_action_url)
    )
    from public.forum_follow_notification_preferences preference
    join public.user_follows follow_edge
      on follow_edge.follower_id = preference.follower_id
     and follow_edge.followed_id = preference.followed_id
    where preference.followed_id = new.user_id
      and preference.follower_id <> new.user_id
      and (
          preference.mode = 'all'
          or (preference.mode = 'selected' and new.category = any(preference.categories))
      );

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

revoke all on function public.manage_own_forum_report(text, uuid, text, text) from public, anon;
grant execute on function public.manage_own_forum_report(text, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
