# Security policy

## Supported version

Only the `main` branch is maintained. There are no releases; fixes land on `main`.

## Reporting a vulnerability

Please report it privately through GitHub's private vulnerability reporting:
**Security → Report a vulnerability** on this repository. Do not open a public issue.

Include what you found, how to reproduce it and what it lets an attacker do. The answer comes through the same private report.

## In scope

The code in this repository, in particular:

- the magic-link login (`src/routes/auth.routes.js`, `src/middleware/auth.js`): token expiry and single use,
  the session cookie, the `next` redirect;
- authorisation of the admin and instructor panels (`src/routes/admin.routes.js`, `src/routes/instructor.routes.js`);
- the same-origin check on state-changing requests (`src/middleware/sameOrigin.js`), rate limits and headers
  (`src/middleware/security.js`);
- escaping of user-supplied data in the views (`views/`);
- booking capacity and the waiting list (`src/models/database.js`, `src/services/waitingList.js`);
- the Dockerfile and `docker-compose.yml`.

## Out of scope

- Any running deployment of the software. Do not test against a live site, its users or its e-mail.
- Third-party services (Resend, Google Maps, Google Fonts) and vulnerabilities in dependencies with no
  demonstrated impact here.
- The limitations already documented in the README (*Known limitations*): `'unsafe-inline'` scripts in the CSP,
  sessions that cannot be revoked before they expire, in-memory rate limits.
