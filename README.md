# KitCatalogue — Building Kits & Mecha Hangar (Unraid / Docker)

A self-hosted web application for cataloguing **Building Kits** (Gundam / Gunpla, Moshow Toys, Book Nooks, 30 Minutes Missions, Zoids, Kotobukiya, and scale models). Designed to run as a single, zero-external-dependency Docker container on **Unraid** with **Docker Compose**.

## Key Features

- **Owned Collection & Wishlist**: Track all kits currently in your hangar alongside upcoming releases or grail kits on your wishlist, with one-click movement from Wishlist to Owned.
- **Build Pipeline & Status Tracking**: Filter and track kits across `Backlog`, `Building`, `Panel Lining & Decals`, `Painting & Topcoat`, `Finished`, `On Hold`, and `Wishlist`.
- **Stance Photo Galleries**: Upload multiple photos per kit tagged with custom stances/poses (e.g., *Front Standing*, *Full Burst Mode*, *Aerial Stand Pose*, *LED Illuminated*, *Inner Frame WIP*), choose cover images, and view them in a full-screen lightbox.
- **Building Manuals & PDF Viewer**: Upload PDF manuals or scan images directly to each kit (with an embedded in-app PDF previewer) or attach external manual links (e.g., Dalong / Mech9) with page bookmark notes.
- **User Management (First User = Admin)**:
  - On first startup, the initial registration screen informs you that the **first registered user automatically becomes the Server Administrator**.
  - Each user gets a private collection and wishlist.
  - Administrators can toggle public registration on/off, create accounts directly, promote/demote admins, disable accounts, or remove users.
- **Unraid Ready**: Supports `PUID` (`99`) and `PGID` (`100`) out of the box and persists the SQLite WAL database, stance photos, and PDF manuals in a single `/data` volume (`/mnt/user/appdata/kit-catalogue`).

---

## Quick Start with Docker Compose (Unraid or Standard Linux)

1. Optional: copy `.env.example` to `.env` and adjust the port or Unraid appdata path:
   ```bash
   cp .env.example .env
   ```
2. Start the container with Docker Compose:
   ```bash
   docker compose up -d --build
   ```
3. Open `http://<YOUR-UNRAID-IP>:3000` in your browser and register your first account (which automatically becomes **Admin**).

### Unraid Compose Manager / Docker XML Template

- **Docker Compose Manager Plugin**: Point your stack to [docker-compose.yml](docker-compose.yml). By default, it includes Unraid WebUI labels (`net.unraid.docker.webui`).
- **Unraid Native Template**: An XML template is also included at [unraid/my-KitCatalogue.xml](unraid/my-KitCatalogue.xml), which can be copied to `/boot/config/plugins/dockerMan/templates-user/` on your Unraid flash drive.

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
