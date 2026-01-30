## Sync & encryption setup (Supabase)

This project supports optional server-side sync of history (encrypted client-side) using Supabase.

1. Create a Supabase project: https://supabase.com/
2. In Supabase SQL editor, run the table creation (see `supabase_table.sql`).
3. In Vercel project settings, add environment variables (Production):
   - SUPABASE_URL = <your supabase project url>
   - SUPABASE_SERVICE_KEY = <service_role key>  (KEEP SECRET)
4. Deploy to Vercel. The endpoint `/api/sync` will be available.
5. On the client:
   - Press Ctrl+K to enable sync (generate and copy your sync token).
   - Optionally set a passphrase (enter when prompted) to encrypt history client-side before upload.
   - Use Ctrl+S to push local history to the server, and Ctrl+L to pull remote history.

Security notes:
- If you enable encryption (recommended), the client encrypts with a passphrase before sending to the server. Only a user with the passphrase can decrypt the data.
- The server stores the encrypted payload keyed by a sync token. Anyone who has the sync token can read/overwrite that payload, so keep the sync token secret.
- Do NOT use weak passphrases for encryption if you want confidentiality.
