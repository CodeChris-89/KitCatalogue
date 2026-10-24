# KitCatalogue — Building Kits & Mecha Hangar (Docker / Self-Hosted)

> [!NOTE]
> **AI Disclosure:** This application was extensively built and architected using Generative AI (Antigravity with Google Gemini & Claude models) in collaboration with the repository owner.

A self-hosted web application for cataloguing **Building Kits** (Gundam / Gunpla, Moshow Toys, Book Nooks, 30 Minutes Missions, Zoids, Kotobukiya, and scale models). Built with native Node.js and designed to run anywhere as a single, zero-external-dependency container with **Docker Compose**.

## Key Features

- **Owned Collection & Wishlist**: Track all kits currently in your hangar alongside upcoming releases or grail kits on your wishlist, with one-click movement from Wishlist to Owned.
- **Build Pipeline & Status Tracking**: Filter and track kits across `Backlog`, `Building`, `Panel Lining & Decals`, `Painting & Topcoat`, `Finished`, `On Hold`, and `Wishlist`.
- **Stance Photo Galleries**: Upload multiple photos per kit tagged with custom stances/poses (e.g., *Front Standing*, *Full Burst Mode*, *Aerial Stand Pose*, *LED Illuminated*, *Inner Frame WIP*), choose cover images, and view them in a full-screen lightbox.
- **Building Manuals & PDF Viewer**: Upload PDF manuals or scan images directly to each kit (with an embedded in-app PDF previewer) or attach external manual links (e.g., Dalong / Mech9) with page bookmark notes.
- **User Management (First User = Admin)**:
  - On first startup, the initial registration screen informs you that the **first registered user automatically becomes the Server Administrator**.
  - Each user gets a private collection and wishlist.
  - Administrators can toggle public registration on/off, create accounts directly, promote/demote admins, disable accounts, or remove users.
- **Self-Hosting Anywhere**: Runs on any Docker-capable system (Linux, macOS, Windows, VPS, TrueNAS, Synology, or Unraid). Configurable user permissions via `PUID`/`PGID` (default `1000:1000`) and stores the SQLite database, photos, and manuals in a single `/data` mount.

---

## Quick Start with Docker Compose

1. Clone this repository:
   ```bash
   git clone https://github.com/CodeChris-89/KitCatalogue.git
   cd KitCatalogue
   ```

2. (Optional) Copy `.env.example` to `.env` to customize your port, data directory, or UID/GID permissions:
   ```bash
   cp .env.example .env
   ```

3. Start the container with Docker Compose:
   ```bash
   docker compose up -d --build
   ```

4. Open `http://localhost:3000` (or `http://<SERVER-IP>:3000`) in your browser and register your account (the first registered user automatically becomes **Admin**).

### Unraid or Custom NAS Notes

- For Unraid users, standard permissions can be set via `.env` (`PUID=99`, `PGID=100`, `DATA_PATH=/mnt/user/appdata/kit-catalogue`).
- An XML template for Unraid's Docker Manager is optionally available at [unraid/my-KitCatalogue.xml](unraid/my-KitCatalogue.xml).

---

## Local Development (Without Docker)

Requires **Node.js 22.5+** (uses the built-in `node:sqlite` engine — no `npm install` or native compilation needed):

```bash
npm start
# or watch mode:
npm run dev
```

Run the automated end-to-end test suite:

```bash
npm test
```

---

## Legal & Copyright Compliance (German & EU Law)

- **Trademark Non-Affiliation (§ 23 MarkenG):** All product names, trademarks, and logos (e.g., *Gundam*, *Gunpla*, *Bandai Spirits*, *Moshow Toys*, *Zoids*, *Kotobukiya*) are property of their respective trademark owners (Bandai Namco Holdings Inc., Sunrise, Sotsu, Kotobukiya Co., Ltd.). KitCatalogue is an independent, non-commercial self-hosted community application for personal hobby organization and is not affiliated with, endorsed by, or sponsored by any model kit manufacturer.
- **Copyright & Web Media (§ 16, § 19a, § 53 UrhG):**
  - Automated crawling of web images is **opt-in only** and disabled by default.
  - In compliance with German copyright law, web-imported imagery and uploaded manual scans are restricted from open re-distribution in **Public Showcase** mode. Public showcases only serve user-uploaded photographs of their own physical builds.
  - Users are responsible for ensuring they possess the necessary rights for any media uploaded or published.
- **Robots.txt & Machine-Readable Opt-Outs (§ 44b Abs. 3 UrhG):**
  - Web lookup and scraper functions identify transparently via `KitCatalogue/1.0` User-Agent and respect `robots.txt` directives and `<meta name="robots" content="noindex">` tags.
  - Primary media search utilizes the Wikimedia Commons API for freely reusable Creative Commons / Public Domain images.
  - Fandom wiki lookups provide attribution under the Creative Commons Attribution-ShareAlike (CC BY-SA 3.0) license.
- **Provider Identification & Privacy (§ 5 DDG, Art. 13 DSGVO):**
  - For server operators in Germany or the EU who make their instance publicly accessible, an **Impressum** and **Privacy Notice** can be configured directly in **Admin Settings**.

