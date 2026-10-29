-- Rook Chess database schema
-- Apply only to the intended Supabase project after restoring it.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (char_length(username) between 3 and 20 and username ~ '^[A-Za-z0-9_]+$'),
  elo integer not null default 1200 check (elo between 100 and 4000),
  games_played integer not null default 0,
  wins integer not null default 0,
  draws integer not null default 0,
  losses integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  invite_code text not null unique,
  white_id uuid not null references public.profiles(id),
  black_id uuid references public.profiles(id),
  status text not null default 'waiting' check (status in ('waiting','active','finished')),
  time_control integer not null default 600 check (time_control in (0,60,180,300,600,900,1800)),
  initial_seconds integer not null default 600,
  fen text not null default 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  pgn text not null default '',
  turn_user_id uuid references public.profiles(id),
  white_seconds integer not null default 600,
  black_seconds integer not null default 600,
  last_move_at timestamptz,
  result text check (result in ('white','black','draw')),
  finished_at timestamptz,
  rated boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint different_players check (black_id is null or black_id <> white_id)
);

create index if not exists profiles_elo_idx on public.profiles (elo desc);
create index if not exists games_white_idx on public.games (white_id, created_at desc);
create index if not exists games_black_idx on public.games (black_id, created_at desc);
create index if not exists games_waiting_idx on public.games (status, created_at desc);

alter table public.profiles enable row level security;
alter table public.games enable row level security;

drop policy if exists "Profiles are publicly readable" on public.profiles;
create policy "Profiles are publicly readable" on public.profiles for select to authenticated using (true);
drop policy if exists "Players can read their own games" on public.games;
create policy "Players can read their own games" on public.games for select to authenticated using (auth.uid() = white_id or auth.uid() = black_id);

-- All game mutations and ELO changes are server-only, through the Edge Function.
revoke insert, update, delete on public.games from anon, authenticated;
revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles, public.games to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  base_name text;
  safe_name text;
begin
  base_name := coalesce(nullif(new.raw_user_meta_data ->> 'username',''), split_part(coalesce(new.email,''),'@',1), 'player');
  safe_name := regexp_replace(base_name, '[^A-Za-z0-9_]', '', 'g');
  safe_name := left(safe_name, 14);
  if length(safe_name) < 3 then safe_name := 'player'; end if;
  if exists(select 1 from public.profiles where username = safe_name) then
    safe_name := left(safe_name, 14) || '_' || substr(replace(new.id::text,'-',''),1,5);
  end if;
  insert into public.profiles(id, username) values (new.id, safe_name)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_rook_chess on auth.users;
create trigger on_auth_user_created_rook_chess
after insert on auth.users for each row execute procedure public.handle_new_user();

-- Realtime broadcasts game row changes to authenticated participants only.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'games') then
    alter publication supabase_realtime add table public.games;
  end if;
exception when undefined_object then null;
end $$;
