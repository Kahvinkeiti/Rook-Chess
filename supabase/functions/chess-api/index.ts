import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { Chess } from "https://esm.sh/chess.js@1.4.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "POST required" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return reply({ error: "Supabase environment is not configured." }, 500);

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return reply({ error: "Sign in required." }, 401);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  try {
    const body = await req.json();
    const action = String(body.action || "");

    if (action === "create") {
      const time = Number(body.time_control ?? 600);
      if (![0, 60, 180, 300, 600, 900, 1800].includes(time)) return reply({ error: "Invalid time control." }, 400);
      const { data: profile } = await admin.from("profiles").select("id").eq("id", user.id).maybeSingle();
      if (!profile) return reply({ error: "Profile not found. Sign out and back in." }, 400);
      let code = "";
      for (let i = 0; i < 5; i++) {
        code = crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
        const { data: existing } = await admin.from("games").select("id").eq("invite_code", code).maybeSingle();
        if (!existing) break;
      }
      const fen = new Chess().fen();
      const { data, error } = await admin.from("games").insert({
        invite_code: code, white_id: user.id, status: "waiting", time_control: time,
        initial_seconds: time, white_seconds: time, black_seconds: time, fen, pgn: "",
      }).select("id,invite_code,status,time_control,fen,white_id,black_id").single();
      if (error) throw error;
      return reply({ game: data });
    }

    if (action === "join") {
      const code = String(body.invite_code || "").trim().toUpperCase();
      if (!/^[A-F0-9]{6}$/.test(code)) return reply({ error: "Enter a valid 6-character invite code." }, 400);
      const { data: game, error } = await admin.from("games").select("*").eq("invite_code", code).eq("status", "waiting").maybeSingle();
      if (error || !game) return reply({ error: "Waiting game not found." }, 404);
      if (game.white_id === user.id) return reply({ error: "Share the invite code with another player." }, 400);
      const { data: joined, error: joinError } = await admin.from("games").update({
        black_id: user.id, status: "active", turn_user_id: game.white_id,
        last_move_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", game.id).eq("status", "waiting").is("black_id", null)
        .select("id,invite_code,status,time_control,fen,pgn,white_id,black_id,turn_user_id,white_seconds,black_seconds,last_move_at,result").maybeSingle();
      if (joinError || !joined) return reply({ error: "This invite was just used. Ask for another code." }, 409);
      return reply({ game: joined });
    }

    const gameId = String(body.game_id || "");
    const { data: game, error: gameError } = await admin.from("games").select("*").eq("id", gameId).maybeSingle();
    if (gameError || !game) return reply({ error: "Game not found." }, 404);
    if (game.white_id !== user.id && game.black_id !== user.id) return reply({ error: "You are not a player in this game." }, 403);
    if (game.status !== "active") return reply({ error: "Game is not active." }, 409);

    if (action === "move") {
      if (game.turn_user_id !== user.id) return reply({ error: "It is not your turn." }, 409);
      if (body.expected_fen !== game.fen) return reply({ error: "Position changed. The game has been refreshed; try again." }, 409);
      const now = Date.now();
      const elapsed = game.last_move_at ? Math.max(0, Math.floor((now - new Date(game.last_move_at).getTime()) / 1000)) : 0;
      const isWhite = game.white_id === user.id;
      const ownClock = isWhite ? game.white_seconds : game.black_seconds;
      const nextClock = game.time_control === 0 ? ownClock : Math.max(0, ownClock - elapsed);
      if (game.time_control !== 0 && nextClock <= 0) {
        const result = isWhite ? "black" : "white";
        await finishGame(admin, game, result);
        return reply({ error: "Time expired.", finished: true }, 409);
      }
      const chess = new Chess(game.fen);
      const move = chess.move({ from: String(body.from || ""), to: String(body.to || ""), promotion: String(body.promotion || "q") });
      if (!move) return reply({ error: "Illegal move." }, 400);
      const nextWhite = isWhite ? nextClock : game.white_seconds;
      const nextBlack = isWhite ? game.black_seconds : nextClock;
      const ended = chess.isGameOver();
      const result = ended ? (chess.isCheckmate() ? (isWhite ? "white" : "black") : "draw") : null;
      const patch = {
        fen: chess.fen(), pgn: chess.pgn(), white_seconds: nextWhite, black_seconds: nextBlack,
        turn_user_id: isWhite ? game.black_id : game.white_id, last_move_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
        ...(ended ? { status: "finished", result, finished_at: new Date(now).toISOString(), turn_user_id: null } : {}),
      };
      const { data: updated, error: updateError } = await admin.from("games").update(patch)
        .eq("id", game.id).eq("fen", game.fen).eq("status", "active").select("*").maybeSingle();
      if (updateError || !updated) return reply({ error: "Another update arrived first. Refresh the game." }, 409);
      if (ended && result) await updateRatings(admin, updated, result);
      return reply({ game: updated });
    }

    if (action === "resign") {
      const result = game.white_id === user.id ? "black" : "white";
      const updated = await finishGame(admin, game, result);
      return reply({ game: updated });
    }

    return reply({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error(error);
    return reply({ error: error instanceof Error ? error.message : "Unexpected server error." }, 500);
  }
});

async function finishGame(admin: ReturnType<typeof createClient>, game: Record<string, any>, result: string) {
  const { data, error } = await admin.from("games").update({
    status: "finished", result, finished_at: new Date().toISOString(), updated_at: new Date().toISOString(), turn_user_id: null,
  }).eq("id", game.id).eq("status", "active").select("*").maybeSingle();
  if (error) throw error;
  if (data) await updateRatings(admin, data, result);
  return data;
}

async function updateRatings(admin: ReturnType<typeof createClient>, game: Record<string, any>, result: string) {
  if (!game.rated || !game.white_id || !game.black_id) return;
  const { data: profiles, error } = await admin.from("profiles").select("id,elo,games_played,wins,losses,draws").in("id", [game.white_id, game.black_id]);
  if (error || !profiles || profiles.length !== 2) return;
  const white = profiles.find((p: any) => p.id === game.white_id);
  const black = profiles.find((p: any) => p.id === game.black_id);
  if (!white || !black) return;
  const expectedWhite = 1 / (1 + Math.pow(10, (black.elo - white.elo) / 400));
  const scoreWhite = result === "white" ? 1 : result === "black" ? 0 : 0.5;
  const delta = Math.round(32 * (scoreWhite - expectedWhite));
  await admin.from("profiles").update({ elo: Math.max(100, white.elo + delta), games_played: white.games_played + 1, wins: white.wins + (result === "white" ? 1 : 0), losses: white.losses + (result === "black" ? 1 : 0), draws: white.draws + (result === "draw" ? 1 : 0) }).eq("id", white.id);
  await admin.from("profiles").update({ elo: Math.max(100, black.elo - delta), games_played: black.games_played + 1, wins: black.wins + (result === "black" ? 1 : 0), losses: black.losses + (result === "white" ? 1 : 0), draws: black.draws + (result === "draw" ? 1 : 0) }).eq("id", black.id);
}
