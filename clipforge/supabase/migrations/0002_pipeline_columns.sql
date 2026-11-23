alter table projects
  add column if not exists normalized_path text,
  add column if not exists thumbnail_path text,
  add column if not exists original_filename text,
  add column if not exists source_platform text,
  add column if not exists stage text,
  add column if not exists progress int not null default 0;

alter table exports
  add column if not exists file_name text,
  add column if not exists error text,
  add column if not exists updated_at timestamptz not null default now();

alter table clips
  add column if not exists category_label text,
  add column if not exists suggested_theme text,
  add column if not exists subtitle_style jsonb,   -- user overrides: font, size, colors, position, emoji...
  add column if not exists render_error text,
  add column if not exists history jsonb not null default '[]'::jsonb;

alter table jobs add column if not exists input jsonb;
-- bumped on every edit; the render job re-renders if it changed while rendering
alter table clips add column if not exists rev int not null default 0;

-- jobs are written by the service role only; clients may read their own (policy in 0001)
-- Realtime is not required: the UI polls /api/projects/:id/status.
