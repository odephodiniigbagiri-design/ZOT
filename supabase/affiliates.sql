-- ZOT: affiliate ("call to earn") programme
-- Run in Supabase Dashboard > SQL Editor AFTER payment-submissions.sql. Safe to re-run.
--
-- How money flows
--   1. An affiliate signs up and gets a link:  https://YOUR-SITE/?ref=CODE
--   2. A student opens the link, pays, and sends a receipt (the code rides along).
--   3. When the admin clicks "Verified" on that receipt, a trigger credits the
--      affiliate once per student. Nothing in the browser can create or change credit.
--   4. The affiliate requests a withdrawal; the admin pays it by bank transfer
--      and marks it paid (or rejects it, which releases the money back).

-- ---------------------------------------------------------------- settings
-- Change a number here and re-run this file. Amounts are in kobo (100 kobo = N1).
create or replace function public.zot_affiliate_commission_kobo()
returns bigint language sql immutable as $$ select 100000::bigint $$;       -- N1,000 per referred student

create or replace function public.zot_affiliate_min_withdrawal_kobo()
returns bigint language sql immutable as $$ select 300000::bigint $$;       -- N3,000 minimum withdrawal

-- ------------------------------------------------------------------ tables
create table if not exists public.affiliates (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references auth.users (id) on delete cascade,
  code       text not null unique,
  full_name  text not null,
  email      text not null,
  phone      text,
  created_at timestamptz not null default now()
);

alter table public.payment_submissions
  add column if not exists affiliate_code text
  check (affiliate_code is null or affiliate_code ~ '^[A-Za-z0-9]{4,16}$');

create table if not exists public.affiliate_referrals (
  id              uuid primary key default gen_random_uuid(),
  affiliate_id    uuid not null references public.affiliates (id) on delete cascade,
  submission_id   uuid not null unique references public.payment_submissions (id) on delete cascade,
  student_name    text not null,
  student_email   text not null,
  commission_kobo bigint not null check (commission_kobo > 0),
  created_at      timestamptz not null default now()
);
-- A student can only ever earn one commission, whoever referred them.
create unique index if not exists affiliate_referrals_one_per_student
  on public.affiliate_referrals (lower(student_email));

create table if not exists public.affiliate_withdrawals (
  id             uuid primary key default gen_random_uuid(),
  affiliate_id   uuid not null references public.affiliates (id) on delete cascade,
  amount_kobo    bigint not null check (amount_kobo > 0),
  bank_name      text not null check (char_length(bank_name) between 2 and 60),
  account_number text not null check (account_number ~ '^[0-9]{10}$'),
  account_name   text not null check (char_length(account_name) between 2 and 120),
  status         text not null default 'pending' check (status in ('pending', 'paid', 'rejected')),
  requested_at   timestamptz not null default now(),
  resolved_at    timestamptz,
  admin_note     text
);
create index if not exists affiliate_withdrawals_status_idx
  on public.affiliate_withdrawals (status, requested_at desc);

-- ----------------------------------------------------------------- security
-- Affiliates never touch these tables directly: they use the functions below.
-- Only the main admin can read them straight from the dashboard.
alter table public.affiliates            enable row level security;
alter table public.affiliate_referrals   enable row level security;
alter table public.affiliate_withdrawals enable row level security;

grant select on public.affiliates, public.affiliate_referrals, public.affiliate_withdrawals to authenticated;

drop policy if exists "Admin reads affiliates" on public.affiliates;
create policy "Admin reads affiliates"
  on public.affiliates for select to authenticated using (public.zot_is_main_admin());

drop policy if exists "Admin reads referrals" on public.affiliate_referrals;
create policy "Admin reads referrals"
  on public.affiliate_referrals for select to authenticated using (public.zot_is_main_admin());

drop policy if exists "Admin reads withdrawals" on public.affiliate_withdrawals;
create policy "Admin reads withdrawals"
  on public.affiliate_withdrawals for select to authenticated using (public.zot_is_main_admin());

-- ------------------------------------------- credit an affiliate on "Verified"
create or replace function public.zot_credit_affiliate()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  aff public.affiliates%rowtype;
begin
  if new.status = 'verified'
     and old.status is distinct from 'verified'
     and new.affiliate_code is not null then

    select * into aff from public.affiliates where code = upper(new.affiliate_code);

    if found
       -- no commission for referring yourself (same email or same phone number)
       and lower(aff.email) <> lower(new.email)
       and (coalesce(aff.phone, '') = ''
            or right(regexp_replace(aff.phone, '\D', '', 'g'), 10) <> right(new.whatsapp_number, 10))
    then
      insert into public.affiliate_referrals
        (affiliate_id, submission_id, student_name, student_email, commission_kobo)
      values
        (aff.id, new.id, new.full_name, lower(new.email), public.zot_affiliate_commission_kobo())
      on conflict do nothing;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.zot_credit_affiliate() from public;

