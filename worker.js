/**
 * Cloudflare Worker for the Multimedia Club site.
 * POST /api/tts proxies Fish Audio. Every other path is a static file.
 * The browser never sees TTS_API_KEY.
 */
const DEFAULT_API_URL = "https://api.fish.audio/v1/tts";
const DEFAULT_MODEL = "s2.1-pro-free";
const DEFAULT_REFERENCE_ID = "8d21b053e2804e2a890e1cf62f267b6f";
const MAX_TEXT_LENGTH = 1200;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function mapProviderStatus(status) {
  if (status === 401 || status === 403) return 401;
  if (status === 400 || status === 404 || status === 422) return 400;
  if (status === 429) return 429;
  if (status >= 500) return 502;
  return 502;
}

function safeProviderMessage(status) {
  if (status === 401 || status === 403) return "Voice authentication failed";
  if (status === 404) return "Voice or model ID was not found";
  if (status === 400 || status === 422) return "Voice request was invalid";
  if (status === 429) return "Voice service rate limit reached";
  return "Voice provider request failed";
}

async function handleTts(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }
  const apiKey = env.TTS_API_KEY;
  if (!apiKey) return json(503, { error: "Voice service is not configured" });

  let payload = {};
  try {
    payload = await request.json();
  } catch (err) {
    return json(400, { error: "Invalid JSON body" });
  }

  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text) return json(400, { error: "Missing text" });
  if (text.length > MAX_TEXT_LENGTH) return json(400, { error: "Text is too long" });

  const referenceId =
    (typeof payload.referenceId === "string" && payload.referenceId.trim()) ||
    (typeof payload.voiceId === "string" && payload.voiceId.trim()) ||
    env.TTS_REFERENCE_ID ||
    env.TTS_VOICE_ID ||
    DEFAULT_REFERENCE_ID;

  const endpoint = (env.TTS_API_URL || DEFAULT_API_URL).replace(/\/$/, "");
  const model = (env.TTS_MODEL && env.TTS_MODEL !== referenceId) ? env.TTS_MODEL : DEFAULT_MODEL;
  const requestBody = {
    text,
    format: "mp3",
    mp3_bitrate: 128,
    latency: "normal",
    chunk_length: 200,
    reference_id: referenceId,
  };

  try {
    const providerRes = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
        model,
      },
      body: JSON.stringify(requestBody),
    });
    if (!providerRes.ok) {
      const detail = await providerRes.text();
      console.warn("Verity TTS provider error:", providerRes.status, String(detail).slice(0, 200));
      return json(mapProviderStatus(providerRes.status), { error: safeProviderMessage(providerRes.status), detail: String(detail).slice(0, 180) });
    }
    return new Response(await providerRes.arrayBuffer(), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": providerRes.headers.get("content-type") || "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.warn("Verity TTS proxy error:", error && error.message);
    return json(502, { error: "Voice service unavailable" });
  }
}

async function handleChat(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });
  const apiKey = String(env.CHAT_API_KEY || env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return json(503, { error: "Chat not configured" });
  let payload;
  try { payload = await request.json(); } catch (e) { return json(400, { error: "Invalid JSON" }); }
  const endpoint = env.CHAT_API_URL || "https://api.openai.com/v1/chat/completions";
  const model = env.CHAT_MODEL || "gpt-4o-mini";
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ model, temperature: 0.8, messages: payload.messages || [] })
    });
    if (!res.ok) {
      const detail = await res.text();
      return json(502, { error: "Chat provider failed", status: res.status, detail: String(detail).slice(0, 240) });
    }
    const data = await res.json();
    const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return json(200, { reply: reply || "" });
  } catch (error) {
    return json(502, { error: "Chat service unavailable" });
  }
}


