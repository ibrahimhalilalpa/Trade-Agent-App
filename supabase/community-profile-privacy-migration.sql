begin;

alter table public.user_profiles
    add column if not exists cover_image_url text,
    add column if not exists profile_field_visibility jsonb not null default
        '{"avatar_url":"public","bio":"public","gender":"public","rank":"public","followers":"public","following":"public","cover_image":"public","topics":"public","helpful_topics":"public"}'::jsonb;

create or replace function public.forum_profile_visibility_is_valid(p_visibility jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
    select jsonb_typeof(p_visibility) = 'object'
        and not exists (
            select 1
            from jsonb_each(p_visibility) setting
            where setting.key not in (
                'avatar_url', 'bio', 'gender', 'rank', 'followers', 'following',
                'cover_image', 'topics', 'helpful_topics'
            )
            or setting.value #>> '{}' not in ('public', 'followers', 'private')
        )
$$;

alter table public.user_profiles
    drop constraint if exists user_profiles_forum_visibility_check;
alter table public.user_profiles
    add constraint user_profiles_forum_visibility_check
    check (public.forum_profile_visibility_is_valid(profile_field_visibility));

create or replace function public.enforce_profile_visibility_rules()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
    if not public.forum_profile_visibility_is_valid(new.profile_field_visibility) then
        raise exception 'Profile field visibility settings are invalid.';
    end if;
    if new.cover_image_url is not null and (
        char_length(new.cover_image_url) > 2048
        or new.cover_image_url !~ '^https://'
    ) then
        raise exception 'Cover image URL must be an HTTPS URL.';
    end if;
    return new;
end;
$$;

drop trigger if exists user_profiles_forum_visibility_rules on public.user_profiles;
create trigger user_profiles_forum_visibility_rules before insert or update on public.user_profiles
    for each row execute function public.enforce_profile_visibility_rules();

create or replace function public.forum_profile_is_visible(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
    select exists (
        select 1
        from public.user_profiles p
        where p.user_id = p_user_id
          and (
            p.user_id = auth.uid()
            or public.forum_is_admin()
            or p.is_profile_public
            or exists (
                select 1 from public.user_follows f
                where f.follower_id = auth.uid() and f.followed_id = p.user_id
            )
          )
    )
$$;

create or replace function public.forum_profile_field_is_visible(p_user_id uuid, p_field text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
    select exists (
        select 1
        from public.user_profiles p
        where p.user_id = p_user_id
          and (
            p.user_id = auth.uid()
            or public.forum_is_admin()
            or (
                (p.is_profile_public or exists (
                    select 1 from public.user_follows f
                    where f.follower_id = auth.uid() and f.followed_id = p.user_id
                ))
                and coalesce(p.profile_field_visibility ->> p_field, 'public') <> 'private'
                and (
                    coalesce(p.profile_field_visibility ->> p_field, 'public') = 'public'
                    or exists (
                        select 1 from public.user_follows f
                        where f.follower_id = auth.uid() and f.followed_id = p.user_id
                    )
                )
            )
          )
    )
$$;

drop function if exists public.forum_public_profiles(uuid[]);
create function public.forum_public_profiles(p_user_ids uuid[])
returns table (
    user_id uuid, username text, display_name text, avatar_url text, bio text,
    gender text, xp_points integer, rank_title text, is_profile_public boolean,
    followers_count bigint, following_count bigint, is_following boolean,
    cover_image_url text, profile_field_visibility jsonb, is_owner boolean
)
language sql
stable
security definer
set search_path = public, auth
as $$
    select p.user_id, p.username, p.display_name,
        case when public.forum_profile_field_is_visible(p.user_id, 'avatar_url') then p.avatar_url end,
        case when public.forum_profile_field_is_visible(p.user_id, 'bio') then p.bio end,
        case when public.forum_profile_field_is_visible(p.user_id, 'gender') then p.gender end,
        case when public.forum_profile_field_is_visible(p.user_id, 'rank') then p.xp_points end,
        case when public.forum_profile_field_is_visible(p.user_id, 'rank') then p.rank_title end,
        p.is_profile_public,
        case when public.forum_profile_field_is_visible(p.user_id, 'followers')
            then (select count(*) from public.user_follows f where f.followed_id = p.user_id) end,
        case when public.forum_profile_field_is_visible(p.user_id, 'following')
            then (select count(*) from public.user_follows f where f.follower_id = p.user_id) end,
        exists(select 1 from public.user_follows f where f.follower_id = auth.uid() and f.followed_id = p.user_id),
        case when public.forum_profile_field_is_visible(p.user_id, 'cover_image') then p.cover_image_url end,
        p.profile_field_visibility,
        p.user_id = auth.uid()
    from public.user_profiles p
    where p.user_id = any(p_user_ids)
      and public.forum_profile_is_visible(p.user_id)
$$;

drop function if exists public.forum_public_profile(text);
create function public.forum_public_profile(p_username text)
returns table (
    user_id uuid, username text, display_name text, avatar_url text, bio text,
    gender text, xp_points integer, rank_title text, is_profile_public boolean,
    followers_count bigint, following_count bigint, is_following boolean,
    cover_image_url text, profile_field_visibility jsonb, is_owner boolean
)
language sql
stable
security definer
set search_path = public, auth
as $$
    select p.user_id, p.username, p.display_name,
        case when public.forum_profile_field_is_visible(p.user_id, 'avatar_url') then p.avatar_url end,
        case when public.forum_profile_field_is_visible(p.user_id, 'bio') then p.bio end,
        case when public.forum_profile_field_is_visible(p.user_id, 'gender') then p.gender end,
        case when public.forum_profile_field_is_visible(p.user_id, 'rank') then p.xp_points end,
        case when public.forum_profile_field_is_visible(p.user_id, 'rank') then p.rank_title end,
        p.is_profile_public,
        case when public.forum_profile_field_is_visible(p.user_id, 'followers')
            then (select count(*) from public.user_follows f where f.followed_id = p.user_id) end,
        case when public.forum_profile_field_is_visible(p.user_id, 'following')
            then (select count(*) from public.user_follows f where f.follower_id = p.user_id) end,
        exists(select 1 from public.user_follows f where f.follower_id = auth.uid() and f.followed_id = p.user_id),
        case when public.forum_profile_field_is_visible(p.user_id, 'cover_image') then p.cover_image_url end,
        p.profile_field_visibility,
        p.user_id = auth.uid()
    from public.user_profiles p
    where lower(p.username) = lower(p_username)
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
    where v.user_id = p_user_id
      and v.vote = 'helpful'
      and v.topic_id is not null
      and public.forum_profile_field_is_visible(p_user_id, 'helpful_topics')
    order by v.created_at desc
    limit 20
$$;

create or replace function public.refresh_forum_rank_fields()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
    v_user_id uuid;
    v_rank jsonb;
begin
    if tg_table_name in ('user_profiles', 'user_activity_logs', 'user_education_progress', 'user_portfolios') then
        v_user_id := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
    elsif tg_table_name in ('user_positions', 'portfolio_transactions') then
        select p.user_id into v_user_id
        from public.user_portfolios p
        where p.id = case when tg_op = 'DELETE' then old.portfolio_id else new.portfolio_id end;
    end if;

    if v_user_id is not null
        and (auth.uid() = v_user_id or public.forum_is_admin()
            or coalesce(auth.role(), '') = 'service_role') then
        v_rank := public.get_trader_rank(v_user_id);
        update public.user_profiles
        set xp_points = greatest(0, coalesce((v_rank ->> 'xp')::integer, 0)),
            rank_title = coalesce(v_rank ->> 'rank', 'Çaylak')
        where user_id = v_user_id;
    end if;

    if tg_op = 'DELETE' then return old; end if;
    return new;
end;
$$;

create or replace function public.sync_forum_rank(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
    v_rank jsonb;
begin
    if p_user_id is null
        or (auth.uid() is distinct from p_user_id and not public.forum_is_admin()
            and coalesce(auth.role(), '') <> 'service_role') then
        raise exception 'You may only synchronize your own trader rank.';
    end if;

    update public.user_profiles
    set rank_xp_adjustment = rank_xp_adjustment
    where user_id = p_user_id;
    v_rank := public.get_trader_rank(p_user_id);
    return v_rank;
end;
$$;

drop trigger if exists user_profiles_refresh_forum_rank on public.user_profiles;
create trigger user_profiles_refresh_forum_rank
    after update of rank_xp_adjustment on public.user_profiles
    for each row execute function public.refresh_forum_rank_fields();

drop trigger if exists activity_refresh_forum_rank on public.user_activity_logs;
create trigger activity_refresh_forum_rank after insert on public.user_activity_logs
    for each row execute function public.refresh_forum_rank_fields();
drop trigger if exists education_refresh_forum_rank on public.user_education_progress;
create trigger education_refresh_forum_rank after insert or update or delete on public.user_education_progress
    for each row execute function public.refresh_forum_rank_fields();
drop trigger if exists portfolio_refresh_forum_rank on public.user_portfolios;
create trigger portfolio_refresh_forum_rank after update of balance on public.user_portfolios
    for each row execute function public.refresh_forum_rank_fields();
drop trigger if exists positions_refresh_forum_rank on public.user_positions;
create trigger positions_refresh_forum_rank after insert or update or delete on public.user_positions
    for each row execute function public.refresh_forum_rank_fields();
drop trigger if exists transactions_refresh_forum_rank on public.portfolio_transactions;
create trigger transactions_refresh_forum_rank after insert or update or delete on public.portfolio_transactions
    for each row execute function public.refresh_forum_rank_fields();

revoke all on function public.forum_profile_visibility_is_valid(jsonb) from public, anon, authenticated;
grant execute on function public.forum_profile_visibility_is_valid(jsonb) to authenticated, service_role;
revoke all on function public.enforce_profile_visibility_rules() from public, anon, authenticated;
revoke all on function public.refresh_forum_rank_fields() from public, anon, authenticated;
revoke all on function public.sync_forum_rank(uuid) from public, anon;
grant execute on function public.sync_forum_rank(uuid) to authenticated;
revoke all on function public.forum_profile_field_is_visible(uuid, text) from public;
grant execute on function public.forum_profile_field_is_visible(uuid, text) to anon, authenticated;
revoke all on function public.forum_public_profiles(uuid[]) from public, anon;
revoke all on function public.forum_public_profile(text) from public, anon;
revoke all on function public.forum_public_helpful_topics(uuid) from public, anon;
grant execute on function public.forum_public_profiles(uuid[]) to anon, authenticated;
grant execute on function public.forum_public_profile(text) to anon, authenticated;
grant execute on function public.forum_public_helpful_topics(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
