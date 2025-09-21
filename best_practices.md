# 📘 Project Best Practices

## 1. Project Purpose
AJK Cleaning Company website and admin system. The project provides:
- A marketing site (public) with contact form and chat widget.
- An Express.js server exposing APIs for form submissions, chat history, statistics, and authentication.
- A WebSocket-based live chat infrastructure between site visitors and admin(s), with offline message support and persistence using LowDB.
- An Admin Panel (admin.html) to manage submissions, view chat clients/history, chat live, export CSV, and perform moderation tasks.

## 2. Project Structure
- Root
  - `server.js`: Express HTTP server + WebSocket chat server. API endpoints, middleware, security headers, session handling, DB initialization.
  - `index.html`: Public website (Tailwind via CDN), chat widget, contact form.
  - `admin.html`: Admin dashboard (login, submissions, chats, CSV export, websocket control).
  - `styles.css`, `admin.css`: Styling for public/admin (some CSS inlined in HTML).
  - `script.js`: Client-side behavior for public site (e.g., form handling, UI interactions).
  - `db.json`: LowDB JSON data store (submissions, chats, admin users, offline messages).
  - `submissions.db`: Legacy/aux data file (ensure only one source of truth; prefer LowDB JSON).
  - `routes/`, `models/`, `utils/`: Supplemental modularization (e.g., FormSubmission model, email service). Prefer keeping server logic centralized in `server.js` or move production pieces into routes/services.
  - `images/`: Static image assets.
  - `render.yaml`: Deployment configuration (Render.com).
  - `.env`: Runtime configuration (secrets, env-specific settings).

Key roles
- Chat: WebSocket server manages client/admin sessions, message routing, offline storage, persistence.
- API: `/api/*` endpoints for submissions, statistics, chat CRUD/history, and admin auth.
- Security: CORS, CSP headers, session cookies, rate limiting for general and login endpoints.

## 3. Test Strategy
Currently, no test framework is set up. Recommended:
- Framework: Jest for server (unit + integration) and Playwright for E2E (optional).
- Structure:
  - `__tests__/server/*.test.js` for API and WebSocket integration tests.
  - Mock LowDB with an in-memory adapter (or temp files) to avoid touching real data.
- Coverage expectations: Aim for 70%+ initially on server routes, 80%+ on pure utilities.
- Scenarios to test:
  - Auth flows: login/logout/status, session cookie behavior.
  - Submissions: POST validation, GET list, GET by id, DELETE; statistics accuracy.
  - Chat: WebSocket lifecycle (connect, identify, chat, typing), admin vs client message routing, offline message storage/delivery, one-time offline auto-reply logic, delete-chat reset.
  - Security: Rate limit behavior, CORS acceptance/rejection, CSP header presence.

## 4. Code Style
- Language: JavaScript (Node + browser). Use modern JS (const/let, arrow functions, template literals).
- Async: Prefer async/await with try/catch and explicit early returns on validation errors.
- Naming:
  - Functions/methods: camelCase (`sendToClient`, `broadcastToClients`).
  - Variables: camelCase (`adminOnline`, `clientId`).
  - Constants: UPPER_SNAKE_CASE when appropriate (`SESSION_SECRET`, `NODE_ENV`).
  - Files: kebab-case or camelCase. Keep server entrypoint as `server.js`.
- Comments/Docs: Document non-trivial logic (e.g., reconnection, offline messaging). Keep inline comments concise; prefer self-explanatory code.
- Error handling: Always guard external inputs; validate existence and types before dereferencing. For DB access with LowDB, ensure `db.data` and sub-objects are initialized before use.
- Logging: Avoid logging PII. Wrap verbose logs behind a debug flag and keep production logs concise.

## 5. Common Patterns
- Persistence:
  - LowDB JSON store with strict guards: always `await db.read()` before reads and ensure `db.data`, `db.data.chats`, `db.data.offline_messages` exist; `await db.write()` after mutations.
- WebSocket Chat:
  - Clients registry Map keyed by `clientId` with session info.
  - Broadcast helpers (`broadcastToAll`, `broadcastToClients`) centralize routing.
  - De-duplication: Avoid duplicate messages by checking timestamps/content.
  - Heartbeat: Ping/pong with termination of dead connections.
- Security/Middleware:
  - CORS with allowlist.
  - CSP headers (connect-src includes ws/wss to host).
  - Session cookies configured by environment (secure/sameSite).
  - Rate limiting for `/api/*` and stricter limits on login.
- Admin Panel UI:
  - Debounced search inputs.
  - Defensive rendering (escape HTML), guard undefined fields.
  - Pagination, sorting, filtering on client-side for submissions.

## 6. Do's and Don'ts
### ✅ Do
- Initialize LowDB structures before accessing nested properties.
- Validate and sanitize user inputs server-side (validator.js is already used).
- Escape HTML content before injecting into admin UI to prevent XSS.
- Use credentials: 'include' for admin API calls that rely on session cookies.
- Keep non-submit buttons with `type="button"` to avoid accidental form submissions.
- Normalize phone numbers and emails (E.164 format where applicable) and keep consistent in JSON-LD.
- Use `rel="noopener noreferrer"` for external links with `target="_blank"`.
- Prefer one source of truth for persistence (LowDB) and avoid drifting secondary files.
- Gate debug logging and localStorage persistence behind flags.

### ❌ Don’t
- Access `db.data.chats[clientId]` without ensuring `db.data` and `db.data.chats` exist.
- Trust client JSON blindly. Always validate and guard types.
- Log full message bodies or PII in production.
- Rely on inline JS/CSS for long-term security posture; prefer external files for CSP hardening.
- Introduce duplicate welcome/auto messages. Keep one source of truth server-side.

## 7. Tools & Dependencies
- Server
  - Express: HTTP server and routing.
  - ws: WebSocket server for live chat.
  - lowdb: Lightweight JSON persistence; JSONFile adapter.
  - express-session + memorystore: Session management.
  - bcryptjs: Password hashing.
  - validator: Input validation/sanitization.
  - express-rate-limit: Global and login-specific throttling.
  - cors: CORS control.
  - dotenv: Environment configuration.
- Frontend
  - Tailwind CDN for rapid styling (consider static build for production).
  - Font Awesome CDN for icons.

Setup
- Install: `npm ci` (or `npm install`).
- Env: `.env` (optional) for PORT, NODE_ENV, SESSION_SECRET, DB_PATH.
- Run: `node server.js` (or `nodemon server.js` in development).
- Deploy: `render.yaml` outlines Render configuration (ensure environment variables and persistent data volume).

## 8. Other Notes
- WebSocket origins are allowlisted; update `allowedOrigins` in `server.js` when adding domains.
- CSP `connect-src` dynamically sets ws/wss to the current host. Update if proxying through a different domain.
- Offline Auto-Reply logic:
  - Sends exactly once per chat when no admin is online, flagged by `offlineAutoMessageSent` in the chat object.
  - Deleting a chat marks it `deleted`; on next client session, a fresh chat object is created, resetting flags and history.
- CSV Export Safety:
  - CSV outputs are sanitized to neutralize spreadsheet formulas and escape quotes.
- Future Improvements:
  - Add automated tests (Jest/Playwright) and CI.
  - Migrate inline CSS/JS to external files for stricter CSP (nonce or hashes).
  - Add SRI to CDN assets or self-host.
  - Consider a proper DB in production (PostgreSQL) and WebSocket auth via JWT or session validation.
