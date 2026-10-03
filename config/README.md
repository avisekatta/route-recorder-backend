# Google Drive connection — one-time setup

Two ways to connect the backend to Google Drive. **Option A (OAuth) is the
preferred path** and is the only one available when the organisation blocks
service-account key creation ("Service account key creation is disabled").
Option B is the service-account approach, for organisations that allow keys.

## Option A — OAuth with your own Google account (recommended)

The administrator's own account authorises the backend once; only a refresh
token is stored on the server. No folder sharing needed — the central folder
belongs to the same account.

1. Open https://console.cloud.google.com, select (or create) the
   `Route Recorder` project, and enable the **Google Drive API**
   (APIs and Services → Library → Google Drive API → Enable).
2. **APIs and Services → OAuth consent screen** → choose **External** → Create.
   - App name: `Route Recorder`
   - User support email: your email address
   - Developer contact email: your email address
   - Save and continue through the next screens (scopes can stay empty).
   - On the **Test users** step, add your own email address, then finish.
3. **APIs and Services → Credentials → Create Credentials → OAuth client ID**.
   - Application type: **Desktop app**
   - Name: `Route Recorder Backend`
   - Click Create and copy the **Client ID** and **Client secret**.
4. Put them in `backend/.env`:
   `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`.
5. Run `npm run authorize`, open the printed address, sign in with the account
   that owns the central Drive folder, and allow access. The program prints a
   **refresh token** — copy it into `backend/.env` as
   `GOOGLE_OAUTH_REFRESH_TOKEN`.
6. In `backend/.env`, set `DRIVE_FOLDER_ID` to the central folder's ID
   (the long code in the folder's Drive link after `/folders/`).

## Option B — Service account + shared folder

1. Open https://console.cloud.google.com and create (or choose) a project for Route Recorder.
2. Enable the **Google Drive API** for that project (APIs and Services → Library → Google Drive API).
3. Go to **IAM and Admin → Service Accounts → Create Service Account**.
4. Give it a name such as `route-recorder-uploader`.
5. Under **Keys → Add Key → Create new key**, choose JSON and download the file.
6. Save the downloaded file exactly here as:

```
backend/config/service-account.json
```

## 2. Share the central Drive folder with the service account

1. In Google Drive, create the central folder, for example `Route Collection`.
2. Right-click the folder → **Share**.
3. Add the service-account email address (it looks like
   `route-recorder-uploader@<your-project>.iam.gserviceaccount.com`) with **Editor** access.
4. Open the folder in Drive and copy the folder ID from the address bar:
   `https://drive.google.com/drive/folders/<FOLDER_ID>`.
5. Put that ID into `DRIVE_FOLDER_ID` in `backend/.env`.

## 3. Verify

Start the backend (`npm start`) and check the log does not print a
`DRIVE_FOLDER_ID` warning. The first successful KML upload also confirms the
share is working. If the upload reports "not visible to the service account",
repeat step 2 — the share must be on the exact folder whose ID is configured.

## Notes

- The backend uses the broad `drive` scope because the central folder is owned
  by the administrator's account, not by the service account. Use a dedicated
  service account for this app only, and revoke its key if it ever leaks.
- The administrator keeps control: revoking the folder share stops all uploads
  immediately without touching the backend.
