import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { ReverseConnection } from "../src/channels/napcat/connection.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function connect(
  server: ReverseConnection,
  extra: Record<string, string> = {},
  respond = true,
) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/onebot/v11/ws`, {
    headers: {
      Authorization: "Bearer secret",
      "X-Self-ID": "123",
      "X-Client-Role": "Universal",
      ...extra,
    },
  });
  if (respond)
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.action === "get_login_info")
        ws.send(
          JSON.stringify({
            status: "ok",
            retcode: 0,
            echo: msg.echo,
            data: { user_id: 123 },
          }),
        );
    });
  await once(ws, "open");
  await delay(20);
  return ws;
}
function make(extra = {}) {
  return new ReverseConnection({
    host: "127.0.0.1",
    port: 0,
    path: "/onebot/v11/ws",
    token: "secret",
    selfId: "123",
    requestTimeoutMs: 70,
    heartbeatMs: 1000,
    ...extra,
  });
}

test("listen completes offline; authenticated verified account becomes online", async (t) => {
  const s = make();
  t.after(() => s.close());
  await s.listen();
  assert.equal(s.connected, false);
  const ws = await connect(s);
  assert.equal(s.connected, true);
  ws.close();
  await delay(20);
  assert.equal(s.connected, false);
});
test("rejects wrong token, wrong account and non-universal sockets", async (t) => {
  const s = make();
  t.after(() => s.close());
  await s.listen();
  for (const headers of [
    { Authorization: "Bearer wrong" },
    { "X-Self-ID": "456" },
    { "X-Client-Role": "Event" },
  ]) {
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/onebot/v11/ws`, {
      headers: {
        Authorization: "Bearer secret",
        "X-Self-ID": "123",
        "X-Client-Role": "Universal",
        ...headers,
      },
    });
    const [err] = await once(ws, "error");
    assert.match(String(err), /401|403/);
  }
  assert.equal(s.connected, false);
});
test("login response must match account; unverified connection times out", async (t) => {
  const s = make();
  t.after(() => s.close());
  await s.listen();
  const ws = await connect(s, {}, false);
  await delay(90);
  assert.equal(s.connected, false);
  assert.equal(ws.readyState, WebSocket.CLOSED);
});
test("correlates unordered API results and rejects failure, timeout and replaced requests", async (t) => {
  const s = make();
  t.after(() => s.close());
  await s.listen();
  const ws = await connect(s);
  const calls: any[] = [];
  ws.on("message", (raw) => calls.push(JSON.parse(raw.toString())));
  const a = s.call("one", {}),
    b = s.call("two", {});
  await delay(10);
  for (const c of [...calls].reverse())
    ws.send(
      JSON.stringify({
        status: "ok",
        retcode: 0,
        echo: c.echo,
        data: c.action,
      }),
    );
  assert.deepEqual(await Promise.all([a, b]), ["one", "two"]);
  const failed = s.call("bad", {});
  await delay(10);
  const c = calls.at(-1);
  ws.send(JSON.stringify({ status: "failed", retcode: 100, echo: c.echo }));
  await assert.rejects(failed, /failed/);
  await assert.rejects(s.call("timeout", {}), /timed out/);
  const pending = assert.rejects(s.call("pending", {}), /replaced/);
  await connect(s);
  await pending;
  assert.equal(ws.readyState, WebSocket.CLOSED);
});
test("heartbeat loss terminates connection and teardown rejects requests", async (t) => {
  const s = make({ heartbeatMs: 25 });
  t.after(() => s.close());
  await s.listen();
  const ws = await connect(s);
  (ws as any)._autoPong = false;
  await delay(100);
  assert.equal(s.connected, false);
  await assert.rejects(s.call("x", {}), /offline/);
  await connect(s);
  const pending = assert.rejects(s.call("x", {}), /closed/);
  await s.close();
  await pending;
  assert.equal(s.connected, false);
});

test("API account mismatch and explicit offline heartbeat never leave an online adapter", async (t) => {
  const s = make();
  t.after(() => s.close());
  await s.listen();
  const ws = await connect(s, {}, false);
  // The initial request was sent before connect returned; a fresh client supplies a mismatching response.
  ws.terminate();
  const wrong = new WebSocket(`ws://127.0.0.1:${s.port}/onebot/v11/ws`, {
    headers: {
      Authorization: "Bearer secret",
      "X-Self-ID": "123",
      "X-Client-Role": "Universal",
    },
  });
  wrong.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    wrong.send(
      JSON.stringify({
        echo: m.echo,
        status: "ok",
        retcode: 0,
        data: { user_id: 999 },
      }),
    );
  });
  await once(wrong, "close");
  assert.equal(s.connected, false);
  const good = await connect(s);
  const closed = once(good, "close");
  good.send(
    JSON.stringify({
      self_id: 123,
      post_type: "meta_event",
      meta_event_type: "heartbeat",
      status: { online: false },
    }),
  );
  await closed;
  assert.equal(s.connected, false);
});
test("a delayed older handshake cannot replace the most recent verified connection", async (t) => {
  const s = make({ requestTimeoutMs: 300 });
  t.after(() => s.close());
  await s.listen();
  let firstRequest: any;
  const first = new WebSocket(`ws://127.0.0.1:${s.port}/onebot/v11/ws`, {
    headers: {
      Authorization: "Bearer secret",
      "X-Self-ID": "123",
      "X-Client-Role": "Universal",
    },
  });
  first.on("message", (raw) => {
    firstRequest = JSON.parse(raw.toString());
  });
  await once(first, "open");
  await delay(10);
  const latest = await connect(s);
  first.send(
    JSON.stringify({
      echo: firstRequest.echo,
      status: "ok",
      retcode: 0,
      data: { user_id: 123 },
    }),
  );
  await delay(20);
  assert.equal(latest.readyState, WebSocket.OPEN);
  assert.equal(first.readyState, WebSocket.CLOSED);
});