drop trigger if exists zot_credit_affiliate_trg on public.payment_submissions;
create trigger zot_credit_affiliate_trg
  after update of status on public.payment_submissions
  for each row execute function public.zot_credit_affiliate();

-- ------------------------------------------------ affiliate: own account/data
-- Creates the affiliate record on first sign-in (works whether or not your project
-- requires email confirmation) and returns it. Returns null for accounts that
-- did not sign up as an affiliate (e.g. students or the admin).
create or replace function public.zot_affiliate_ensure()
returns json
language plpgsql security definer
set search_path = public
as $$
declare
  uid   uuid := auth.uid();
  u     record;
  a     public.affiliates%rowtype;
  c     text;
  tries int := 0;
begin
  if uid is null then
    raise exception 'Please sign in first.' using errcode = '28000';
  end if;

  select * into a from public.affiliates where user_id = uid;

  if not found then
    select id, email, raw_user_meta_data into u from auth.users where id = uid;
    if coalesce(u.raw_user_meta_data ->> 'affiliate', '') <> 'true' then
      return null;
    end if;

    loop
      c := 'ZA' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
      begin
        insert into public.affiliates (user_id, code, full_name, email, phone)
        values (
          uid, c,
          left(coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(u.email, '@', 1)), 120),
          lower(u.email),
          left(btrim(coalesce(u.raw_user_meta_data ->> 'phone', '')), 20)
        )
        returning * into a;
        exit;
      exception when unique_violation then
        select * into a from public.affiliates where user_id = uid;   -- parallel call won
        exit when found;
        tries := tries + 1;
        if tries > 8 then raise; end if;                               -- code clash: retry
      end;
    end loop;
  end if;

  return json_build_object('id', a.id, 'code', a.code, 'full_name', a.full_name,
                           'email', a.email, 'phone', a.phone);
end;
$$;

create or replace function public.zot_affiliate_dashboard()
returns json
language plpgsql stable security definer
set search_path = public
as $$
declare
  a      public.affiliates%rowtype;
  refs   int;
  earned bigint;
  paid   bigint;
  pend   bigint;
  waiting int;
begin
  select * into a from public.affiliates where user_id = auth.uid();
  if not found then return null; end if;

  select count(*), coalesce(sum(commission_kobo), 0)
    into refs, earned
    from public.affiliate_referrals where affiliate_id = a.id;

  select coalesce(sum(amount_kobo) filter (where status = 'paid'), 0),
         coalesce(sum(amount_kobo) filter (where status = 'pending'), 0)
    into paid, pend
    from public.affiliate_withdrawals where affiliate_id = a.id;

  select count(*) into waiting
    from public.payment_submissions
   where status = 'pending' and upper(affiliate_code) = a.code;

  return json_build_object(
    'affiliate', json_build_object('code', a.code, 'full_name', a.full_name,
                                   'email', a.email, 'phone', a.phone),
    'settings',  json_build_object('commission_kobo', public.zot_affiliate_commission_kobo(),
                                   'min_withdrawal_kobo', public.zot_affiliate_min_withdrawal_kobo()),
    'stats',     json_build_object(
                   'referred', refs,
                   'waiting', waiting,
                   'earned_kobo', earned,
                   'paid_kobo', paid,
                   'pending_withdrawal_kobo', pend,
                   'balance_kobo', earned - paid,
                   'available_kobo', greatest(earned - paid - pend, 0)),
    'referrals', coalesce((
      select json_agg(r) from (
        select case when position(' ' in btrim(student_name)) > 0
                    then initcap(split_part(btrim(student_name), ' ', 1)) || ' ' ||
                         upper(left(split_part(btrim(student_name), ' ', 2), 1)) || '.'
                    else initcap(btrim(student_name)) end as student,
               created_at, commission_kobo
          from public.affiliate_referrals
         where affiliate_id = a.id
         order by created_at desc limit 50) r), '[]'::json),
    'withdrawals', coalesce((
      select json_agg(w) from (
        select id, amount_kobo, status, requested_at, resolved_at, admin_note,
               bank_name, right(account_number, 4) as account_last4
          from public.affiliate_withdrawals
         where affiliate_id = a.id
         order by requested_at desc limit 50) w), '[]'::json)
  );
end;
$$;

create or replace function public.zot_affiliate_request_withdrawal(
  p_amount_kobo bigint, p_bank_name text, p_account_number text, p_account_name text)
returns json
language plpgsql security definer
set search_path = public
as $$
declare
  a      public.affiliates%rowtype;
  minw   bigint := public.zot_affiliate_min_withdrawal_kobo();
  earned bigint;
  paid   bigint;
  pend   bigint;
  avail  bigint;
  w      public.affiliate_withdrawals%rowtype;
