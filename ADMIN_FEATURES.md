# Admin Features Implementation

## Overview
This update implements admin capabilities in the Stamjer calendar application where only administrators can create, edit, and delete events.

## Changes Made

### 1. User Data Structure
- Added `isAdmin` field to all users in `data/users.json`
- Rick (id: 1) and Olivier (id: 16) are set as administrators with `"isAdmin": true`
- All other users have `"isAdmin": false`

### 2. Server-side Changes (`server.js`)

#### Authentication Middleware
- Added `requireAdmin()` middleware function
- Added `isUserAdmin()` helper function to check admin status

#### API Endpoints Updated
- **POST /events** - Now requires `userId` and admin privileges
- **PUT /events/:id** - Now requires `userId` and admin privileges  
- **DELETE /events/:id** - Now requires `userId` and admin privileges
- **User endpoints** - Now return `isAdmin` field in responses

### 3. Client-side Changes

#### API Service (`src/services/api.js`)
- Updated `createEvent()` to require `userId` parameter
- Updated `updateEvent()` to require `userId` parameter
- Updated `deleteEvent()` to require `userId` parameter

#### Calendar Page (`src/pages/CalendarPage.jsx`)
- Added current user state management
- Added `isAdmin` checks throughout the component
- "New Event" button only visible to admins
- Edit/Delete buttons in event modal only visible to admins
- Admin privilege checks in event handlers

#### My Account Page (`src/pages/MyAccount.jsx`)
- Added admin status display showing "👑 Administrator" or "👤 Gebruiker"

#### Navigation (`src/App.jsx`)
- Admin users show crown icon (👑) in navigation

## Admin Privileges

### What Admins Can Do:
- Create new events (via "Nieuw evenement" button)
- Edit existing events (via "✏️ Aanpassen" button)
- Delete events (via "🗑️ Verwijderen" button)
- View all events (same as regular users)

### What Regular Users Can Do:
- View all events
- Register/unregister for opkomst events
- View their account details
- All existing functionality except event management

## Security Features
- Server-side validation of admin privileges for all event operations
- User ID validation on all protected endpoints
- Graceful error handling with appropriate error messages
- Client-side UI restrictions (buttons hidden for non-admins)

## Error Messages
- Dutch language error messages for better user experience
- "Alleen admins kunnen evenementen aanmaken/bewerken/verwijderen"
- "Authenticatie vereist. Gebruiker ID ontbreekt."

## Current Admins
- **Rick Kort** (ID: 1, email: rickkort11@gmail.com)
- **Olivier Slaghekke** (ID: 16, email: slaghekkeolivier@gmail.com)

## Future Enhancements
- JWT token-based authentication for better security
- Admin panel for managing user permissions
- Audit logging for admin actions
- Role-based permissions (e.g., event organizer vs full admin)
