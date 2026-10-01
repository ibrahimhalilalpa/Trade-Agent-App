begin;

create table if not exists public.forum_reports (
    id uuid primary key default gen_random_uuid(),
    reporter_id uuid not null references auth.users(id) on delete cascade,
    reported_user_id uuid references auth.users(id) on delete set null,
    target_type text not null check (target_type in ('topic', 'comment')),
    target_id uuid not null,
    target_topic_id uuid,
    target_title text,
    content_snapshot text not null,
    reason text not null check (reason in ('spam', 'harassment', 'misleading', 'personal_info', 'other')),
    details text not null default '' check (char_length(details) <= 1000),
    status text not null default 'pending' check (status in ('pending', 'resolved', 'dismissed')),
    moderator_id uuid references auth.users(id) on delete set null,
    resolution_note text,
    created_at timestamptz not null default now(),
    resolved_at timestamptz,
    unique (reporter_id, target_type, target_id)
);

alter table public.forum_reports add column if not exists target_topic_id uuid;

create index if not exists forum_reports_status_created_idx
    on public.forum_reports(status, created_at desc);
create index if not exists forum_reports_reported_user_created_idx
    on public.forum_reports(reported_user_id, created_at desc);

create table if not exists public.forum_moderation_actions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    report_id uuid references public.forum_reports(id) on delete set null,
    action text not null check (action in ('warning', 'ban', 'unban', 'content_removed')),
    note text not null check (char_length(note) between 1 and 1000),
    moderator_id uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);

create index if not exists forum_moderation_actions_user_created_idx
    on public.forum_moderation_actions(user_id, created_at desc);

alter table public.forum_reports enable row level security;
alter table public.forum_moderation_actions enable row level security;

revoke all on public.forum_reports, public.forum_moderation_actions from anon;
grant select, insert on public.forum_reports to authenticated;
grant update on public.forum_reports to authenticated;
grant select, insert on public.forum_moderation_actions to authenticated;
grant all on public.forum_reports, public.forum_moderation_actions to service_role;

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
        )
    );

drop policy if exists "Reporters and admins read reports" on public.forum_reports;
create policy "Reporters and admins read reports" on public.forum_reports
    for select to authenticated
    using (reporter_id = auth.uid() or public.forum_is_admin());

drop policy if exists "Admins manage forum reports" on public.forum_reports;
create policy "Admins manage forum reports" on public.forum_reports
    for update to authenticated
    using (public.forum_is_admin())
    with check (public.forum_is_admin());

drop policy if exists "Users and admins read moderation history" on public.forum_moderation_actions;
create policy "Users and admins read moderation history" on public.forum_moderation_actions
    for select to authenticated
    using (user_id = auth.uid() or public.forum_is_admin());

drop policy if exists "Admins record moderation actions" on public.forum_moderation_actions;
create policy "Admins record moderation actions" on public.forum_moderation_actions
    for insert to authenticated
    with check (public.forum_is_admin() and moderator_id = auth.uid());

grant insert on public.user_notifications to authenticated;
drop policy if exists "Admins send user notifications" on public.user_notifications;
create policy "Admins send user notifications" on public.user_notifications
    for insert to authenticated
    with check (public.has_admin_role());

notify pgrst, 'reload schema';
commit;
