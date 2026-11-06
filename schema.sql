-- Run in Supabase: SQL Editor > New query
create table if not exists residents (
  id bigint generated always as identity primary key,
  last_name text not null,
  first_name text not null,
  middle_name text,
  birthdate date,
  sex text check (sex in ('Male','Female')),
  civil_status text,
  purok text,
  address text,
  contact text,
  voter boolean default false,
  created_at timestamptz default now()
);

create table if not exists certificates (
  id bigint generated always as identity primary key,
  resident_id bigint references residents(id) on delete cascade,
  type text not null check (type in ('Barangay Clearance','Certificate of Indigency','Certificate of Residency')),
  purpose text,
  status text default 'Pending' check (status in ('Pending','Released','Rejected')),
  created_at timestamptz default now()
);

create table if not exists blotters (
  id bigint generated always as identity primary key,
  complainant text not null,
  respondent text,
  incident text not null,
  incident_date date default current_date,
  status text default 'Open' check (status in ('Open','Settled','Escalated')),
  created_at timestamptz default now()
);

-- The server uses the service key, so lock tables from public access
alter table residents enable row level security;
alter table certificates enable row level security;
alter table blotters enable row level security;
-- Create your admin: Supabase > Authentication > Users > Add user
