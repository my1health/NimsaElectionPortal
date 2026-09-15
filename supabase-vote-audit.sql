-- Read-only checks for vote counting problems.
-- The Supabase SQL Editor only shows the result of the last statement,
-- so highlight and run one query at a time.

-- 1. The real number of vote rows. Before the fix, the admin leaderboard
--    could only see the first 1000 of these.
select count(*) as vote_rows
from public.votes;

-- 2. Payments by status. "pending", "abandoned", "ongoing" or
--    "amount_mismatch" rows may still be paid on Paystack: use
--    "Check Paystack" in the admin dashboard to find out.
select
  status,
  count(*) as payments,
  sum(vote_count) as votes_bought,
  sum(amount_kobo) / 100 as naira
from public.payments
group by status
order by status;

-- 3. Successful payments whose vote rows don't match what was bought.
select
  p.reference,
  p.email,
  p.nominee_id,
  p.vote_count,
  count(v.id) as vote_rows,
  p.paid_at
from public.payments p
left join public.votes v on v.payment_reference = p.reference
where p.status = 'success'
group by p.reference, p.email, p.nominee_id, p.vote_count, p.paid_at
having count(v.id) <> p.vote_count
order by p.paid_at;

-- 4. Payments whose nominee no longer exists. Their votes were deleted
--    along with the nominee; point nominee_id at the right nominee and
--    run "Apply Safe Corrections" to restore them.
select
  p.reference,
  p.email,
  p.nominee_id,
  p.vote_count,
  p.status
from public.payments p
left join public.nominees n on n.id = p.nominee_id
where n.id is null;

-- 5. Vote rows with no matching payment (not bought through Paystack).
select
  n.name as nominee,
  count(*) as unpaid_vote_rows
from public.votes v
left join public.payments p on p.reference = v.payment_reference
left join public.nominees n on n.id = v.nominee_id
where p.reference is null
group by n.name
order by unpaid_vote_rows desc;

-- 6. Duplicate payment references.
select reference, count(*)
from public.payments
group by reference
having count(*) > 1;

-- 7. Constraints on votes and payments.
select
  conrelid::regclass as table_name,
  conname,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in ('public.votes'::regclass, 'public.payments'::regclass)
order by 1, 2;

-- 8. Row level security policies on votes and payments.
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('votes', 'payments');
