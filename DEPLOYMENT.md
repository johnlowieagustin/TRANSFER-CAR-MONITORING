# Deployment guide

Files: `Code.gs`, `appsscript.json` (backend) · `config.js`, `gs-client.js`, `inv-page.js`, `index.html`, `Inventory_In.html`, `Inventory_Out.html`, `corrugated_inventory_dashboard.html` (website).

## 1. Prepare the Google Sheet
1. Upload `Inventory_Master.xlsx` to Google Drive, open it with Google Sheets, then **File > Save as Google Sheets**. (Or create a new Sheet and use File > Import.)
2. Keep these tab names exactly: `INVENTORY IN`, `INVENTORY OUT`, `CORRUGATED SKU`. Column headers must match your Excel headers (the pages need: ENTRY ID, WEEK NO., DATE/TIME, TIME IN / TIME OUT, SHIFT, QUANTITY, DELIVERED TO (OUT only), SKU/ITEM CODE, DESCRIPTION, CUSTOMER; SKU sheet: SKU, DESCRIPTION, CUSTOMER, optional BOX TYPE, BOX CAPACITY).
3. **File > Settings**: set the time zone to your plant's time zone (must equal the Apps Script time zone in step 2).

## 2. Add the backend
1. In the Sheet: **Extensions > Apps Script**. Delete the sample code and paste all of `Code.gs`.
2. **Project Settings** (gear icon) > tick **Show "appsscript.json" manifest file**; open it and paste `appsscript.json` (set `timeZone` to your zone, e.g. `Asia/Manila`).
3. Save. Select function **setup** > **Run**. Approve the permissions (Advanced > Go to project). This creates the `USERS` and `AUDIT LOG` sheets, an `Admin` user with a random PIN, and the triggers that notify the pages when you edit the Sheet by hand.

## 3. Create users
Open the `USERS` sheet. One row per person: `NAME`, `PIN` (4+ characters, format the column as plain text), `ROLE`, `ACTIVE`.
- `ADMIN` – view, add, edit, delete · `ENCODER` – view, add, edit · `VIEWER` – dashboard only
- Set `ACTIVE` to `NO` to block someone. Change the generated Admin PIN now. Keep this Sheet private (share it only with administrators); the PINs are stored here.

## 4. Deploy the Web App
Apps Script > **Deploy > New deployment** > type **Web app** > Execute as **Me** > Who has access **Anyone** > Deploy. Copy the **Web app URL** (ends in `/exec`).
After any later change to `Code.gs`: Deploy > Manage deployments > edit (pencil) > Version: **New version** > Deploy (the URL stays the same).

## 5. Connect the website
Open `config.js` and paste the URL between the quotes of `API_URL`.

## 6. Publish the website (free options)
- **Netlify:** go to app.netlify.com/drop and drag the folder with the 8 website files. You get an `https://….netlify.app` link.
- **GitHub Pages / Cloudflare Pages:** upload the 8 website files (not `Code.gs`) to a repository and enable Pages.
Share the link. Everyone signs in with their name + PIN; all entries go to the same Sheet. "Keep me signed in" is for the plant's own PCs/monitors only.

## 7. Check it works
1. Open Inventory In, sign in, submit a test entry: a new row appears in `INVENTORY IN`, and a line in `AUDIT LOG`. Delete the test entry afterwards (Admin).
2. Open the dashboard on another device; add an entry or edit a cell in the Sheet: the dashboard updates within `REFRESH_SEC` seconds (default 20) without reloading.

## Notes
- Lists of shifts and flexo machines are `CONFIG` at the top of `Code.gs`.
- Pages refresh only when the Sheet changed (a tiny check each interval), which keeps you within Apps Script quotas. Use 20 s or more if many screens are open.
- Wrong PINs: 5 attempts, then a 10-minute lockout for that name.
- Back up: File > Version history is on automatically; the `AUDIT LOG` records who added/edited/deleted what.
