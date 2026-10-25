import { createServer, type Server } from "node:http";
import { timingSafeEqual, randomUUID } from "node:crypto";
import WebSocket, { WebSocketServer } from "ws";

export interface ConnectionConfig {
  host: string;
  port: number;
  path: string;
  token: string;
  selfId: string;
  requestTimeoutMs?: number;
  heartbeatMs?: number;
}
type Pending = {
  socket: WebSocket;
  timer: ReturnType<typeof setTimeout>;
  resolve: (data: any) => void;
  reject: (error: Error) => void;
};

/** One Universal reverse socket. Pending requests belong to a socket, never a reconnect. */
export class ReverseConnection {
  private server?: Server;
  private wss?: WebSocketServer;
  private active?: WebSocket;
  private pending = new Map<string, Pending>();
  private heartbeat?: ReturnType<typeof setInterval>;
  private closing = false;
  private candidateVersion = 0;
  onEvent: (event: Record<string, any>) => void = () => {};
  onError: (error: Error) => void = () => {};
  constructor(readonly config: ConnectionConfig) {}
  get port(): number {
    return (
      (this.server?.address() as { port: number } | null)?.port ??
      this.config.port
    );
  }
  get connected(): boolean {
    return this.active?.readyState === WebSocket.OPEN;
  }

  async listen(): Promise<void> {
    if (this.server) throw new Error("NapCat listener already started");
    this.closing = false;
    const wss = (this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: 2 * 1024 * 1024,
    }));
    const server = (this.server = createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    }));
    server.on("upgrade", (req, socket, head) => {
      const token = Buffer.from(req.headers.authorization ?? "");
      const expected = Buffer.from(`Bearer ${this.config.token}`);
      const authenticated =
        token.length === expected.length && timingSafeEqual(token, expected);
      const status = !authenticated
        ? 401
        : req.headers["x-self-id"] !== this.config.selfId ||
            req.headers["x-client-role"]?.toString().toLowerCase() !==
              "universal"
          ? 403
          : req.url !== this.config.path
            ? 404
            : 0;
      if (status || this.closing) {
        socket.end(
          `HTTP/1.1 ${status || 503} Rejected\r\nConnection: close\r\n\r\n`,
        );
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.config.port, this.config.host, () => {
        server.off("error", reject);
        resolve();
      });
    }).catch(async (error) => {
      await this.close();
      throw error;
    });
    server.on("error", (error) => this.onError(error));
    this.heartbeat = setInterval(() => {
      for (const ws of wss.clients) {
        if (!this.alive.get(ws)) {
          this.drop(ws, "NapCat heartbeat lost");
          ws.terminate();
          continue;
        }
        this.alive.set(ws, false);
        ws.ping();
      }
    }, this.config.heartbeatMs ?? 30_000);
    this.heartbeat.unref();
  }
  private alive = new WeakMap<WebSocket, boolean>();
  private accept(ws: WebSocket): void {
    const version = ++this.candidateVersion;
    this.alive.set(ws, true);
    ws.on("pong", () => this.alive.set(ws, true));
    ws.on("error", () => {
      this.drop(ws, "NapCat socket error");
      ws.terminate();
    });
    ws.on("close", () => this.drop(ws, "NapCat disconnected"));
    ws.on("message", (raw, binary) => {
      if (binary || this.closing) return;
      let event: Record<string, any>;
      try {
        event = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!event || typeof event !== "object" || Array.isArray(event)) return;
      if (typeof event.echo === "string") {
        const p = this.pending.get(event.echo);
        if (!p || p.socket !== ws) return;
        this.pending.delete(event.echo);
        clearTimeout(p.timer);
        if (event.status === "ok" && event.retcode === 0) p.resolve(event.data);
        else
          p.reject(
            new Error(`NapCat API failed (retcode ${Number(event.retcode)})`),
          );
        return;
      }
      if (ws !== this.active || String(event.self_id) !== this.config.selfId)
        return;
      if (
        event.meta_event_type === "heartbeat" &&
        event.status?.online === false
      ) {
        this.drop(ws, "NapCat account offline");
        ws.terminate();
        return;
      }
      this.onEvent(event);
    });
    // Verify the API side as well as the mandatory OneBot account header.
    void this.request(ws, "get_login_info", {})
      .then((data) => {
        if (this.closing || ws.readyState !== WebSocket.OPEN) return;
        if (version !== this.candidateVersion) {
          ws.terminate();
          return;
        }
        if (String(data?.user_id) !== this.config.selfId) {
          ws.terminate();
          return;
        }
        if (this.active && this.active !== ws) {
          const old = this.active;
          this.drop(old, "NapCat connection replaced");
          old.terminate();
        }
        this.active = ws;
      })
      .catch(() => ws.terminate());
  }
  private drop(ws: WebSocket, reason: string): void {
    if (this.active === ws) this.active = undefined;
    for (const [echo, p] of this.pending)
      if (p.socket === ws) {
        clearTimeout(p.timer);
        this.pending.delete(echo);
        p.reject(new Error(reason));
      }
  }
  call(action: string, params: Record<string, unknown>): Promise<any> {
    if (!this.active || !this.connected)
      return Promise.reject(new Error("NapCat offline"));
    return this.request(this.active, action, params);
  }
  private request(
    socket: WebSocket,
    action: string,
    params: Record<string, unknown>,
  ): Promise<any> {
    const echo = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(echo);
        reject(new Error(`NapCat ${action} timed out`));
      }, this.config.requestTimeoutMs ?? 15_000);
      this.pending.set(echo, { socket, timer, resolve, reject });
      socket.send(JSON.stringify({ action, params, echo }), (error) => {
        if (!error) return;
        const p = this.pending.get(echo);
        if (!p) return;
        clearTimeout(timer);
        this.pending.delete(echo);
        reject(new Error("NapCat send failed"));
      });
    });
  }
  async close(): Promise<void> {
    this.closing = true;
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    const wss = this.wss,
      server = this.server;
    this.wss = undefined;
    this.server = undefined;
    if (wss)
      for (const ws of wss.clients) {
        this.drop(ws, "NapCat closed");
        ws.terminate();
      }
    this.active = undefined;
    await Promise.all([
      wss && new Promise<void>((resolve) => wss.close(() => resolve())),
      server &&
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ]);
  }
}
