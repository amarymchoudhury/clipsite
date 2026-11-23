-- ClipForge initial schema. Run in the Supabase SQL editor or via `supabase db push`.
create extension if not exists "pgcrypto";

create type project_status as enum ('draft','uploading','queued','processing','ready','failed');
create type job_kind as enum ('ingest','transcribe','analyze','render','export');
create type job_status as enum ('queued','running','succeeded','failed','cancelled');

create table projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  source_type text not null check (source_type in ('upload','url')),
  source_url text,
  storage_path text,
  duration_seconds numeric,
  width int,
  height int,
  status project_status not null default 'draft',
  error text,
  language text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_user_idx on projects(user_id, created_at desc);

create table transcripts (
  project_id uuid primary key references projects(id) on delete cascade,
  language text,
  text text not null,
  words jsonb not null,      -- [{word,start,end,speaker?}]
  segments jsonb not null    -- [{text,start,end,speaker?}]
);

create table clips (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  hook text,
  category text,
  start_seconds numeric not null,
  end_seconds numeric not null,
  score numeric not null default 0,
  score_breakdown jsonb,
  layout text not null default 'fill',
  subtitle_theme text not null default 'bold',
  subtitles_enabled boolean not null default true,
  subtitle_overrides jsonb,   -- user edits: [{start,end,text}]
  crop jsonb,                 -- {x,y} center offsets 0..1
  original_volume numeric not null default 1,
  render_path text,
  thumbnail_path text,
  render_status text not null default 'pending',
  created_at timestamptz not null default now(),
  check (end_seconds > start_seconds)
);
create index clips_project_idx on clips(project_id, score desc);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  clip_id uuid references clips(id) on delete cascade,
  kind job_kind not null,
  status job_status not null default 'queued',
  progress int not null default 0,
  message text,
  attempts int not null default 0,
  dedupe_key text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Prevent duplicate active jobs for the same work
create unique index jobs_active_dedupe on jobs(dedupe_key)
  where dedupe_key is not null and status in ('queued','running');

create table exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  clip_ids uuid[] not null,
  preset text not null,
  burn_subtitles boolean not null default true,
  storage_path text,
  status text not null default 'queued',
  created_at timestamptz not null default now()
);

-- Row level security: users only see their own rows
alter table projects enable row level security;
alter table transcripts enable row level security;
alter table clips enable row level security;
alter table jobs enable row level security;
alter table exports enable row level security;

create policy "own projects" on projects for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own clips" on clips for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own jobs read" on jobs for select using (user_id = auth.uid());
create policy "own exports" on exports for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own transcripts" on transcripts for select using (
  exists (select 1 from projects p where p.id = project_id and p.user_id = auth.uid())
);

-- Private storage bucket; files live under <user_id>/...
insert into storage.buckets (id, name, public) values ('videos','videos',false)
on conflict (id) do nothing;

create policy "own files read" on storage.objects for select
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own files write" on storage.objects for insert
  with check (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own files update" on storage.objects for update
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own files delete" on storage.objects for delete
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
