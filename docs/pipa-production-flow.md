# Pacer production flow for Pipa

Pacer is a private application running on Pipa (`raspberrypi`). Pipita
(`pizero`) hosts only the separate public Astro website, `run.nico.ar`.

## Production topology

```text
Pipa / raspberrypi
  /srv/repos/personal/argensonix/labs/pacer
  Node.js backend and private web frontend
  SQLite storage
  systemd user service: pacer.service

Pipita / pizero
  public Astro website: run.nico.ar
```

The Pacer service runs from its existing working directory and serves the
private frontend directly from `web/`. The public site is deployed through its
own repository and publishing workflow.

## Pipa backend deployment

Run this on Pipa from the existing Pacer working directory:

```bash
cd /srv/repos/personal/argensonix/labs/pacer
npm run build
systemctl --user restart pacer.service
curl -fsS http://127.0.0.1:8787/api/healthz
```

Then inspect the service when needed:

```bash
systemctl --user status pacer.service --no-pager -n 30
journalctl --user -u pacer.service -n 80 --no-pager
```

Application migrations run through the normal Pacer storage initialization.
Before a production schema migration, create and verify a private SQLite online
backup recovery snapshot; do not copy a live SQLite file while WAL is active.

## Important boundaries

- Do not use `scripts/deploy/deploy-full.sh` or
  `scripts/deploy/deploy-frontend.sh` for the Pipa backend. They are legacy
  release tooling targeting the old Pipita Pacer layout.
- Do not use those scripts to deploy `run.nico.ar`; the public Astro site has
  its own repository and deployment procedure.
- Preserve the existing working tree and runtime storage during deployments.
- Restart only `pacer.service` for a Pacer backend deployment.
