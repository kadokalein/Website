-- Run this in Supabase → SQL Editor

create table if not exists subscribers (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users on delete cascade not null,
  name       text,
  email      text,
  country    text,
  status     text default 'active',   -- active | canceled
  created_at timestamptz default now()
);

create table if not exists payments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users on delete cascade not null,
  amount     integer default 2000,    -- cents ($20.00)
  paid_at    timestamptz default now()
);

-- Allow anyone to insert their own subscriber record
alter table subscribers enable row level security;
create policy "Users manage own row" on subscribers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Admin (your email) can read all rows
create policy "Admin reads all subscribers" on subscribers
  for select using (
    (select email from auth.users where id = auth.uid()) = 'sk.8trboi247@live.com'
  );

alter table payments enable row level security;
create policy "Users manage own payments" on payments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Admin reads all payments" on payments
  for select using (
    (select email from auth.users where id = auth.uid()) = 'sk.8trboi247@live.com'
  );
