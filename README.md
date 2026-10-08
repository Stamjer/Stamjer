# Stamjer Calendar Application

Full‑stack calendar for Stamjer members with authentication, attendance, and admin workflows. Frontend is React + Vite with TanStack Query and FullCalendar; backend is an Express API on MongoDB with Nodemailer for email flows.

## Features

- Auth: secure login with bcrypt, forgot/reset password via email codes
- Calendar: Dutch locale, desktop month view + mobile list/agenda, event modals
- Attendance: toggle presence per event; admins manage participants
- Admin tools: manage “opkomsten”, assign makers, edit/delete events
- Groups: isolated memberships/events/settings, developer management, transactional moves/history, audit and curated database tools
- UX quality: toasts, error boundaries, a11y, and resilient client logic

## Tech Stack

- Frontend: React 19, Vite 6, React Router, TanStack Query 5, FullCalendar 6
- Backend: Node.js, Express 5, MongoDB (Atlas or self‑hosted), Nodemailer
- Tooling: ESLint 9, Vite build, Concurrent dev for API + UI

## Prerequisites

- Node.js 20+ (LTS recommended)
- MongoDB connection string (Atlas or a local replica set; mutations require transactions)
- SMTP credentials (optional in dev; Ethereal is auto‑provisioned if not set)

## Quick Start

1) Install dependencies
   
    npm install

2) Create .env in the repo root (see Environment Variables below)

3) Run API and frontend together (recommended for local dev)
   
    npm start

    - Frontend: http://localhost:5173
    - API: http://localhost:3002 (proxied from Vite via /api)

Alternatively:

- Frontend only:
  
   npm run dev

- API only:
  
   npm run api

## Available Scripts

- npm start — run API and frontend concurrently
- npm run dev — start Vite dev server only
- npm run api — start Express API only
- npm run build — build production bundle to dist/
- npm run preview — serve the production build locally
- npm run lint — run ESLint across the project

- `npm test` - run the automated test suite
- `npm run test:watch` - run tests in watch mode
- `npm run test:groups:browser` - production UI checks with local DB/mail substitutes (Node 22+ and Chromium)
- `npm run test:groups:mongo` - optional isolated transaction/index checks with `MONGODB_GROUPS_TEST_URI`
- `npm run migrate:groups` / `npm run bootstrap:developer` - read-only migration/bootstrap previews; `--apply` enables maintenance writes

## Environment Variables (.env)

Required unless noted otherwise:

- MONGODB_URI — MongoDB connection string (DB name “Stamjer” is used automatically)
- CLIENT_ORIGIN — Comma‑separated list of allowed origins (e.g. http://localhost:5173)
- PORT — API port (default 3002)
- NODE_ENV — development or production
- TOKEN_SECRET — stable secret used to protect device sessions; changing it logs out every device
- SESSION_MAX_AGE_DAYS — optional rolling session lifetime (default 365 days)
- SESSION_TOUCH_INTERVAL_HOURS — optional interval for renewing active sessions (default 24 hours)
- SMTP_SERVICE — optional (e.g. gmail, outlook); if omitted in dev, an Ethereal test inbox is used
- SMTP_HOST / SMTP_PORT / SMTP_SECURE — alternative SMTP server configuration; production requires a host or service
- SMTP_REJECT_UNAUTHORIZED — certificate verification defaults to true
- SMTP_USER — optional; SMTP username
- SMTP_PASS — optional; SMTP password/app password
- SMTP_FROM — optional; From address for outgoing emails
- DAILY_CHANGE_EMAIL / PAYMENT_REQUEST_EMAIL - initial default-group recipients; later routing uses each group's settings

## Project Structure

```
api/index.js       Single Vercel Serverless Function (routes mounted under /api)
server/            Backend helper modules
public/            Static assets served by Vite
src/               React application
   components/      Shared components (error boundaries, protected routes)
   hooks/           TanStack Query wrappers, toast system
   lib/             React Query client configuration
   pages/           Calendar, Opkomsten, Account, etc.
   services/        Frontend API client
```

## API Overview

Base path: /api

- GET /api/test — health check
- GET /api/users — list basic user data
- GET /api/users/full — list users incl. canonical status and computed “streepjes”
- POST /api/users — create a user (admin)
- GET /api/events — list all events
- GET /api/events/opkomsten — list only opkomsten
- POST /api/events — create event (admin)
- PUT /api/events/:id — update event (admin)
- DELETE /api/events/:id — delete event (admin)
- PUT /api/events/:id/attendance — toggle attendance for a user
- POST /api/login — login
- POST /api/forgot-password — request reset code via email
- POST /api/reset-password — reset password using code
- POST /api/change-password — change password when logged in
- GET /api/calendar/subscription — authenticated secret group subscription URL
- GET /api/calendar.ics — own-group browser feed, or external group feed with a valid secret token
- PATCH /api/users/:id — scoped management; roles are developer-only
- POST /api/users/:id/password-email — confirmed invitation/reset email action
- POST /api/users/:id/group/preview and PATCH /api/users/:id/group — developer-only transactional moves
- /api/groups — developer group management and calendar-token rotation
- /api/developer/database — curated inspection/audit and guarded JSON preview/confirmation

Notes:

- User and JSON event endpoints require an authenticated session and group authorization; developer reads require explicit `groupId` or `allGroups=true`. External `.ics` subscriptions require a secret group token.
- CORS is restricted via CLIENT_ORIGIN (with dev fallbacks for localhost and Vercel envs)
- MongoDB collections: users, events, groups, userGroupHistory, auditLogs, resetCodes, sessions (with indexes ensured on startup)
- Passwords are hashed with bcrypt before storing

## Development Workflow

- Vite proxies /api → http://localhost:3002 (configured in vite.config.js)
- Use npm start to launch API (Express) and UI (Vite) concurrently
- Error handling logs to console; sensitive data is masked or avoided
- Modal and forms are keyboard accessible; toasts provide feedback

## Build & Preview

- Build: npm run build (outputs to dist/)
- Preview: npm run preview (serves the built site locally)

## Deployment

Follow [Groups remodel deployment and administration](docs/groups-remodel.md) for the production maintenance window, verified complete `Stamjer` backup, migration, bootstrap, SMTP, calendar subscription changes and production validation. Use the existing Atlas cluster; rollback restores both the database and matching previous code. Migration/bootstrap default to read-only; their apply commands require stopped writers and a verified backup. Keep compatibility fallbacks until persisted migration is verified.

### Vercel

This repo includes vercel.json:

- Builds:
   - @vercel/static-build for the Vite app (dist)
   - @vercel/node for api/index.js
- Routes:
   - /api/(.*) → api/index.js
   - All other paths → index.html (SPA fallback)
Set the required environment variables on Vercel (MONGODB_URI, CLIENT_ORIGIN, NODE_ENV, SMTP_* as needed).

### Other hosting

1) Build frontend: npm run build
2) Serve dist/ as static assets
3) Run API server (npm run api) behind a process manager (PM2, systemd)
4) Proxy /api from your web server to the API process

## Security Notes

- .env is git‑ignored; never commit real credentials
- Emails and sensitive values are masked in logs; payload logging is limited
- CORS is locked down via CLIENT_ORIGIN; configure for each deployment

## Contributing

1) Create a feature branch from main
2) Make changes, run npm run lint and npm run build
3) Open a PR with a clear summary and testing steps

## License

MIT License (c) R.S. Kort
