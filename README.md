# Stamjer Calendar Application

Full‑stack calendar for Stamjer members with authentication, attendance, and admin workflows. Frontend is React + Vite with TanStack Query and FullCalendar; backend is an Express API on MongoDB with Nodemailer for email flows.

## Features

- Auth: secure login with bcrypt, forgot/reset password via email codes
- Calendar: Dutch locale, desktop month view + mobile list/agenda, event modals
- Attendance: toggle presence per event; admins manage participants
- Admin tools: manage “opkomsten”, assign makers, edit/delete events
- UX quality: toasts, error boundaries, a11y, and resilient client logic

## Tech Stack

- Frontend: React 19, Vite 6, React Router, TanStack Query 5, FullCalendar 6
- Backend: Node.js, Express 5, MongoDB (Atlas or self‑hosted), Nodemailer
- Tooling: ESLint 9, Vite build, Concurrent dev for API + UI

## Prerequisites

- Node.js 18+ (LTS recommended)
- MongoDB connection string (Atlas or local)
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

## Environment Variables (.env)

Required unless noted otherwise:

- MONGODB_URI — MongoDB connection string (DB name “Stamjer” is used automatically)
- CLIENT_ORIGIN — Comma‑separated list of allowed origins (e.g. http://localhost:5173)
- PORT — API port (default 3002)
- NODE_ENV — development or production
- SMTP_SERVICE — optional (e.g. gmail, outlook); if omitted in dev, an Ethereal test inbox is used
- SMTP_USER — optional; SMTP username
- SMTP_PASS — optional; SMTP password/app password
- SMTP_FROM — optional; From address for outgoing emails
- DAILY_LOG_EMAIL — optional; recipient for daily log summaries

## Project Structure

```
api/               Express API source (routes mounted under /api)
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
- GET /api/users/full — list users incl. flags and computed “streepjes”
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

Notes:

- CORS is restricted via CLIENT_ORIGIN (with dev fallbacks for localhost and Vercel envs)
- MongoDB collections: users, events, resetCodes (with indexes ensured on startup)
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
