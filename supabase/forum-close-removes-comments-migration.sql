begin;

create or replace function public.remove_comments_when_forum_topic_closes()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
    if new.is_closed and old.is_closed is distinct from new.is_closed then
        delete from public.forum_comments
        where topic_id = new.id;
    end if;
    return new;
end;
$$;

drop trigger if exists forum_topic_close_removes_comments on public.forum_topics;
create trigger forum_topic_close_removes_comments
    after update of is_closed on public.forum_topics
    for each row
    when (new.is_closed = true and old.is_closed is distinct from new.is_closed)
    execute function public.remove_comments_when_forum_topic_closes();

commit;
