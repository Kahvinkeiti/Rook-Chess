# Rook Chess

A responsive chess site with a local game and an online-play foundation.

## Current files

- `index.html` — local chess game
- `online.html` — online sign-in, friend invites, live games and leaderboard UI
- `config.js` — public Supabase connection settings (currently a placeholder)
- `supabase/schema.sql` — profiles, game records, access policies and profile creation trigger
- `supabase/functions/chess-api/index.ts` — authenticated game API, server-side legal-move checks, resignations and ELO updates

## Online setup required

The online code is committed, but it will not work until Supabase is active and configured.

1. Open the Supabase project dashboard and restore the existing project if it is paused/inactive. Check its current plan and any costs before restoring.
2. In Supabase SQL Editor, run the contents of `supabase/schema.sql`.
3. In Project Settings → API / Connect, copy the project URL and **publishable** key. Put them in `config.js`. Never use a secret or `service_role` key in browser files.
4. Deploy the Edge Function named `chess-api` from `supabase/functions/chess-api/index.ts`, with JWT verification enabled. Supabase's Edge Function environment must have its standard `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` secrets configured. Never commit the service-role key.
5. In Supabase Authentication settings, configure allowed site/redirect URLs for the GitHub Pages address. If email confirmation is enabled, new users must confirm their email before signing in.
6. Enable GitHub Pages: Settings → Pages → Deploy from a branch → `main` → `/(root)`.
7. Open `/online.html` on the published site and test with two separate accounts/devices.

## Online features in this initial implementation

- Email/password account creation and sign-in
- Profile records with a starting rating of 1200
- Invite-code games and selectable time controls
- Server-side legal move validation via chess.js
- Realtime game-state updates
- Basic ELO changes after a finished rated game
- Leaderboard and recent-game list

## Important beta limitations

This is an early online beta, not a tournament-ready chess server. Test clocks and reconnect behavior carefully before using it for rated competitive play. The initial ELO update routine is intentionally simple; anti-abuse controls, robust timeout adjudication, draw offers/claims, full rating transaction locking and tournament-grade server authority still need work. Do not use this as a high-stakes rating system yet.

The `config.js` file contains placeholders. The online UI is not live until the Supabase project is restored, the schema is applied and the Edge Function is deployed.
