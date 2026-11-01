import { DurableObject } from "cloudflare:workers";

const FALLBACK_ICE = [
  { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] },
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // WebSocket signaling: /ws?room=CODE&role=sender|viewer
    if (url.pathname === "/ws") {
      const room = url.searchParams.get("room") || "";
      if (!/^[A-Za-z0-9_-]{3,32}$/.test(room)) {
        return new Response("Bad room code", { status: 400 });
      }
      const stub = env.ROOM.get(env.ROOM.idFromName(room));
      return stub.fetch(request);
    }

    // ICE servers. STUN only by default; adds Cloudflare TURN if the
    // TURN_KEY_ID and TURN_API_TOKEN secrets are set (see README).
    if (url.pathname === "/ice") {
      let iceServers = FALLBACK_ICE;
      if (env.TURN_KEY_ID && env.TURN_API_TOKEN) {
        try {
          const r = await fetch(
            `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${env.TURN_API_TOKEN}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ ttl: 86400 }),
            }
          );
          if (r.ok) {
            const data = await r.json();
            if (Array.isArray(data.iceServers)) iceServers = data.iceServers;
          }
        } catch {}
      }
      return Response.json({ iceServers }, { headers: { "Cache-Control": "no-store" } });
    }

    return new Response("Not found", { status: 404 });
  },
};

// One Room per code. Relays signaling messages between the "sender" and
// "viewer" sockets. It never sees video. Uses WebSocket hibernation, so an
// idle room costs nothing.
export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const role = new URL(request.url).searchParams.get("role");
    if (role !== "sender" && role !== "viewer") {
      return new Response("Bad role", { status: 400 });
    }
    const other = role === "sender" ? "viewer" : "sender";

    // Only one socket per role: a newer one replaces the older one.
    for (const old of this.ctx.getWebSockets(role)) {
      try {
        old.send(JSON.stringify({ type: "replaced" }));
        old.close(4000, "replaced");
      } catch {}
    }

    const { 0: client, 1: server } = new WebSocketPair();
    const id = crypto.randomUUID();
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role, id });

    // Tell the newcomer who is already here, and tell the others about it.
    const present = this.#live(other).length > 0;
    server.send(JSON.stringify({ type: "peers", present: present ? [other] : [] }));
    for (const s of this.#live(other)) {
      s.send(JSON.stringify({ type: "peer-joined", role }));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    if (typeof message !== "string" || message.length > 65536) return;
    const meta = ws.deserializeAttachment();
    if (!meta) return;
    const other = meta.role === "sender" ? "viewer" : "sender";
    for (const s of this.#live(other)) {
      try {
        s.send(message);
      } catch {}
    }
  }

  webSocketClose(ws, code) {
    this.#gone(ws);
    try {
      ws.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000);
    } catch {}
  }

  webSocketError(ws) {
    this.#gone(ws);
  }

  #live(role, exceptId) {
    return this.ctx.getWebSockets(role).filter((s) => {
      if (s.readyState !== WebSocket.OPEN) return false;
      return !exceptId || s.deserializeAttachment()?.id !== exceptId;
    });
  }

  #gone(ws) {
    const meta = ws.deserializeAttachment();
    if (!meta) return;
    // If another socket already took this role (replacement), say nothing.
    if (this.#live(meta.role, meta.id).length > 0) return;
    const other = meta.role === "sender" ? "viewer" : "sender";
    for (const s of this.#live(other)) {
      try {
        s.send(JSON.stringify({ type: "peer-left", role: meta.role }));
      } catch {}
    }
  }
}
