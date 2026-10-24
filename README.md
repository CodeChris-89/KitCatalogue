# KitCatalogue — Building Kits & Mecha Hangar (Docker / Self-Hosted)

> [!NOTE]
> **AI Disclosure:** This application was extensively built and architected using Generative AI (Antigravity with Google Gemini & Claude models) in collaboration with the repository owner.

A self-hosted web application for cataloguing **Building Kits** (Gundam / Gunpla, Moshow Toys, Book Nooks, 30 Minutes Missions, Zoids, Kotobukiya, and scale models). Designed to run anywhere as a single, zero-external-dependency container with **Docker Compose**.

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
