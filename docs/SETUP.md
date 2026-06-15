# Setup & Configuration Guide

## Google Drive Integration

The Drive App (`drive-app.html`) can connect to your Google Drive for cloud document storage.

### Prerequisites

- A Google account
- Access to [Google Cloud Console](https://console.cloud.google.com/)

### Step 1: Enable Google Drive API

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (e.g., "Island Explorer Drive")
3. Navigate to **APIs & Services > Library**
4. Search for "Google Drive API" and click **Enable**

### Step 2: Create OAuth Credentials

1. Go to **APIs & Services > Credentials**
2. Click **Create Credentials > OAuth client ID**
3. Configure the consent screen (External type)
4. For Application type, select **Web application**
5. Add authorized origins:
   - `http://localhost` (for local testing)
   - Your GitHub Pages URL (e.g., `https://sumit3850.github.io`)
6. Click **Create** and copy the **Client ID**

### Step 3: Configure the Drive App

1. Open `drive-app.html` in a text editor
2. Find this line near the top of the `<script>` section:
   ```javascript
   const CLIENT_ID = 'YOUR_CLIENT_ID_HERE';
   ```
3. Replace with your actual Client ID:
   ```javascript
   const CLIENT_ID = '123456789-abc123.apps.googleusercontent.com';
   ```
4. Save the file

### Step 4: First Use

1. Open `drive-app.html` in your browser
2. Click **Connect Drive** in the sidebar
3. Click **Authorize Google Drive**
4. Sign in with your Google account and grant permissions

### Folder Structure on Drive

The app will create this folder structure on your Google Drive:

```
Island Explorer/
  Quotations/
  Tour Documents/
  Guest Lists/
  Invoices/
```

## Ops Console Setup

No configuration needed. Just open `index.html` in a browser.

### Data Persistence

All data is stored in browser `localStorage`. To back up:

```javascript
// In browser console (F12):
localStorage.getItem('ie_data')
```

To restore:

```javascript
localStorage.setItem('ie_data', '<paste backup JSON>')
```

### Customization

Edit the data arrays at the top of `src/island-explorer-ops.html` to match your tours, vehicles, and team.

## GitHub Pages Deployment

1. Push this repo to GitHub
2. Go to **Settings > Pages**
3. Select branch: `main`, folder: `/ (root)`
4. Your site will be live at `https://sumit3850.github.io/Tour-management-`

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Drive not connecting | Verify Client ID, check browser console for errors |
| Files not saving | Check browser permissions for localStorage |
| Print styling broken | Ensure `@media print` CSS is not blocked by extensions |
| WhatsApp share not working | WhatsApp Web must be active on desktop |
