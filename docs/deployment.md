# Deployment (Supabase + Vercel)

No secret is ever put in Git or in chat. They live in GitHub secrets, Vercel environment
variables and your own `.env`.

## 1. Pick a password for the app's database user

Make up a long password of letters and numbers only (for example from a password manager).
This is `APP_DB_PASSWORD`. The app signs in to the database as `tapserve_app` with it.

## 2. Set up the database (GitHub Actions)

1. In Supabase, open **Connect** (top of the project page) and copy the **Session pooler**
   connection string. Put your database password in place of `[YOUR-PASSWORD]`.
2. In GitHub, open the repository's **Settings → Secrets and variables → Actions** and add two
   repository secrets:
   - `DATABASE_ADMIN_URL` = the session pooler string from step 1
   - `APP_DB_PASSWORD` = the password from section 1
3. Open **Actions → Set up database → Run workflow**. Leave *Load the demo café and hotel* ticked
   to get the demo login (`demo@tapserve.et` / `demo-pass-123`). Run it again after each release
   that adds a migration; it only applies what is new, and the demo data is loaded only once.

The migrations create the `tapserve_app` role, and remove Supabase's Data API access
(`anon`, `authenticated`) to the tables, because Tapserve does not use that API.

## 3. Deploy the web app (Vercel)

1. On vercel.com, **Add New → Project**, and import `Esraprojects/tapserve`.
2. Set **Root Directory** to `apps/web`. The framework is detected as Next.js.
3. Add these environment variables:
   - `DATABASE_URL` = Supabase's **Transaction pooler** string (port 6543), with the user changed
     from `postgres.<ref>` to `tapserve_app.<ref>` and the password replaced by `APP_DB_PASSWORD`.
   - `SMS_PROVIDER` = `console` until an SMS gateway is connected (sign up with email meanwhile).
4. In **Settings → Functions**, pick the region closest to the Supabase project's region.
5. Deploy. Each merge to `main` then deploys again on its own.

`DATABASE_ADMIN_URL` is only for migrations and never goes into Vercel.

## Running migrations from your own computer instead

```bash
DATABASE_ADMIN_URL="<session pooler string>" APP_DB_PASSWORD="<password>" pnpm db:migrate
```

Environment variables are listed in `.env.example`.
