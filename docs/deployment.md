# Deployment (Supabase + Vercel)

1. Create a Supabase project. In **Project Settings → Database**, copy the connection string
   (use the *session* pooler or direct connection for migrations).
2. Run migrations from your computer, using the Supabase `postgres` user:
   ```bash
   DATABASE_ADMIN_URL="postgres://postgres.<ref>:<password>@<host>:5432/postgres" \
   APP_DB_PASSWORD="<a long random password>" pnpm db:migrate
   ```
   This creates the restricted `tapserve_app` role and sets its password.
3. In Vercel, import the GitHub repository, set the root to the repo and the framework to Next.js
   (build command `pnpm build`), and add these environment variables:
   - `DATABASE_URL` = the same host, but user `tapserve_app` and the password from step 2
     (on Supabase's pooler the user is written `tapserve_app.<ref>`).
   - `SMS_PROVIDER` = `console` until an SMS gateway is connected.
4. Never put `DATABASE_ADMIN_URL` or any secret into the frontend or into Git.

Environment variables are listed in `.env.example`.