async function handleMemberChat(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (!env.DB) return json(503, { error: "D1 database is not bound" });
  if (request.method === "GET") {
    const rows = await env.DB.prepare("SELECT * FROM member_messages ORDER BY id DESC LIMIT 80").all();
    return json(200, { messages: (rows.results || []).reverse().map(function (row) { return { id: row.id, user: row.username, role: row.role, text: row.text, time: row.created_at }; }) });
  }
  const body = await request.json();
  if (body.action === "delete") await env.DB.prepare("DELETE FROM member_messages WHERE id = ?").bind(body.id).run();
  else if (body.action === "edit") await env.DB.prepare("UPDATE member_messages SET text = ? WHERE id = ?").bind(String(body.text || "").slice(0, 500), body.id).run();
  else if (body.text) await env.DB.prepare("INSERT INTO member_messages (username, role, text, created_at) VALUES (?, ?, ?, ?)").bind(body.user || "Member", body.role || "Member", String(body.text).slice(0, 500), new Date().toISOString()).run();
  return json(200, { ok: true });
}
async function handleSubscribe(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });
  if (!env.DB) return json(503, { error: "D1 database is not bound" });
  const sub = await request.json();
  if (!sub || !sub.endpoint) return json(400, { error: "Missing subscription" });
  const id = bytesToB64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sub.endpoint))));
  await env.DB.prepare("INSERT OR REPLACE INTO push_subs (id, endpoint, subscription) VALUES (?, ?, ?)").bind(id, sub.endpoint, JSON.stringify(sub)).run();
  return json(200, { ok: true });
}
async function handleNotify(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });
  try {
    const admin = await requireAdmin(request, env);
    if (admin.error) return json(401, { error: admin.error });
    const body = await request.json().catch(function () { return {}; });
    const title = String(body.title || "").trim().slice(0, 80);
    const message = String(body.body || body.message || "").trim().slice(0, 240);
    const url = String(body.url || body.link || "https://multimedia.lumiberstudio.workers.dev/").slice(0, 300);
    if (!title || !message) return json(400, { error: "Title and message are required" });
    if (env.DB) {
      try { await env.DB.prepare("INSERT INTO alerts (title, body, created_at, link, category) VALUES (?, ?, ?, ?, ?)").bind(title, message, new Date().toISOString(), url, body.segment || "Subscribed Users").run(); }
      catch (e) {}
    }
    const restKey = String(env.ONESIGNAL_REST_API_KEY || "").trim().replace(/^Key\s+/i, "");
    if (!restKey || !env.ONESIGNAL_APP_ID || env.ONESIGNAL_APP_ID.includes("YOUR_")) return json(503, { error: "OneSignal REST API key is missing in Cloudflare secrets." });
    if (/^[0-9a-f-]{36}$/i.test(restKey)) return json(503, { error: "That is the App ID. Add the REST API key that starts with os_v2_app_." });
    const res = await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Key " + restKey },
      body: JSON.stringify({ app_id: env.ONESIGNAL_APP_ID, target_channel: "push", included_segments: [body.segment || "Subscribed Users"], headings: { en: title }, contents: { en: message }, url: url })
    });
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) return json(res.status, { error: data.errors || "OneSignal request failed" });
    return json(200, { ok: true, id: data.id || "" });
  } catch (error) {
    return json(500, { error: error.message || "Notify failed" });
  }
}
async function handleLatestAlert(request, env) {
  if (!env.DB) return json(200, { title: "Multimedia Club", body: "New club update." });
  const row = await env.DB.prepare("SELECT title, body FROM alerts ORDER BY id DESC LIMIT 1").first();
  return json(200, row || { title: "Multimedia Club", body: "New club update." });
}
async function sendWebPush(subscription, env) {
  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      TTL: "60",
      Authorization: "vapid t=" + await vapidJwt(subscription.endpoint, env) + ", k=" + env.VAPID_PUBLIC_KEY
    }
  });
  if (!res.ok) throw new Error("Push failed " + res.status);
}
function b64urlToBytes(value) {
  const pad = "=".repeat((4 - value.length % 4) % 4);
  const b64 = (value + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  return Uint8Array.from(bin, function (c) { return c.charCodeAt(0); });
}
function bytesToB64url(bytes) {
  let s = "";
  bytes.forEach(b => s += String.fromCharCode(b));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function vapidJwt(endpoint, env) {
  const aud = new URL(endpoint).origin;
  const header = bytesToB64url(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bytesToB64url(new TextEncoder().encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: "mailto:club@multimedia.local" })));
  const data = new TextEncoder().encode(header + "." + claims);
  const key = await crypto.subtle.importKey("jwk", JSON.parse(env.VAPID_PRIVATE_JWK), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, data));
  return header + "." + claims + "." + bytesToB64url(sig);
}