begin
  -- lock the affiliate row so two quick clicks can't both pass the balance check
  select * into a from public.affiliates where user_id = auth.uid() for update;
  if not found then raise exception 'Affiliate account not found.'; end if;

  p_bank_name      := btrim(coalesce(p_bank_name, ''));
  p_account_number := btrim(coalesce(p_account_number, ''));
  p_account_name   := btrim(coalesce(p_account_name, ''));

  if p_amount_kobo is null or p_amount_kobo < minw then
    raise exception 'The minimum withdrawal is N%.', to_char(minw / 100, 'FM999,999,990');
  end if;
  if char_length(p_bank_name) not between 2 and 60 then
    raise exception 'Enter the name of your bank.';
  end if;
  if p_account_number !~ '^[0-9]{10}$' then
    raise exception 'Enter a valid 10-digit account number.';
  end if;
  if char_length(p_account_name) not between 2 and 120 then
    raise exception 'Enter the name on the account.';
  end if;

  select coalesce(sum(commission_kobo), 0) into earned
    from public.affiliate_referrals where affiliate_id = a.id;
  select coalesce(sum(amount_kobo) filter (where status = 'paid'), 0),
         coalesce(sum(amount_kobo) filter (where status = 'pending'), 0)
    into paid, pend
    from public.affiliate_withdrawals where affiliate_id = a.id;

  avail := earned - paid - pend;
  if p_amount_kobo > avail then
    raise exception 'You can withdraw up to N% right now.', to_char(greatest(avail, 0) / 100, 'FM999,999,990');
  end if;

  insert into public.affiliate_withdrawals (affiliate_id, amount_kobo, bank_name, account_number, account_name)
  values (a.id, p_amount_kobo, p_bank_name, p_account_number, p_account_name)
  returning * into w;

  return json_build_object('id', w.id, 'amount_kobo', w.amount_kobo, 'status', w.status,
                           'requested_at', w.requested_at);
end;
$$;

-- ----------------------------------------------------------------- admin side
create or replace function public.zot_admin_affiliate_overview()
returns json
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.zot_is_main_admin() then
    raise exception 'Admins only.' using errcode = '42501';
  end if;

  return coalesce((
    select json_agg(x order by x.earned_kobo desc, x.created_at) from (
      select a.id, a.code, a.full_name, a.email, a.phone, a.created_at,
             (select count(*) from public.affiliate_referrals r where r.affiliate_id = a.id) as referred,
             (select coalesce(sum(commission_kobo), 0) from public.affiliate_referrals r where r.affiliate_id = a.id) as earned_kobo,
             (select coalesce(sum(amount_kobo), 0) from public.affiliate_withdrawals w where w.affiliate_id = a.id and w.status = 'paid') as paid_kobo,
             (select coalesce(sum(amount_kobo), 0) from public.affiliate_withdrawals w where w.affiliate_id = a.id and w.status = 'pending') as pending_kobo
        from public.affiliates a) x), '[]'::json);
end;
$$;

create or replace function public.zot_admin_resolve_withdrawal(p_id uuid, p_status text, p_note text default null)
returns json
language plpgsql security definer
set search_path = public
as $$
declare
  w public.affiliate_withdrawals%rowtype;
begin
  if not public.zot_is_main_admin() then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  if p_status not in ('paid', 'rejected') then
    raise exception 'Status must be paid or rejected.';
  end if;

  update public.affiliate_withdrawals
     set status = p_status, resolved_at = now(), admin_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id and status = 'pending'
  returning * into w;

  if not found then
    raise exception 'This request was already handled (or does not exist).';
  end if;

  return json_build_object('id', w.id, 'status', w.status);
end;
$$;

-- ------------------------------------------------------------------- access
revoke all on function public.zot_affiliate_ensure()                                  from public, anon;
revoke all on function public.zot_affiliate_dashboard()                               from public, anon;
revoke all on function public.zot_affiliate_request_withdrawal(bigint, text, text, text) from public, anon;
revoke all on function public.zot_admin_affiliate_overview()                          from public, anon;
revoke all on function public.zot_admin_resolve_withdrawal(uuid, text, text)          from public, anon;

grant execute on function public.zot_affiliate_ensure()                                  to authenticated;
grant execute on function public.zot_affiliate_dashboard()                               to authenticated;
grant execute on function public.zot_affiliate_request_withdrawal(bigint, text, text, text) to authenticated;
grant execute on function public.zot_admin_affiliate_overview()                          to authenticated;
grant execute on function public.zot_admin_resolve_withdrawal(uuid, text, text)          to authenticated;
