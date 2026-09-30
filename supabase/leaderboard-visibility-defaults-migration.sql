begin;

alter table public.user_profiles
    alter column leaderboard_visible set default true,
    alter column leaderboard_gain_visible set default true;

update public.user_profiles up
set leaderboard_visible = true
where not up.leaderboard_visible
  and not exists (
      select 1
      from public.user_activity_logs activity
      where activity.user_id = up.user_id
        and activity.metadata ->> 'leaderboard_visible' = 'false'
  );

update public.user_profiles up
set leaderboard_gain_visible = true
where not up.leaderboard_gain_visible
  and not exists (
      select 1
      from public.user_activity_logs activity
      where activity.user_id = up.user_id
        and activity.metadata ->> 'leaderboard_gain_visible' = 'false'
  );

notify pgrst, 'reload schema';
commit;
