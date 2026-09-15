-- Fixes for votes that were paid for but never counted.
--
-- Run this once in the Supabase SQL Editor BEFORE deploying the matching
-- code: the payment routes call record_payment_votes, defined below.
-- It is safe to run again.

begin;

-- ------------------------------------------------------------
-- 1. Every vote row points at the payment that bought it.
-- ------------------------------------------------------------

alter table public.votes
  add column if not exists payment_reference text;

create index if not exists votes_payment_reference_idx
  on public.votes (payment_reference);

-- ------------------------------------------------------------
-- 2. Remove the old free-voting rule "one vote per email per category".
--
--    With paid voting, buying 5 votes inserts 5 rows with the same email
--    and category, and buying again repeats them. That rule makes those
--    inserts fail, so the voter is charged but no votes are counted.
-- ------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.votes'::regclass
      and c.contype = 'u'
      and (
        select array_agg(a.attname::text order by a.attname::text)
        from unnest(c.conkey) as k(attnum)
        join pg_attribute a
          on a.attrelid = c.conrelid
         and a.attnum = k.attnum
      ) = array['category_id', 'email']
  loop
    execute format('alter table public.votes drop constraint %I', r.conname);
    raise notice 'Dropped unique constraint %', r.conname;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 3. Deleting a nominee or category used to delete their votes too
--    (on delete cascade). Paid votes must never disappear, so deleting
--    is now blocked while votes exist. Hide the nominee instead.
-- ------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.votes'::regclass
      and contype = 'f'
      and confrelid in (
        'public.nominees'::regclass,
        'public.categories'::regclass
      )
  loop
    execute format('alter table public.votes drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.votes
  add constraint votes_nominee_id_fkey
    foreign key (nominee_id) references public.nominees (id)
    on delete restrict,
  add constraint votes_category_id_fkey
    foreign key (category_id) references public.categories (id)
    on delete restrict;

-- ------------------------------------------------------------
-- 4. Only the server (service role) may write or read votes.
--
--    These policies let anyone with the public anon key (it ships to
--    every browser) insert votes without paying, and read voter emails.
-- ------------------------------------------------------------

drop policy if exists "public insert votes" on public.votes;
drop policy if exists "public read votes" on public.votes;

-- ------------------------------------------------------------
-- 5. One payment row per Paystack reference.
-- ------------------------------------------------------------

do $$
begin
  if exists (
    select 1
    from public.payments
    group by reference
    having count(*) > 1
  ) then
    raise notice 'payments has duplicate references, so no unique index was added. See query 6 in supabase-vote-audit.sql.';
  else
    create unique index if not exists payments_reference_key
      on public.payments (reference);
  end if;
end $$;

-- ------------------------------------------------------------
-- 6. Record the votes for a paid transaction, atomically.
--
--    The callback page, the Paystack webhook and admin reconciliation
--    can all call this for the same reference at the same moment. The
--    row lock makes them run one after another, and only missing votes
--    are added, so a payment is never counted twice or left half done.
-- ------------------------------------------------------------

create or replace function public.record_payment_votes(
  p_reference text,
  p_paid_at timestamptz default now()
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_vote_count integer;
  v_category_id uuid;
  v_existing integer;
  v_missing integer;
begin
  select * into v_payment
  from public.payments
  where reference = p_reference
  for update;

  if not found then
    return jsonb_build_object('status', 'payment_not_found');
  end if;

  v_vote_count := v_payment.vote_count::integer;

  if v_vote_count is null or v_vote_count < 1 then
    return jsonb_build_object('status', 'invalid_vote_count');
  end if;

  select category_id into v_category_id
  from public.nominees
  where id = v_payment.nominee_id;

  if v_category_id is null then
    return jsonb_build_object('status', 'nominee_not_found');
  end if;

  select count(*) into v_existing
  from public.votes
  where payment_reference = p_reference;

  v_missing := greatest(v_vote_count - v_existing, 0);

  if v_missing > 0 then
    insert into public.votes (nominee_id, category_id, email, payment_reference)
    select v_payment.nominee_id, v_category_id, v_payment.email, p_reference
    from generate_series(1, v_missing);
  end if;

  update public.payments
  set status = 'success',
      paid_at = coalesce(paid_at, p_paid_at)
  where id = v_payment.id;

  return jsonb_build_object(
    'status', 'success',
    'previous_status', v_payment.status,
    'vote_count', v_vote_count,
    'existing_votes', v_existing,
    'votes_added', v_missing
  );
end;
$$;

revoke all on function public.record_payment_votes(text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.record_payment_votes(text, timestamptz)
  to service_role;

commit;
