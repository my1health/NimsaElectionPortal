create extension if not exists pgcrypto;

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists nominees (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id) on delete cascade,
  name text not null,
  bio text,
  photo_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists votes (
  id uuid primary key default gen_random_uuid(),
  nominee_id uuid not null references nominees(id) on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  unique(email, category_id)
);

create index if not exists votes_nominee_idx on votes(nominee_id);
create index if not exists votes_category_idx on votes(category_id);

alter table categories enable row level security;
alter table nominees enable row level security;
alter table votes enable row level security;

drop policy if exists "public read categories" on categories;
create policy "public read categories" on categories for select using (true);

drop policy if exists "public read active nominees" on nominees;
create policy "public read active nominees" on nominees for select using (is_active = true);

drop policy if exists "public insert votes" on votes;
create policy "public insert votes" on votes for insert with check (true);

drop policy if exists "public read votes" on votes;
create policy "public read votes" on votes for select using (true);

insert into categories (name) values
('Political Personality of the Year'),
('Most Influential South East NiMSAite'),
('Sports Personality of the Year'),
('Community Service Award'),
('Best Student Entrepreneur'),
('Creative Writer of the Year'),
('Mentorship Award'),
('Social Media Personality of the Year'),
('Academic Personality of the Year'),
('ICT Personality of the Year')
on conflict (name) do nothing;

-- Add nominees after categories exist.
-- Example:
-- insert into nominees(category_id,name,bio)
-- select id,'John Doe','Short description'
-- from categories where name='Political Personality of the Year';