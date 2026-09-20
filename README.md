# Adventureland Party Console

For editable Windows packages, Docker images, release publishing, and dashboard-managed updates, see [Distribution and updates](docs/distribution.md).

Run Adventure Land characters in Steam or headless, and manage them from a browser.

## Windows installation

Install Git and Node **22.18+**. Run these commands in PowerShell; replace `<repository-url>` with this repository's clone URL.

1. Clone the repository:

   ```powershell
   git clone <repository-url> adventure_land
   cd adventure_land
   ```

2. Install dependencies and caracAL:

   ```powershell
   .\scripts\setup-caracal.ps1
   ```

3. Start the console and leave it running:

   ```powershell
   .\scripts\start-caracal.ps1
   ```

   When prompted for your game session, obtain it from a logged-in Steam character's CODE:

   ```javascript
   show_json(parent.user_id + "-" + parent.user_auth)
   ```

4. Open [http://localhost:3010](http://localhost:3010). Visit `/setup`, generate a Steam loader, and paste the generated line into Steam CODE and run it.
5. Select your characters in the dashboard and play!
6. Optional: [set up ALData](#optional-aldata-setup) to publish market classifieds.

From another computer, use `http://<host-LAN-IP>:3010`, including when generating its Steam loader. Allow Node through Windows Firewall on Private networks.

## Docker installation

Install Git and Docker with Compose. Raspberry Pi requires a **64-bit OS**. Replace `<repository-url>` with this repository's clone URL.

1. Clone the repository:

   ```sh
   git clone <repository-url> adventure_land
   cd adventure_land
   ```

2. Build the image; this installs dependencies automatically:

   ```sh
   docker compose build
   ```

3. Start the container:

   ```sh
   docker compose up -d
   ```

4. Open [http://localhost:3010](http://localhost:3010), or `http://<host-LAN-IP>:3010` from another computer. Enter your game session, select a realm, and click **Connect account**. Obtain the session from a logged-in Steam character's CODE:

   ```javascript
   show_json(parent.user_id + "-" + parent.user_auth)
   ```

   To connect Steam, visit `/setup`, generate a loader, and paste the generated line into Steam CODE and run it.
5. Select offline characters in the dashboard to run headless, and play!
6. Optional: [set up ALData](#optional-aldata-setup).

## Optional ALData setup

ALData provides public market and Ponty listings without a key. Authentication lets you publish WTS/WTB classifieds. No separate ALData container is needed.

1. Open **Settings → ALData** and click **Generate key**.
2. Click **Prepare mail**, review the gold postage, and send it.
3. Wait about a minute, then click **Check status**. `CORRECT` means setup is complete.

## Making changes

- **Dashboard:** `dashboard/`.
- **Character logic:** `runtime/characters/`; legacy shared routines are in `characters/shared.js`.
- **Coordinator:** `runtime/coordinator/`. Read its [README](runtime/coordinator/README.md) before changing behavior.

For Windows development, start with `.\scripts\start-caracal.ps1 -DevDashboard`. Dashboard edits reload automatically; character edits rebuild and publish automatically. Edit source files, not generated bundles.

For a full Windows rebuild and publication, stop the launcher and rerun `.\scripts\start-caracal.ps1`. For coordinator-only changes, use `.\scripts\start-caracal.ps1 -CoordinatorOnly`; this rebuilds and restarts services while preserving installed character assets.

For Docker changes, rebuild and restart:

```sh
docker compose up -d --build
```

## Moving dashboard state

State is local data; cloning or pushing Git does not transfer it.

| Installation | State file |
| --- | --- |
| Windows/local | `.caracal/localStorage/caraGarage.jsonl` inside the checkout |
| Docker | `/data/localStorage/caraGarage.jsonl` inside the container |

1. Stop the old installation and copy its state file. Keep the original as a backup.
2. Start the destination with the **same Adventure Land account**.
3. Open **Settings → Import dashboard state**, choose the copied file, review the settings groups, and import.

To copy the file from Docker:

```sh
docker compose stop
docker compose cp party-console:/data/localStorage/caraGarage.jsonl ./caraGarage.jsonl
```

Import replaces the listed settings groups and creates a backup automatically. It transfers settings and marks, not credentials or running jobs. Keep the old coordinator stopped; generate a new Steam loader for the destination.

## Licenses

Original code is [MIT licensed](LICENSE). Dependencies retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md). Adventure Land game files remain governed by their upstream terms.
