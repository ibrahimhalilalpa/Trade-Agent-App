-- Run once after user-roles-rank-migration.sql, using the Supabase SQL Editor.
-- This assigns the initial super admin to the specified existing account.
do $$
declare
    v_user_id uuid;
begin
    select id into v_user_id
    from auth.users
    where lower(email) = lower('ibrahimhalilalpa@gmail.com')
    limit 1;

    if v_user_id is null then
        raise exception 'The bootstrap account was not found in auth.users.';
    end if;

    insert into public.user_roles (user_id, role)
    values (v_user_id, 'super_admin')
    on conflict (user_id) do update set role = 'super_admin', updated_at = now();
end;
$$;
