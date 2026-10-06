create table if not exists public.research_journal_entries (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    symbol text not null check (symbol ~ '^[A-Z0-9]{3,6}$'),
    reason text not null check (char_length(trim(reason)) between 1 and 2000),
    scenario text not null check (char_length(trim(scenario)) between 1 and 2000),
    review_status text not null default 'pending'
        check (review_status in ('pending', 'matched', 'partially_matched', 'not_matched')),
    review_note text not null default '' check (char_length(review_note) <= 2000),
    reviewed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (
        (review_status = 'pending' and reviewed_at is null)
        or (review_status <> 'pending' and reviewed_at is not null and char_length(trim(review_note)) > 0)
    )
);

create index if not exists research_journal_entries_user_created_idx
    on public.research_journal_entries(user_id, created_at desc);
create index if not exists research_journal_entries_user_symbol_idx
    on public.research_journal_entries(user_id, symbol);    

alter table public.research_journal_entries enable row level security;

drop policy if exists "Users manage their own research journal entries" on public.research_journal_entries;
create policy "Users manage their own research journal entries" on public.research_journal_entries
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.research_journal_entries to authenticated;
