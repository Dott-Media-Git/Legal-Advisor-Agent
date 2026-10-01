# Legal Advisor

Legal Advisor is a unified legal platform with two connected experiences:

- Legal Advisor, a public Uganda-first legal triage and lawyer-matching experience at `/`
- the professional Legal Operating System for lawyers at `/lawyer`

The shared platform includes:

- session-based sign-in
- SQLite-backed persistence
- matter and client workspace views
- document upload to local storage
- OpenAI-powered assistant queries and structured draft generation
- persistent matters, legal risk/confidence classification, cited legal sources, consent-based referrals, and automatic LOS matter creation

## Run

1. Configure environment variables. The simplest starting point is:

```powershell
$env:OPENAI_API_KEY="your_key_here"
$env:SUPABASE_URL="https://your-project.supabase.co"
$env:SUPABASE_ANON_KEY="your_anon_key"
$env:SUPABASE_SERVICE_ROLE_KEY="your_server_only_service_role_key"
```

2. Start the app:

```powershell
npm start
```

3. Open `http://127.0.0.1:4173` for Legal Advisor or `http://127.0.0.1:4173/lawyer` for the lawyer workspace.

## Test

```powershell
npm test
```

The end-to-end test covers client intake, Uganda employment classification, follow-up questions, legal sources, risk assessment, lawyer matching, consent, referral creation, automatic LOS matter creation, and lawyer acceptance.

## Deploy / Host

This app can run in a container or on any Node.js host that supports a web service.

### Docker

```powershell
docker build -t ai-los .
docker run -p 4173:4173 -e OPENAI_API_KEY="your_key_here" ai-los
```

### Cloud hosting

Use your preferred Node.js host (Render, Fly, Railway, etc.) and configure:

- Build command: `npm install`
- Start command: `npm start`
- Environment variables:
  - `OPENAI_API_KEY`
  - `AI_LOS_ADMIN_EMAIL`
  - `AI_LOS_ADMIN_PASSWORD`

The server now binds to `0.0.0.0`, so platform-assigned ports work automatically.

There is no default account. Create a civilian or lawyer account at `/signup`. Optional admin credentials are created only when both `AI_LOS_ADMIN_EMAIL` and `AI_LOS_ADMIN_PASSWORD` are explicitly configured. Demo records are disabled unless `AI_LOS_SEED_DEMO=true`.

## Storage

- SQLite database: `data/ai-los.db`
- Seed data source: `data/store.json`
- Uploaded files: `uploads/`

## Notes

- OpenAI calls are server-side only.
- If `OPENAI_API_KEY` is missing, the app still works for login, matters, and uploads, but AI actions return a configuration error.
- Text-based uploads such as `.txt`, `.md`, `.json`, `.csv`, and `.xml` are immediately useful for AI context because their text is extracted locally.

## Main files

- `server.mjs` - auth, SQLite persistence, uploads, and OpenAI API routes
- `app/app.js` - frontend state, login flow, drafting UI, and uploads
- `app/styles.css` - application styling
