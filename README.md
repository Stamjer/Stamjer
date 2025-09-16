# Stamjer Calendar Application

A full-stack calendar for Stamjer members with authenticated access, attendance tracking, and admin workflows. The frontend is built with React + Vite and TanStack Query; the backend is an Express API backed by MongoDB.

## Overview

- Secure login with bcrypt-hashed passwords and password reset flows.
- Rich calendar UI (FullCalendar) with Dutch localisation and attendance management.
- Admin tooling for managing opkomsten, users, and streak calculations.
- Toast-based feedback and global error boundaries for resilient UX.

## Tech Stack

| Layer | Details |
| --- | --- |
| Frontend | React 19, Vite, React Router, TanStack Query, FullCalendar |
| Backend | Node.js, Express 5, MongoDB, Nodemailer |
| Tooling | ESLint, Vite build pipeline |

## Prerequisites

- Node.js 18 or higher (LTS recommended).
- Access to a MongoDB database (Atlas or self-hosted).
- SMTP credentials if you want to send real password reset emails (otherwise Ethereal test inbox is used).

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Create a `.env` file** based on the template below. Keep this file private; it is ignored by Git.
3. **Start the app in development**
   ```bash
   npm start
   ```
   The script runs the API and Vite dev server together. Vite serves the UI on http://localhost:5173 and proxies API requests to the backend port defined in `.env` (default 3002).

### Available Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server only. |
| `npm run api` | Start the Express API only (useful for API debugging). |
| `npm start` | Run API and frontend concurrently for local development. |
| `npm run build` | Build the production bundle. |
| `npm run preview` | Serve the production build locally. |
| `npm run lint` | Run ESLint across the project. |

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `MONGODB_URI` | yes | MongoDB connection string (database `Stamjer` is used automatically). |
| `CLIENT_ORIGIN` | yes | Comma-separated list of allowed origins for the API (e.g. `http://localhost:5173`). |
| `PORT` | yes | Port for the Express API (default 3002). |
| `NODE_ENV` | yes | `development` or `production`. Controls logging and CORS defaults. |
| `SMTP_SERVICE` | optional | Nodemailer service name (`gmail`, `outlook`, ...). Optional in development. |
| `SMTP_USER` | optional | SMTP username (email address). |
| `SMTP_PASS` | optional | SMTP password or app-specific password. |
| `SMTP_FROM` | optional | Friendly `from` address for outgoing emails. |

## Project Structure

```
api/               Express API source
public/            Static assets served by Vite
src/               React application
  components/      Shared components (error boundaries, protected routes)
  hooks/           Custom hooks (TanStack Query wrappers, toast system)
  lib/             React Query client configuration
  pages/           Feature pages (calendar, opkomsten, account, etc.)
  services/        Frontend API client
```

## Security Notes

- `.env` is ignored intentionally; never commit real credentials.
- API logging masks email addresses and avoids printing payloads in production.
- Passwords are hashed with bcrypt before writing to MongoDB.
- CORS is locked down via `CLIENT_ORIGIN`; configure it for every deployment.

## Deployment Checklist

1. Build the frontend: `npm run build` (outputs to `dist/`).
2. Provide production-ready environment variables (`NODE_ENV=production`, proper `MONGODB_URI`, `CLIENT_ORIGIN`, SMTP settings).
3. Start the API server (`npm run api`) behind a process manager (PM2, systemd, etc.) or deploy via Vercel/other hosting.
4. Serve `dist/` via your hosting platform and proxy `/api` calls to the Express server.

## Contributing

1. Fork the repo and create a feature branch.
2. Make your changes and run `npm run lint` plus `npm run build` to ensure quality.
3. Submit a pull request with a clear summary of the change and testing steps.

## License

MIT License (c) Stamjer Development Team