async function signSession(payload, secret) {
  const body = bytesToB64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = bytesToB64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))));
  return body + "." + sig;
}
async function readSession(request, env) {
  if (!env.SESSION_SECRET) return { role: "Member", username: "local" };
  const token = (request.headers.get("Authorization") || "").replace("Bearer ", "");
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("HMAC", key, b64urlToBytes(parts[1]), new TextEncoder().encode(parts[0]));
  if (!ok) return null;
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
}
function canWrite(session) {
  return !session || ["Member", "Editor", "Photographer", "Developer", "Admin"].includes(session.role);
}
async function handleSession(request, env) {
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });
  const body = await request.json();
  if (!body.username || !body.role) return json(400, { error: "Missing account" });
  if (!env.SESSION_SECRET) return json(200, { token: "" });
  const token = await signSession({ username: String(body.username).slice(0, 80), role: String(body.role), exp: Date.now() + 1000 * 60 * 60 * 12 }, env.SESSION_SECRET);
  return json(200, { token });
}
async function handleLive(request, env) {
  if (!env.DB) return json(503, { error: "D1 database is not bound" });
  try {
    const events = await env.DB.prepare("SELECT * FROM events ORDER BY date ASC").all();
    const announcements = await env.DB.prepare("SELECT * FROM announcements ORDER BY posted_at DESC").all();
    return json(200, {
      events: (events.results || []).map(function (row) { return { id: Number(row.id) || row.id, name: row.name, date: row.date, description: row.description, image: row.image, location: row.location, posterColor: row.poster_color }; }),
      announcements: (announcements.results || []).map(function (row) { return { id: Number(row.id) || row.id, title: row.title, content: row.content, image: row.image, category: row.category, date: row.date, postedAt: row.posted_at, pinned: !!row.pinned, author: row.author }; })
    });
  } catch (error) {
    return json(500, { error: error.message || "Live data failed" });
  }
}
async function handleSaveEvent(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (!env.DB) return json(503, { error: "D1 database is not bound" });
  if (request.method === "DELETE") {
    const session = await readSession(request, env);
    if (!canWrite(session)) return json(401, { error: "Sign in required" });
    const id = new URL(request.url).searchParams.get("id");
    await env.DB.prepare("DELETE FROM events WHERE id = ?").bind(id).run();
    return json(200, { ok: true });
  }
  const session = await readSession(request, env);
  if (!canWrite(session)) return json(401, { error: "Sign in required" });
  const item = await request.json();
  if (!item.name || !item.date) return json(400, { error: "Missing event fields" });
  await env.DB.prepare("INSERT OR REPLACE INTO events (id, name, date, description, image, location, poster_color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM events WHERE id = ?), ?))").bind(String(item.id || Date.now()), String(item.name).slice(0, 160), item.date, String(item.description || "").slice(0, 2000), item.image || "", item.location || "Campus", item.posterColor || "#FFD700", String(item.id || Date.now()), new Date().toISOString()).run();
  return json(200, { ok: true });
}
async function handleSaveAnnouncement(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (!env.DB) return json(503, { error: "D1 database is not bound" });
  if (request.method === "DELETE") {
    const session = await readSession(request, env);
    if (!canWrite(session)) return json(401, { error: "Sign in required" });
    const id = new URL(request.url).searchParams.get("id");
    await env.DB.prepare("DELETE FROM announcements WHERE id = ?").bind(id).run();
    return json(200, { ok: true });
  }
  const session = await readSession(request, env);
  if (!canWrite(session)) return json(401, { error: "Sign in required" });
  const item = await request.json();
  if (!item.title) return json(400, { error: "Missing announcement title" });
  const now = item.postedAt || new Date().toISOString();
  await env.DB.prepare("INSERT OR REPLACE INTO announcements (id, title, content, image, category, date, posted_at, pinned, author, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(String(item.id || Date.now()), String(item.title).slice(0, 160), String(item.content || "").slice(0, 4000), item.image || "", item.category || "General", item.date || now, now, item.pinned ? 1 : 0, item.author || session.username || "", now).run();
  return json(200, { ok: true });
}
async function requireAdmin(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.replace("Bearer ", "").trim();
  if (!token) return { error: "No admin token. Log out and log in again." };
  if (!env.DB) return { error: "D1 database is not bound" };
  const row = await env.DB.prepare("SELECT id, username, role FROM users WHERE session_token = ?").bind(token).first();
  if (!row) return { error: "Saved token was not found. Log out and log in again." };
  if (!["Admin", "Developer"].includes(row.role)) return { error: "This account is " + row.role + ", not Admin or Developer." };
  return row;
}
async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}
function randomToken() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function publicId() {
  return crypto.randomUUID();
}
async function writeMembershipAudit(env, actor, action, memberId, detail) {
  await env.DB.prepare("INSERT INTO membership_audit_logs (actor, action, member_id, detail, created_at) VALUES (?, ?, ?, ?, ?)").bind(actor || "system", action, memberId || null, detail || "", new Date().toISOString()).run();
}
async function getPublicMember(env, publicIdValue) {
  const row = await env.DB.prepare("SELECT id, public_id, display_name, club_role, status, visibility FROM memberships WHERE public_id = ?").bind(publicIdValue).first();
  if (!row) return null;
  const projects = await env.DB.prepare("SELECT title, description, link, display_order FROM member_projects WHERE member_id = ? AND publication_status = 'published' ORDER BY display_order ASC, id ASC").bind(row.id).all();
  return {
    member: { publicId: row.public_id, displayName: row.display_name, role: row.club_role, status: String(row.status || "").toUpperCase() },
    projects: row.visibility === "hidden" || row.status !== "active" ? [] : (projects.results || []).map(function (p) { return { title: p.title, description: p.description || "", link: p.link || "" }; }),
    verifiedAt: new Date().toISOString()
  };
}
function memberNumber() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "MC-" + [...bytes].map(function (b) { return alphabet[b % alphabet.length]; }).join("");
}
async function handleMembers(request, env, url) {
  if (!env.DB) return json(503, { error: "D1 database is not bound" });
  try {
    if (url.pathname === "/api/members/profile") {
      const number = (url.searchParams.get("m") || "").trim();
      if (!number) return json(200, { result: "INVALID" });
      const row = await env.DB.prepare("SELECT member_number, display_name, club_role, status FROM memberships WHERE member_number = ?").bind(number).first();
      if (!row) return json(200, { result: "INVALID" });
      return json(200, { result: row.status === "active" ? "VALID" : row.status.toUpperCase(), member_number: row.member_number, display_name: row.display_name, club_role: row.club_role, status: row.status });
    }
    if (url.pathname === "/api/members/verify") {
      const token = (url.searchParams.get("t") || "").trim();
      if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return json(200, { result: "INVALID" });
      const row = await env.DB.prepare("SELECT member_number, display_name, club_role, status FROM memberships WHERE token_hash = ?").bind(await sha256(token)).first();
      if (!row) return json(200, { result: "INVALID" });
      const result = row.status === "active" ? "VALID" : row.status.toUpperCase();
      return json(200, { result: result, member_number: row.member_number, display_name: row.display_name, club_role: row.club_role, status: row.status, checked_at: new Date().toISOString() });
    }
    if (url.pathname === "/api/members/mine") {
      const header = request.headers.get("Authorization") || "";
      const session = header.replace("Bearer ", "").trim();
      const user = session ? await env.DB.prepare("SELECT username, role FROM users WHERE session_token = ?").bind(session).first() : null;
      if (!user) return json(401, { error: "Log in again to get your QR." });
      let row = await env.DB.prepare("SELECT member_number, display_name, club_role, status, public_id FROM memberships WHERE display_name = ?").bind(user.username).first();
      let token = "";
      if (!row) {
        token = randomToken();
        const number = memberNumber();
        const pid = publicId();
        await env.DB.prepare("INSERT INTO memberships (member_number, display_name, club_role, status, token_hash, created_at, public_id, visibility, updated_at, activated_at) VALUES (?, ?, ?, 'active', ?, ?, ?, 'public', ?, ?)").bind(number, user.username, user.role || "Member", await sha256(token), new Date().toISOString(), pid, new Date().toISOString(), new Date().toISOString()).run();
        row = { member_number: number, display_name: user.username, club_role: user.role || "Member", status: "active", public_id: pid };
      } else if (!row.public_id) {
        const pid = publicId();
        await env.DB.prepare("UPDATE memberships SET public_id = ?, visibility = COALESCE(visibility, 'public'), updated_at = ? WHERE member_number = ?").bind(pid, new Date().toISOString(), row.member_number).run();
        row.public_id = pid;
      }
      return json(200, { member: row, profile_url: row.public_id ? locationOrigin(request) + "/member.html?id=" + encodeURIComponent(row.public_id) : "" });
    }
    const admin = await requireAdmin(request, env);
    if (admin.error) return json(401, { error: admin.error });
    if (request.method === "GET") {
      const rows = await env.DB.prepare("SELECT id, member_number, display_name, club_role, status, created_at, public_id, visibility FROM memberships ORDER BY id DESC").all();
      const members = [];
      for (const row of rows.results || []) {
        if (!row.public_id) {
          const pid = publicId();
          await env.DB.prepare("UPDATE memberships SET public_id = ?, visibility = COALESCE(visibility, 'public'), updated_at = ? WHERE id = ?").bind(pid, new Date().toISOString(), row.id).run();
          row.public_id = pid;
        }
        row.profile_url = locationOrigin(request) + "/member.html?id=" + encodeURIComponent(row.public_id);
        members.push(row);
      }
      const stats = {
        total: members.length,
        active: members.filter(function (m) { return m.status === "active"; }).length,
        inactive: members.filter(function (m) { return m.status !== "active" && m.status !== "revoked"; }).length,
        revoked: members.filter(function (m) { return m.status === "revoked"; }).length
      };
      const audit = await env.DB.prepare("SELECT actor, action, member_id, detail, created_at FROM membership_audit_logs ORDER BY id DESC LIMIT 12").all().catch(function () { return { results: [] }; });
      return json(200, { members: members, stats: stats, audit: audit.results || [] });
    }
    const body = await request.json().catch(function () { return {}; });
    if (url.pathname === "/api/members/register") {
      const name = String(body.display_name || "").trim().slice(0, 80);
      const role = ["Member", "Developer", "Moderator", "Admin"].includes(body.club_role) ? body.club_role : "Member";
      if (name.length < 2) return json(400, { error: "Name is required" });
      const number = memberNumber();
      const token = randomToken();
      const pid = publicId();
      await env.DB.prepare("INSERT INTO memberships (member_number, display_name, club_role, status, token_hash, created_at, public_id, visibility, updated_at, activated_at) VALUES (?, ?, ?, 'active', ?, ?, ?, 'public', ?, ?)").bind(number, name, role, await sha256(token), new Date().toISOString(), pid, new Date().toISOString(), new Date().toISOString()).run();
      await writeMembershipAudit(env, admin.username, "create_member", null, name);
      return json(200, { member_number: number, display_name: name, club_role: role, public_id: pid, profile_url: locationOrigin(request) + "/member.html?id=" + encodeURIComponent(pid) });
    }
    if (url.pathname === "/api/members/update") {
      const name = String(body.display_name || "").trim().slice(0, 80);
      const role = ["Member", "Developer", "Moderator", "Admin"].includes(body.club_role) ? body.club_role : "";
      if (!body.member_number || name.length < 2 || !role) return json(400, { error: "Name, role, and member number are required" });
      await env.DB.prepare("UPDATE memberships SET display_name = ?, club_role = ?, updated_at = ? WHERE member_number = ?").bind(name, role, new Date().toISOString(), body.member_number).run();
      await writeMembershipAudit(env, admin.username, "update_member", null, body.member_number + " -> " + role);
      return json(200, { ok: true });
    }
    if (url.pathname === "/api/members/visibility") {
      if (!["public", "hidden"].includes(body.visibility)) return json(400, { error: "Invalid visibility" });
      await env.DB.prepare("UPDATE memberships SET visibility = ?, updated_at = ? WHERE member_number = ?").bind(body.visibility, new Date().toISOString(), body.member_number).run();
      await writeMembershipAudit(env, admin.username, "visibility", null, body.member_number + " " + body.visibility);
      return json(200, { ok: true });
    }
    if (url.pathname === "/api/members/projects") {
      const title = String(body.title || "").trim().slice(0, 120);
      if (!body.member_number || title.length < 2) return json(400, { error: "Project title is required" });
      const member = await env.DB.prepare("SELECT id FROM memberships WHERE member_number = ?").bind(body.member_number).first();
      if (!member) return json(404, { error: "Member not found" });
      const now = new Date().toISOString();
      await env.DB.prepare("INSERT INTO member_projects (member_id, title, description, link, publication_status, display_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)").bind(member.id, title, String(body.description || "").slice(0, 500), String(body.link || "").slice(0, 300), body.publication_status === "published" ? "published" : "draft", now, now).run();
      await writeMembershipAudit(env, admin.username, "project", member.id, title);
      return json(200, { ok: true });
    }
    if (url.pathname === "/api/members/status") {
      if (!["active", "suspended", "revoked"].includes(body.status)) return json(400, { error: "Invalid status" });
      await env.DB.prepare("UPDATE memberships SET status = ?, updated_at = ?, revoked_at = ? WHERE member_number = ?").bind(body.status, new Date().toISOString(), body.status === "revoked" ? new Date().toISOString() : null, body.member_number).run();
      await writeMembershipAudit(env, admin.username, "status", null, body.member_number + " " + body.status);
      return json(200, { ok: true });
    }
    if (url.pathname === "/api/members/rotate-token") {
      const token = randomToken();
      await env.DB.prepare("UPDATE memberships SET token_hash = ? WHERE member_number = ?").bind(await sha256(token), body.member_number).run();
      return json(200, { token: token, verify_url: "https://multimedia.lumiberstudio.workers.dev/verify.html?t=" + token });
    }
    return json(404, { error: "Unknown membership route" });
  } catch (error) {
    return json(500, { error: error.message || "Membership request failed" });
  }
}
async function handleAccounts(request, env) {
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });
  if (!env.DB) return json(503, { error: "D1 database is not bound" });
  const body = await request.json();
  if (body.action === "list") {
    const admin = await requireAdmin(request, env);
    if (admin.error) return json(401, { error: admin.error });
    const rows = await env.DB.prepare("SELECT id, username, email, role, created_at FROM users ORDER BY created_at DESC").all();
    return json(200, { users: rows.results || [] });
  }
  if (body.action === "avatar") {
    await env.DB.prepare("UPDATE users SET password_hash = password_hash WHERE id = ?").bind(body.id).run();
    return json(200, { ok: true });
  }
  if (body.action === "session") {
    const username = String(body.username || "").trim();
    const email = String(body.email || username).trim();
    if (!username || !body.passwordHash) return json(400, { error: "Missing account" });
    const existing = await env.DB.prepare("SELECT id, role FROM users WHERE username = ? OR email = ?").bind(username, email).first();
    const token = crypto.randomUUID();
    if (existing) {
      await env.DB.prepare("UPDATE users SET password_hash = ?, session_token = ? WHERE id = ?").bind(body.passwordHash, token, existing.id).run();
      return json(200, { ok: true, token, user: { username: username, email: email, role: existing.role } });
    }
    await env.DB.prepare("INSERT INTO users (id, username, email, password_hash, role, session_token, created_at) VALUES (?, ?, ?, ?, 'Member', ?, ?)").bind(String(body.id || Date.now()), username, email, body.passwordHash, token, new Date().toISOString()).run();
    return json(200, { ok: true, token, user: { username: username, email: email, role: "Member" } });
  }
  if (body.action === "register") {
    const id = String(body.id || Date.now());
    await env.DB.prepare("INSERT INTO users (id, username, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'Member', ?)").bind(id, body.username, body.email, body.passwordHash, new Date().toISOString()).run();
    return json(200, { ok: true, id, role: "Member" });
  }
  const row = await env.DB.prepare("SELECT * FROM users WHERE username = ? OR email = ?").bind(body.username, body.username).first();
  if (!row || row.password_hash !== body.passwordHash) return json(401, { error: "Invalid username/email or password" });
  const token = crypto.randomUUID();
  await env.DB.prepare("UPDATE users SET session_token = ? WHERE id = ?").bind(token, row.id).run();
  return json(200, { ok: true, token, user: { id: row.id, username: row.username, email: row.email, role: row.role } });
}
async function handleRequests(request, env) {
  if (!env.DB) return json(503, { error: "D1 database is not bound" });
  if (request.method === "GET") {
    const userId = new URL(request.url).searchParams.get("userId");
    const rows = await env.DB.prepare("SELECT * FROM club_requests WHERE user_id = ? ORDER BY created_at DESC").bind(userId).all();
    return json(200, { requests: rows.results || [] });
  }
  const body = await request.json();
  if (body.action === "status") {
    await env.DB.prepare("UPDATE club_requests SET status = ? WHERE id = ?").bind(body.status, body.id).run();
    return json(200, { ok: true });
  }
  await env.DB.prepare("INSERT OR REPLACE INTO club_requests (id, user_id, username, title, category, priority, description, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(body.id, body.userId, body.username, body.title, body.category, body.priority, body.description, body.status || "Pending", body.createdAt || new Date().toISOString()).run();
  return json(200, { ok: true });
}
async function handlePresence(request, env) {
  if (!env.DB) return json(503, { error: "D1 database is not bound" });
  try {
    if (request.method === "POST") {
      const body = await request.json().catch(function () { return {}; });
      const id = String(body.id || "").slice(0, 80);
      if (!id) return json(400, { error: "Missing visitor id" });
      await env.DB.prepare("INSERT OR REPLACE INTO site_presence (id, label, last_seen) VALUES (?, ?, ?)").bind(id, String(body.label || "Visitor").slice(0, 80), new Date().toISOString()).run();
    }
    const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const rows = await env.DB.prepare("SELECT label, last_seen FROM site_presence WHERE last_seen >= ? ORDER BY last_seen DESC").bind(cutoff).all();
    return json(200, { active: (rows.results || []).length, visitors: rows.results || [] });
  } catch (error) {
    return json(200, { active: 0, visitors: [], error: error.message || "Presence unavailable" });
  }
}
async function handleBootstrapAdmin(request, env) {
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });
  if (!env.DB) return json(503, { error: "D1 database is not bound" });
  if (!env.FIRST_ADMIN_SECRET) return json(503, { error: "FIRST_ADMIN_SECRET is not set" });
  const body = await request.json().catch(function () { return {}; });
  if (body.secret !== env.FIRST_ADMIN_SECRET) return json(401, { error: "Invalid setup secret" });
  const existing = await env.DB.prepare("SELECT id FROM users WHERE role = 'Admin' LIMIT 1").first();
  if (existing) return json(409, { error: "An admin already exists" });
  const username = String(body.username || "").trim().slice(0, 80);
  const email = String(body.email || "").trim().slice(0, 120);
  if (username.length < 2 || !email.includes("@") || !body.passwordHash) return json(400, { error: "Username, email, and password hash are required" });
  const id = "admin-" + Date.now();
  await env.DB.prepare("INSERT INTO users (id, username, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'Admin', ?)").bind(id, username, email, body.passwordHash, new Date().toISOString()).run();
  await writeMembershipAudit(env, username, "bootstrap_admin", null, "First admin created");
  return json(200, { ok: true, username: username, role: "Admin" });
}
async function handleJoin(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (!env.DB) return json(503, { error: "D1 database is not bound" });
  try {
    if (request.method === "GET") {
      const rows = await env.DB.prepare("SELECT display_name, membership_id, pin_requested, created_at FROM join_requests ORDER BY id DESC LIMIT 8").all();
      return json(200, { requests: rows.results || [] });
    }
    if (request.method !== "POST") return json(405, { error: "Method not allowed" });
    const body = await request.json().catch(function () { return {}; });
    const name = String(body.display_name || "").trim().slice(0, 80);
    const email = String(body.email || "").trim().slice(0, 120);
    if (name.length < 2 || !email.includes("@")) return json(400, { error: "Name and email are required" });
    const membershipId = "MMC-" + new Date().getFullYear() + "-" + String(Date.now()).slice(-4);
    await env.DB.prepare("INSERT INTO join_requests (display_name, email, membership_id, pin_requested, created_at) VALUES (?, ?, ?, ?, ?)").bind(name, email, membershipId, body.pin_requested ? 1 : 0, new Date().toISOString()).run();
    return json(200, { ok: true, display_name: name, membership_id: membershipId });
  } catch (error) {
    return json(500, { error: error.message || "Join save failed" });
  }
}
function locationOrigin(request) {
  return new URL(request.url).origin;
}
async function handlePublicMember(request, env, url) {
  if (request.method !== "GET") return json(405, { error: "Method not allowed" });
  if (!env.DB) return json(503, { error: "Verification unavailable" });
  const publicIdValue = decodeURIComponent(url.pathname.split("/").pop() || "").trim();
  if (!/^[A-Za-z0-9-]{8,80}$/.test(publicIdValue)) return json(404, { error: "Member profile not found" });
  try {
    const profile = await getPublicMember(env, publicIdValue);
    if (!profile || profile.member.visibility === "hidden") return json(404, { error: "Member profile not found" });
    return new Response(JSON.stringify(profile), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" }
    });
  } catch (error) {
    return json(503, { error: "Verification unavailable" });
  }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/tts") return handleTts(request, env);
    if (url.pathname === "/api/chat") return handleChat(request, env);
    if (url.pathname === "/api/session") return handleSession(request, env);
    if (url.pathname === "/api/live") return handleLive(request, env);
    if (url.pathname === "/api/events") return handleSaveEvent(request, env);
    if (url.pathname === "/api/announcements") return handleSaveAnnouncement(request, env);
    if (url.pathname === "/api/onesignal") return json(200, { appId: env.ONESIGNAL_APP_ID || "" });
    if (url.pathname === "/api/notify") return handleNotify(request, env);
    if (url.pathname === "/api/member-chat") return handleMemberChat(request, env);
    if (url.pathname === "/api/latest-alert") return handleLatestAlert(request, env);
    if (url.pathname === "/api/push-key") return json(200, { publicKey: env.VAPID_PUBLIC_KEY || "" });
    if (url.pathname.startsWith("/api/public/members/")) return handlePublicMember(request, env, url);
    if (url.pathname === "/api/bootstrap-admin") return handleBootstrapAdmin(request, env);
    if (url.pathname === "/api/join") return handleJoin(request, env);
    if (url.pathname === "/api/accounts") return handleAccounts(request, env);
    if (url.pathname === "/api/requests") return handleRequests(request, env);
    if (url.pathname === "/api/presence") return handlePresence(request, env);
    if (url.pathname.startsWith("/api/members")) return handleMembers(request, env, url);
    if (url.pathname.startsWith("/api/")) return json(request.method === "GET" ? 200 : 404, { error: "Unknown API route" });
    if (url.pathname.startsWith("/member/") && env.ASSETS) {
      return env.ASSETS.fetch(new Request(new URL("/member.html", request.url), request));
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return json(404, { error: "Not found" });
  },
};
