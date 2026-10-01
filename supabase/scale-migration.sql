-- Legal Advisor scalable relational backend.
create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner','admin','lawyer','staff')),
  created_at timestamptz not null default now(),
  primary key (workspace_id,user_id)
);

alter table public.clients add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.clients drop constraint if exists clients_email_key;
alter table public.cases add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.cases alter column reference set default ('LA-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)));

create table if not exists public.case_timeline (
  id uuid primary key default gen_random_uuid(), case_id uuid not null references public.cases(id) on delete cascade,
  event_date date not null default current_date, label text not null, sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade, title text not null,
  status text not null default 'pending', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.activity (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null, body text not null, created_at timestamptz not null default now()
);
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade, name text not null, mime_type text,
  size bigint not null default 0, object_name text not null unique, extracted_text text,
  uploaded_by uuid references public.profiles(id) on delete set null, uploaded_at timestamptz not null default now()
);

alter table public.legal_matters add column if not exists guest_token_hash text;
alter table public.legal_matters add column if not exists subcategory text;
alter table public.legal_matters add column if not exists case_id uuid references public.cases(id) on delete set null;

create table if not exists public.legal_sources (
  id text primary key, jurisdiction text not null, category text not null, title text not null,
  url text not null, authority text not null, verified_at timestamptz not null default now()
);
insert into public.legal_sources(id,jurisdiction,category,title,url,authority) values
  ('ug-constitution','Uganda','General','Constitution of the Republic of Uganda','https://ulii.org/akn/ug/act/statute/1995/constitution','Uganda Legal Information Institute'),
  ('ug-employment-act','Uganda','Employment','Employment Act, 2006','https://ulii.org/akn/ug/act/2006/6','Uganda Legal Information Institute')
on conflict(id) do update set title=excluded.title,url=excluded.url,authority=excluded.authority;
create index if not exists legal_sources_jurisdiction_category_idx on public.legal_sources(jurisdiction,category);

create table if not exists public.rate_limit_buckets (
  bucket_key text not null, window_start timestamptz not null, request_count integer not null default 0,
  primary key(bucket_key)
);
do $$ begin
  if exists(select 1 from pg_constraint where conrelid='public.rate_limit_buckets'::regclass and conname='rate_limit_buckets_pkey' and pg_get_constraintdef(oid) like '%window_start%') then
    truncate public.rate_limit_buckets;
    alter table public.rate_limit_buckets drop constraint rate_limit_buckets_pkey;
    alter table public.rate_limit_buckets add primary key(bucket_key);
  end if;
end $$;

create or replace function public.consume_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns table(allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare v_window timestamptz; v_count integer;
begin
  v_window := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds);
  insert into rate_limit_buckets(bucket_key,window_start,request_count) values(p_key,v_window,1)
  on conflict(bucket_key) do update set
    request_count=case when rate_limit_buckets.window_start=v_window then rate_limit_buckets.request_count+1 else 1 end,
    window_start=v_window
  returning request_count into v_count;
  return query select v_count <= p_limit, greatest(p_limit-v_count,0), v_window + make_interval(secs=>p_window_seconds);
end $$;
revoke all on function public.consume_rate_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_rate_limit(text,integer,integer) to service_role;

create or replace function public.ensure_lawyer_workspace(p_user_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_workspace uuid;
begin
  select workspace_id into v_workspace from workspace_members where user_id=p_user_id order by created_at limit 1;
  if v_workspace is null then
    insert into workspaces(name,created_by) values(coalesce(nullif(trim(p_name),''),'Legal practice'),p_user_id) returning id into v_workspace;
    insert into workspace_members(workspace_id,user_id,role) values(v_workspace,p_user_id,'owner');
  end if;
  return v_workspace;
end $$;
revoke all on function public.ensure_lawyer_workspace(uuid,text) from public,anon,authenticated;
grant execute on function public.ensure_lawyer_workspace(uuid,text) to service_role;

create or replace function public.create_case_bundle(
  p_workspace_id uuid,p_client_id uuid,p_title text,p_category text,p_priority text,p_summary text,p_actor uuid
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_case uuid; v_ref text;
begin
  if not exists(select 1 from workspace_members where workspace_id=p_workspace_id and user_id=p_actor) then raise exception 'workspace access denied'; end if;
  v_ref := upper(substr(coalesce(p_category,'X'),1,1)) || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  insert into cases(reference,title,client_id,workspace_id,category,status,priority,summary,next_step)
  values(v_ref,p_title,p_client_id,p_workspace_id,p_category,'pending',p_priority,p_summary,'Initial review pending assignment') returning id into v_case;
  insert into case_timeline(case_id,label) values(v_case,'Matter created in Legal Advisor');
  insert into tasks(workspace_id,case_id,title) values(p_workspace_id,v_case,'Review intake for '||v_ref);
  insert into activity(workspace_id,actor_user_id,body) values(p_workspace_id,p_actor,v_ref||' created.');
  return v_case;
end $$;
revoke all on function public.create_case_bundle(uuid,uuid,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.create_case_bundle(uuid,uuid,text,text,text,text,uuid) to service_role;

create or replace function public.create_referral_bundle(
  p_matter_id uuid,p_lawyer_id uuid,p_client_name text,p_email text,p_phone text,p_match_score integer,p_brief jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_workspace uuid; v_client uuid; v_case uuid; v_referral uuid; v_ref text;
begin
  select workspace_id into v_workspace from workspace_members where user_id=p_lawyer_id order by created_at limit 1;
  if v_workspace is null then raise exception 'lawyer workspace not found'; end if;
  select id into v_client from clients where workspace_id=v_workspace and lower(email)=lower(p_email) limit 1;
  if v_client is null then
    insert into clients(workspace_id,name,contact,email,segment) values(v_workspace,p_client_name,p_phone,nullif(p_email,''),'Legal Advisor referral') returning id into v_client;
  end if;
  v_ref := 'R-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  insert into cases(reference,title,client_id,workspace_id,category,status,priority,summary,next_step)
  select v_ref,title,v_client,v_workspace,category,'pending',case when risk='HIGH' then 'High' else 'Medium' end,
         coalesce(p_brief->>'summary','Legal Advisor referral'),'Lawyer to review referral'
  from legal_matters where id=p_matter_id returning id into v_case;
  if v_case is null then raise exception 'matter not found'; end if;
  insert into case_timeline(case_id,label) values(v_case,'Legal Advisor referral received with client consent');
  insert into tasks(workspace_id,case_id,title) values(v_workspace,v_case,'Review referred matter '||v_ref);
  insert into referrals(matter_id,lawyer_user_id,case_id,status,match_score,brief,consented_at)
  values(p_matter_id,p_lawyer_id,v_case,'pending',p_match_score,p_brief,now()) returning id into v_referral;
  update legal_matters set case_id=v_case,status='Lawyer requested',updated_at=now() where id=p_matter_id;
  insert into activity(workspace_id,body) values(v_workspace,'New Legal Advisor referral received.');
  return jsonb_build_object('id',v_referral,'caseId',v_case,'status','pending');
end $$;
revoke all on function public.create_referral_bundle(uuid,uuid,text,text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.create_referral_bundle(uuid,uuid,text,text,text,integer,jsonb) to service_role;

create or replace function public.update_referral_status(p_referral_id uuid,p_lawyer_id uuid,p_status text)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_ref referrals%rowtype;
begin
  if p_status not in ('accepted','declined','information requested') then raise exception 'invalid referral status'; end if;
  update referrals set status=p_status,updated_at=now() where id=p_referral_id and lawyer_user_id=p_lawyer_id returning * into v_ref;
  if v_ref.id is null then return false; end if;
  update legal_matters set status=case when p_status='accepted' then 'Lawyer connected' else p_status end,updated_at=now() where id=v_ref.matter_id;
  update cases set status=case when p_status='accepted' then 'active' else 'pending' end,next_step=case when p_status='accepted' then 'Contact client and schedule consultation' else p_status end,updated_at=now() where id=v_ref.case_id;
  insert into case_timeline(case_id,label,sort_order) values(v_ref.case_id,'Lawyer '||p_status||' Legal Advisor referral',99);
  return true;
end $$;
revoke all on function public.update_referral_status(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.update_referral_status(uuid,uuid,text) to service_role;

create index if not exists workspace_members_user_idx on public.workspace_members(user_id,workspace_id);
create index if not exists clients_workspace_name_idx on public.clients(workspace_id,name);
create unique index if not exists clients_workspace_email_uidx on public.clients(workspace_id,lower(email)) where email is not null;
create index if not exists cases_workspace_updated_idx on public.cases(workspace_id,updated_at desc);
create index if not exists case_timeline_case_order_idx on public.case_timeline(case_id,sort_order,created_at);
create index if not exists tasks_workspace_status_idx on public.tasks(workspace_id,status,updated_at desc);
create index if not exists activity_workspace_created_idx on public.activity(workspace_id,created_at desc);
create index if not exists documents_case_uploaded_idx on public.documents(case_id,uploaded_at desc);
create index if not exists rate_limit_expiry_idx on public.rate_limit_buckets(window_start);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.clients enable row level security;
alter table public.cases enable row level security;
alter table public.case_timeline enable row level security;
alter table public.tasks enable row level security;
alter table public.activity enable row level security;
alter table public.documents enable row level security;

drop policy if exists "workspace member read" on public.workspaces;
create policy "workspace member read" on public.workspaces for select using(exists(select 1 from workspace_members m where m.workspace_id=id and m.user_id=auth.uid()));
drop policy if exists "membership self read" on public.workspace_members;
create policy "membership self read" on public.workspace_members for select using(user_id=auth.uid());
drop policy if exists "clients workspace access" on public.clients;
create policy "clients workspace access" on public.clients for all using(exists(select 1 from workspace_members m where m.workspace_id=clients.workspace_id and m.user_id=auth.uid())) with check(exists(select 1 from workspace_members m where m.workspace_id=clients.workspace_id and m.user_id=auth.uid()));
drop policy if exists "cases workspace access" on public.cases;
create policy "cases workspace access" on public.cases for all using(exists(select 1 from workspace_members m where m.workspace_id=cases.workspace_id and m.user_id=auth.uid())) with check(exists(select 1 from workspace_members m where m.workspace_id=cases.workspace_id and m.user_id=auth.uid()));
drop policy if exists "timeline workspace access" on public.case_timeline;
create policy "timeline workspace access" on public.case_timeline for all using(exists(select 1 from cases c join workspace_members m on m.workspace_id=c.workspace_id where c.id=case_timeline.case_id and m.user_id=auth.uid())) with check(exists(select 1 from cases c join workspace_members m on m.workspace_id=c.workspace_id where c.id=case_timeline.case_id and m.user_id=auth.uid()));
drop policy if exists "tasks workspace access" on public.tasks;
create policy "tasks workspace access" on public.tasks for all using(exists(select 1 from workspace_members m where m.workspace_id=tasks.workspace_id and m.user_id=auth.uid())) with check(exists(select 1 from workspace_members m where m.workspace_id=tasks.workspace_id and m.user_id=auth.uid()));
drop policy if exists "activity workspace access" on public.activity;
create policy "activity workspace access" on public.activity for select using(exists(select 1 from workspace_members m where m.workspace_id=activity.workspace_id and m.user_id=auth.uid()));
drop policy if exists "documents workspace access" on public.documents;
create policy "documents workspace access" on public.documents for all using(exists(select 1 from workspace_members m where m.workspace_id=documents.workspace_id and m.user_id=auth.uid())) with check(exists(select 1 from workspace_members m where m.workspace_id=documents.workspace_id and m.user_id=auth.uid()));

-- Lawyer identity verification (KYC) fields. Public matching must require approved KYC.
alter table public.lawyer_profiles add column if not exists kyc_status text not null default 'not_submitted';
alter table public.lawyer_profiles add column if not exists kyc_full_name text;
alter table public.lawyer_profiles add column if not exists kyc_id_type text;
alter table public.lawyer_profiles add column if not exists kyc_id_number text;
alter table public.lawyer_profiles add column if not exists kyc_country text default 'Uganda';
alter table public.lawyer_profiles add column if not exists kyc_document_name text;
alter table public.lawyer_profiles add column if not exists kyc_document_path text;
alter table public.lawyer_profiles add column if not exists kyc_submitted_at timestamptz;
alter table public.lawyer_profiles add column if not exists kyc_reviewed_at timestamptz;
alter table public.lawyer_profiles add column if not exists kyc_rejection_reason text;
alter table public.lawyer_profiles add column if not exists kyc_firm_name text;
alter table public.lawyer_profiles add column if not exists kyc_firm_registration text;
alter table public.lawyer_profiles add column if not exists kyc_bar_number text;
alter table public.lawyer_profiles add column if not exists kyc_phone text;
alter table public.lawyer_profiles add column if not exists kyc_address text;
alter table public.lawyer_profiles add column if not exists kyc_legal_document_name text;
alter table public.lawyer_profiles add column if not exists kyc_legal_document_path text;
alter table public.lawyer_profiles add column if not exists kyc_document_back_name text;
alter table public.lawyer_profiles add column if not exists kyc_document_back_path text;
