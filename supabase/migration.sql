-- Run in the Supabase SQL editor. Auth identities remain in auth.users.
create extension if not exists pgcrypto;
create table if not exists public.profiles (id uuid primary key references auth.users(id) on delete cascade, email text unique not null, name text not null, role text not null check(role in ('civilian','lawyer','admin')), created_at timestamptz not null default now());
create table if not exists public.clients (id uuid primary key default gen_random_uuid(), profile_id uuid references public.profiles(id), name text not null, contact text, email text unique, segment text);
create table if not exists public.lawyer_profiles (user_id uuid primary key references public.profiles(id) on delete cascade, practice_areas jsonb not null default '[]', jurisdictions jsonb not null default '["Uganda"]', location text not null default 'Uganda', years_experience integer not null default 0, availability text not null default 'Profile pending verification', consultation_fee integer not null default 0, languages jsonb not null default '["English"]', verified boolean not null default false, rating numeric not null default 0, workload integer not null default 0, bio text, discoverable boolean not null default false);
alter table public.lawyer_profiles add column if not exists discoverable boolean not null default false;
create table if not exists public.legal_matters (id uuid primary key default gen_random_uuid(), owner_user_id uuid references public.profiles(id), title text not null, jurisdiction text not null default 'Uganda', category text not null default 'Unclassified', facts jsonb not null default '[]', issues jsonb not null default '[]', risk text not null default 'LOW', urgency text not null default 'NORMAL', complexity text not null default 'LOW', confidence text not null default 'LOW', lawyer_needed boolean not null default false, status text not null default 'AI guidance', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.conversation_messages (id uuid primary key default gen_random_uuid(), matter_id uuid not null references public.legal_matters(id) on delete cascade, sender_type text not null, sender_user_id uuid references public.profiles(id), body text not null, metadata jsonb not null default '{}', created_at timestamptz not null default now());
create table if not exists public.cases (id uuid primary key default gen_random_uuid(), reference text unique not null, client_id uuid not null references public.clients(id), title text not null, category text not null, status text not null, priority text not null, summary text not null, next_step text not null, updated_at timestamptz not null default now());
create table if not exists public.referrals (id uuid primary key default gen_random_uuid(), matter_id uuid not null references public.legal_matters(id), lawyer_user_id uuid not null references public.profiles(id), case_id uuid references public.cases(id), status text not null default 'pending', match_score integer not null, brief jsonb not null, consented_at timestamptz not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
alter table public.profiles enable row level security; alter table public.legal_matters enable row level security; alter table public.conversation_messages enable row level security; alter table public.referrals enable row level security;
create policy "profile owner read" on public.profiles for select using (auth.uid()=id);
create policy "matter owner all" on public.legal_matters for all using (auth.uid()=owner_user_id) with check (auth.uid()=owner_user_id);
create policy "matter messages owner" on public.conversation_messages for all using (exists(select 1 from public.legal_matters m where m.id=matter_id and m.owner_user_id=auth.uid()));
create policy "referral participants read" on public.referrals for select using (lawyer_user_id=auth.uid() or exists(select 1 from public.legal_matters m where m.id=matter_id and m.owner_user_id=auth.uid()));

-- Query-path indexes for account routing, matter timelines, matching and referrals.
create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists lawyer_profiles_verified_location_idx on public.lawyer_profiles(verified, location);
create index if not exists lawyer_profiles_practice_areas_gin_idx on public.lawyer_profiles using gin(practice_areas);
create index if not exists lawyer_profiles_jurisdictions_gin_idx on public.lawyer_profiles using gin(jurisdictions);
create index if not exists legal_matters_owner_updated_idx on public.legal_matters(owner_user_id, updated_at desc);
create index if not exists legal_matters_category_jurisdiction_idx on public.legal_matters(category, jurisdiction);
create index if not exists conversation_messages_matter_created_idx on public.conversation_messages(matter_id, created_at);
create index if not exists referrals_lawyer_status_created_idx on public.referrals(lawyer_user_id, status, created_at desc);
create index if not exists referrals_matter_idx on public.referrals(matter_id);
create index if not exists cases_client_updated_idx on public.cases(client_id, updated_at desc);
