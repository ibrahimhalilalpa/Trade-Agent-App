begin;

grant delete on public.user_notifications to authenticated;
drop policy if exists "Users delete own notifications" on public.user_notifications;
create policy "Users delete own notifications" on public.user_notifications
    for delete using (user_id = auth.uid());

commit;
