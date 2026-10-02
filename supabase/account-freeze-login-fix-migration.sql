begin;

update auth.users as users
set banned_until = null
from public.account_freeze_requests as requests
where users.id = requests.user_id
    and users.banned_until is not null;

commit;
