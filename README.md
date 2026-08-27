# NiMSA Category B Voting MVP

## Assumption
This version assumes:
- voting is free;
- one vote per category per email;
- nominees are stored in Supabase;
- leaderboard is public.

## 1. Create Supabase
Create a Supabase project and open SQL Editor.
Paste and run `supabase.sql`.

Then add nominees using the example at the bottom of the SQL file.

## 2. Local setup

```bash
npm install
cp .env.example .env.local
```

Put your Supabase URL and anon key into `.env.local`.

Then:

```bash
npm run dev
```

## 3. GitHub + Vercel
Push this project to GitHub.
Import the repository into Vercel.
Add the same environment variables:
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY

Deploy.

## Important production note
For a real election, do not rely on email alone for strong voter identity. Add email OTP, phone OTP, or another approved voter-authentication method before launch. Also consider hiding raw voter data from public database reads and calculating leaderboard counts through a protected server-side function.
