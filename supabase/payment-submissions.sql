-- ZOT: receipt submissions ("pending verification")
-- Run once in Supabase Dashboard > SQL Editor. Safe to re-run.

-- 1. Helper: is the signed-in user the main admin? (same rule the dashboards use)
create or replace function public.zot_is_main_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role::text = 'main_admin'
  );
$$;
revoke all on function public.zot_is_main_admin() from public;
grant execute on function public.zot_is_main_admin() to anon, authenticated;

-- 2. Table
create table if not exists public.payment_submissions (
  id                    uuid primary key,
  created_at            timestamptz not null default now(),
  full_name             text not null check (char_length(full_name) between 2 and 120),
  email                 text not null check (char_length(email) <= 254
                                             and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  whatsapp_number       text not null check (whatsapp_number ~ '^[0-9]{8,15}$'),
  tutorial_id           text not null,
  package_id            text not null,
  receipt_path          text not null check (receipt_path like id::text || '/%'),
  status                text not null default 'pending'
                          check (status in ('pending', 'verified', 'rejected')),
  verified_at           timestamptz,
  verified_by           uuid,
  registration_url      text,
  invitation_expires_at timestamptz,
  admin_note            text
);

create index if not exists payment_submissions_status_idx
  on public.payment_submissions (status, created_at desc);

alter table public.payment_submissions enable row level security;

grant insert on public.payment_submissions to anon, authenticated;
grant select, update on public.payment_submissions to authenticated;

-- Visitors can only create brand-new pending rows; they can never read any.
drop policy if exists "Anyone can submit a receipt" on public.payment_submissions;
create policy "Anyone can submit a receipt"
  on public.payment_submissions for insert to anon, authenticated
  with check (
    status = 'pending'
    and verified_at is null and verified_by is null
    and registration_url is null and invitation_expires_at is null
    and admin_note is null
  );

drop policy if exists "Admin reads submissions" on public.payment_submissions;
create policy "Admin reads submissions"
  on public.payment_submissions for select to authenticated
  using (public.zot_is_main_admin());

drop policy if exists "Admin updates submissions" on public.payment_submissions;
create policy "Admin updates submissions"
  on public.payment_submissions for update to authenticated
  using (public.zot_is_main_admin())
  with check (public.zot_is_main_admin());

-- 3. Private storage bucket for the receipt images / PDFs (max 5 MB each)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-receipts', 'payment-receipts', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can upload a receipt" on storage.objects;
create policy "Anyone can upload a receipt"
  on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'payment-receipts');

drop policy if exists "Admin reads receipts" on storage.objects;
create policy "Admin reads receipts"
  on storage.objects for select to authenticated
  using (bucket_id = 'payment-receipts' and public.zot_is_main_admin());

-- 4. Let the public landing page list ACTIVE plans in the "plan paid for" menu.
--    (Prices are already public on the landing page; inactive items stay hidden.)
grant select on public.tutorials, public.tutorial_packages to anon;

drop policy if exists "Public reads active tutorials" on public.tutorials;
create policy "Public reads active tutorials"
  on public.tutorials for select to anon, authenticated
  using (is_active);

drop policy if exists "Public reads active packages" on public.tutorial_packages;
create policy "Public reads active packages"
  on public.tutorial_packages for select to anon, authenticated
  using (is_active);
