# Deployment

The app runs as one container from a published image, behind a reverse proxy that terminates TLS. This page covers
the image, the configuration, the proxy, the first start, deployments and rollbacks, and the data.

## The image

`.github/workflows/image.yml` builds the image on a native runner for each architecture (`linux/amd64`,
`linux/arm64`, nothing emulated) and publishes one multi-architecture tag to `ghcr.io/prod-explore/climbing-booking`:

| Tag | When |
| --- | --- |
| `latest` | every push to `main` |
| `sha-<short commit>` | every push to `main` and every `v*` tag |
| `<version>` | a `v*` tag, for example `v1.2.0` gives `1.2.0` |

Pull requests only build it. The image runs as the `node` user, keeps its database in `/app/data`, and has a Docker
health check on `GET /healthz`.

## Configuration

The server reads `.env` from the repository root (`docker-compose.yml` passes it as `env_file`). `.env.example` lists
the variables with comments. `docker-compose.yml` always sets `NODE_ENV=production`, `PORT=3000` and
`DB_PATH=/app/data/climbing-booking.db`, whatever `.env` says.

| Variable | Default | Notes |
| --- | --- | --- |
| `APP_URL` | `http://localhost:<PORT>` outside production | Required in production. The public `https://` address; links in e-mails and the canonical and preview tags are built from it. |
| `JWT_SECRET` | none | Required. Signs the session cookies. At least 32 characters, not the placeholder, not a few repeated characters: `openssl rand -hex 32`. A new value signs everybody out. |
| `IP_HASH_SECRET` | derived from `JWT_SECRET` | Key for the HMAC of QR visitors' IP addresses; checked like `JWT_SECRET`. Changing it, or `JWT_SECRET` while it is unset, makes new hashes differ from stored ones. |
| `ALLOW_WEAK_SECRETS` | off | `true` turns the secret check into a warning. Local work only. |
| `ADMIN_EMAILS` | none | Comma-separated. Admin rights follow this list on every request: an address removed from it (and the app restarted) loses them at once, open sessions included. Only these addresses are sent an admin login link. |
| `RESEND_API_KEY` | none | Without it in production the app starts, but no e-mail can be sent, login links included. Outside production e-mails are printed to the console instead. |
| `EMAIL_FROM` | `Fantastyczne Wspinanie <noreply@<host of APP_URL>>` | Its domain must be verified in Resend. |
| `CONTACT_EMAIL` | `contact@example.com` | Shown in the footer, the privacy policy and the e-mails. |
| `EMAIL_REPLY` | `CONTACT_EMAIL` | Reply-To of the e-mails. |
| `DB_PATH` | `data/climbing-booking.db` | Set by `docker-compose.yml` in the container. |
| `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS` | `900000`, `100` | Every request per client IP except `/healthz`, static files included. |
| `MAGIC_LINK_RATE_LIMIT_MAX` | `5` | Login-link requests per IP and hour. |
| `MAGIC_LINK_EMAIL_LIMIT_MAX` | `3` | Login-link requests per address and hour, from any IP. |

Two limits are fixed in `src/middleware/security.js`: 30 booking submissions per IP in 10 minutes, and 10 admin
login requests per IP in 15 minutes.

`scripts/deploy.sh` reads two more: `DEPLOY_WAIT_SECONDS` (default `90`) and, through Compose,
`CLIMBING_BOOKING_IMAGE_TAG` (default `latest`), which it sets itself.

## Reverse proxy

The app container publishes no port. It is attached to the Docker network `climbing-booking-network`, which
`docker-compose.yml` creates under that fixed name, and answers there as `climbing-booking-app:3000`. The proxy
container joins that network from its own Compose project:

```yaml
services:
  nginx:
    image: nginx:1.28-alpine
    ports:
      - "80:80"
      - "443:443"
    networks:
      - climbing-booking-network

networks:
  climbing-booking-network:
    external: true
```

The proxy has to do three things:

- **Pass the browser's `Host` header.** The same-origin check (`src/middleware/sameOrigin.js`) compares the host in
  `Origin` with `Host`. nginx sends the upstream's name by default, and then every form submission is refused with
  403.
- **Set `X-Forwarded-For`.** The app trusts exactly one proxy hop, so `req.ip`, which the rate limits and the QR-visit
  hash use, is the address the proxy saw. Another proxy in front of it (a CDN, for example) would make that the CDN's
  address for every visitor.
- **Serve HTTPS.** In production the session cookie is `Secure`, so a browser does not send it over plain HTTP.

The matching nginx `location`:

```nginx
location / {
    proxy_pass http://climbing-booking-app:3000;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

[[Q6: Should this section link to the reverse-proxy setup you use (your nginx reverse-proxy repository), and is it public?]]

## First start

1. Clone the repository on the server; it provides `docker-compose.yml`, `.env.example` and `scripts/deploy.sh`.
2. `cp .env.example .env` and fill it in: `APP_URL`, a generated `JWT_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM` on a
   domain verified in Resend, `CONTACT_EMAIL` and `ADMIN_EMAILS`. Leave `NODE_ENV` as it is; Compose overrides it.
3. Run `scripts/deploy.sh`.
4. Sign in at `/admin/login` and fill in `/admin/settings`: the data controller, its seat and NIP, and the venue.
   Until then the public pages print placeholders such as `[nazwa administratora danych]` and the admin dashboard
   shows a reminder. The venue address also turns on the map on the home page.
5. Add the instructors at `/admin/instructors`, then the classes, or one week of classes copied forward with
   *Clone week*.

## Deploying and rolling back

```sh
scripts/deploy.sh               # the newest image (`latest`)
scripts/deploy.sh sha-1a2b3c4   # a given build
```

The script pulls the tag, recreates the container and polls Docker's health status. If the container is not healthy
within `DEPLOY_WAIT_SECONDS`, it prints the last 20 log lines, retags the image that was running before as
`rollback` and starts that. For a manual rollback, pass the `sha-` tag of an earlier build.

A rollback changes the image, not the database. Migrations run when the new image starts, so a rolled-back image may
meet a schema with newer columns. The migrations add tables, columns and indexes (008 also fills its new columns),
except 009, which drops `participants.child_age`: an image built before it fails on every booking, so roll back past
009 only together with a database backup taken before it.

To build the image on the server instead of pulling it: `docker compose up -d --build`.

## Data and backups

The database is one SQLite file, `/app/data/climbing-booking.db`, on the named volume `climbing_booking_data`, with
its `-wal` and `-shm` files next to it. Deployments and `docker compose down` keep the volume; `docker compose down -v`
deletes it.

There is no scheduled backup. SQLite's online backup copies the database consistently while the app is running:

```sh
docker exec climbing-booking-app node -e "require('better-sqlite3')('/app/data/climbing-booking.db').backup('/app/data/backup.db').then(() => console.log('done'))"
docker cp climbing-booking-app:/app/data/backup.db ./climbing-booking-backup.db
```

To restore, stop the container and put the file back on the volume as `climbing-booking.db`, without the old `-wal`
and `-shm` files.

## Logs and health

- `docker logs climbing-booking-app` shows the access log (Apache combined format) and the app's own messages. The
  `token` query parameter of login links is printed as `[redacted]`. Docker keeps three files of 10 MB.
- `GET /healthz` answers `ok` when the database answers `SELECT 1`, and 503 otherwise. It is not rate limited.
- The container is limited to 512 MB of memory and half a CPU (`docker-compose.yml`).
