# Adventureland Party Console

For editable Windows packages, Docker images, release publishing, and dashboard-managed updates, see [Distribution and updates](docs/distribution.md).

Run Adventure Land characters in Steam or headless, and manage them from a browser.

## Windows installation

Install Git and Node **22.18+**. Run these commands in PowerShell.

1. Clone the repository:

   ```powershell
   git clone https://github.com/Ryan-Haines/adventureland-party-console.git
   cd adventureland-party-console
   ```

2. Install dependencies and caracAL:

   ```powershell
   .\scripts\setup-caracal.ps1
   ```

3. Start the console and leave it running:

   ```powershell
   .\scripts\start-caracal.ps1
   ```

   You only need to connect your account once. In the **Adventure Land Steam client**, log in to a character, open **CODE**, paste the following line, and click **Engage**. Copy the displayed session into the PowerShell prompt:

   ```javascript
   show_json(parent.user_id + "-" + parent.user_auth)
   ```

4. Open [http://localhost:3010](http://localhost:3010), then **Interface settings > Load setup**. To control characters in Steam or a browser, click **Generate client loader**, paste the code into your game client's **CODE** window, and click **Engage**. Once connected, setup returns to the dashboard automatically. For fully headless play, log out your characters from other game windows and click **Continue to dashboard**.
5. Select your characters in the dashboard and play!
6. Optional: [set up ALData](#optional-aldata-setup) to publish market classifieds.

From another computer, use `http://<host-LAN-IP>:3010`, including when generating its Steam loader. Allow Node through Windows Firewall on Private networks.

## Docker installation

Install Git and Docker with Compose. Raspberry Pi requires a **64-bit OS**.

1. Clone the repository:

   ```sh
   git clone https://github.com/Ryan-Haines/adventureland-party-console.git
   cd adventureland-party-console
   ```

2. Build the image; this installs dependencies automatically. If you get an error make sure you have installed the docker compose plugin

   ```sh
   ./scripts/start-docker.sh
   ```

   This builds from your checked-out source, starts the container in the background, and waits up to five minutes for it to become ready. When ready, it prints **Party Console ready! Open at** followed by your server address. Your saved account and character data are preserved when you run it again.

3. If you prefer to build and start separately, use these commands instead:

   ```sh
   docker compose build
   docker compose up -d
   ```

4. Open the address printed by the helper. With the manual commands, open [http://localhost:3010](http://localhost:3010), or `http://<host-LAN-IP>:3010` from another computer. You only need to connect your account once. In the **Adventure Land Steam client**, log in to a character, open **CODE**, paste the following line, and click **Engage**. Copy the displayed session into **Game session** in the console, select a realm, and click **Connect account**.

   ```javascript
   show_json(parent.user_id + "-" + parent.user_auth)
   ```

   Setup then offers two paths: paste the generated loader into your Steam or browser client's **CODE** window and click **Engage**, or log out your characters from other game windows and click **Continue to dashboard** for fully headless play. A connected client triggers a five-second return to the dashboard. The server address is detected automatically. You can revisit this step through **Interface settings > Load setup**.
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
