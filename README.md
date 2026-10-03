# Route Recorder backend

Node.js 18+ server that handles approved-user login, receives trip metadata and KML files from the mobile app, uploads them to a central Google Drive folder through a service account, and serves the administrator interface at `/admin`.

## First-time setup

1. `npm install`
2. Copy `.env.example` to `.env` and edit it:
   - `ADMIN_PASSWORD` — set before first start (creates the administrator account).
   - `DRIVE_FOLDER_ID` — the central Drive folder ID (see `config/README.md`).
3. Create the Google Drive service account and save its JSON key at `config/service-account.json` (steps in `config/README.md`).
4. `npm start`

On this machine Node is not on the PATH; the portable Node 20 at
`D:\IRCTC Seat Search\android-tools\node` works. Verified locally:
health check, administrator login, invalid-login rejection and the `/admin`
page all respond correctly.

## Running in production

- Serve over HTTPS with a reverse proxy (for example Caddy or Nginx with a certificate).
- Keep the process alive with PM2 or a systemd service.
- Data lives in `backend/data` (users, trips, tokens, stored KML files) — back this folder up.

## Resetting the administrator password

The administrator account is created from `ADMIN_USERNAME` / `ADMIN_PASSWORD` only when no administrator exists yet. To reset later: stop the server, delete `data/users.json`, and start again with new values in `.env`. Existing regular users would also be deleted by this, so prefer creating users through the admin interface and never losing `users.json`.

## Endpoints

See `PLAN.md` for the full API table. Health check: `GET /api/health`.
