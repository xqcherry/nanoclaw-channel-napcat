import { test } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { once } from "node:events";
import {
  NapCatAdapter,
  NAPCAT_DEFAULTS,
  readConfig,
} from "../src/channels/napcat/adapter.js";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("config requires explicit enable, token and QQ account; validates endpoint", () => {
  assert.equal(readConfig({}), null);
  assert.throws(() => readConfig({ NAPCAT_ENABLED: "true" }), /TOKEN/);
  assert.throws(
    () => readConfig({ NAPCAT_ENABLED: "true", NAPCAT_ACCESS_TOKEN: "secret" }),
    /SELF_ID/,
  );
  const c = readConfig({
    NAPCAT_ENABLED: "true",
    NAPCAT_ACCESS_TOKEN: "secret",
    NAPCAT_SELF_ID: "123",
  });
  assert.deepEqual(c, {
    host: "127.0.0.1",
    port: 3002,
    path: "/onebot/v11/ws",
    token: "secret",
    selfId: "123",
  });
  assert.throws(
    () =>
      readConfig({
        NAPCAT_ENABLED: "true",
        NAPCAT_ACCESS_TOKEN: "secret",
        NAPCAT_SELF_ID: "123",
        NAPCAT_PORT: "no",
      }),
    /PORT/,
  );
  assert.equal(NAPCAT_DEFAULTS.dm.engagePattern, ".");
  assert.equal(NAPCAT_DEFAULTS.group.engageMode, "mention");
  assert.equal(NAPCAT_DEFAULTS.dm.unknownSenderPolicy, "strict");
});
test("adapter integrates socket, dedup, metadata, delivery, commands and shutdown", async (t) => {
  const inbound: any[] = [],
    actions: any[] = [],
    metadata: any[] = [];
  const a = new NapCatAdapter(
    { host: "127.0.0.1", port: 0, path: "/ws", token: "secret", selfId: "123" },
    async (id) =>
      id === "q"
        ? {
            title: "Pick",
            question: "Which?",
            options: [
              { label: "Yes", value: "approve" },
              { label: "No", value: "deny" },
            ],
          }
        : undefined,
  );
  t.after(() => a.teardown());
  await a.setup({
    onInbound: (...args) => {
      inbound.push(args);
    },
    onInboundEvent: () => {},
    onMetadata: (...args) => {
      metadata.push(args);
    },
    onAction: (...args) => {
      actions.push(args);
    },
  });
  assert.equal(a.isConnected(), false);
  assert.equal(await a.openDM("qq:456"), "private:456");
  assert.equal(await a.openDM("456"), "private:456");
  await assert.rejects(a.openDM("group:4"));
  const ws = new WebSocket(`ws://127.0.0.1:${a.connection.port}/ws`, {
    headers: {
      Authorization: "Bearer secret",
      "X-Self-ID": "123",
      "X-Client-Role": "Universal",
    },
  });
  const sent: any[] = [];
  ws.on("message", (raw) => {
    const c = JSON.parse(raw.toString());
    sent.push(c);
    ws.send(
      JSON.stringify({
        echo: c.echo,
        status: "ok",
        retcode: 0,
        data:
          c.action === "get_login_info" ? { user_id: 123 } : { message_id: 77 },
      }),
    );
  });
  await once(ws, "open");
  await delay(20);
  const emit = (id: number, text: string, user = 456) =>
    ws.send(
      JSON.stringify({
        post_type: "message",
        self_id: 123,
        message_type: "group",
        group_id: 789,
        message_id: id,
        user_id: user,
        sender: { nickname: "Alice" },
        time: 1700000000,
        message: [{ type: "text", data: { text } }],
      }),
    );
  emit(1, "hello");
  emit(1, "hello");
  emit(2, "self", 123);
  await delay(30);
  assert.equal(inbound.length, 1);
  assert.equal(metadata[0][0], "group:789");
  assert.equal(inbound[0][2].kind, "chat");
  const id = await a.deliver("group:789", null, {
    kind: "chat",
    content: {
      type: "ask_question",
      questionId: "q",
      title: "Pick",
      question: "Which?",
      options: [
        { label: "Yes", value: "approve" },
        { label: "No", value: "deny" },
      ],
    },
  });
  assert.equal(id, "77");
  assert.match(sent.at(-1).params.message[0].data.text, /\/nc-answer q 1/);
  emit(3, "/nc-answer q 2");
  emit(4, "/nc-answer q 99");
  emit(5, "/nc-answer expired 1");
  await delay(30);
  assert.equal(actions.length, 1);
  assert.deepEqual(actions[0], [
    "q",
    "deny",
    "qq:456",
    { instance: "qq", platformId: "group:789", threadId: null },
  ]);
  await a.deliver("private:456", null, {
    kind: "chat",
    content: { text: "[CQ:at,qq=all]" },
  });
  assert.equal(sent.at(-1).action, "send_private_msg");
  assert.equal(sent.at(-1).params.user_id, 456);
  assert.deepEqual(sent.at(-1).params.message, [
    { type: "text", data: { text: "[CQ:at,qq=all]" } },
  ]);
  await assert.rejects(
    a.deliver("bad", null, { kind: "chat", content: { text: "x" } }),
    /address/,
  );
  const closed = once(ws, "close");
  await a.teardown();
  await closed;
  assert.equal(a.isConnected(), false);
  assert.equal(ws.readyState, WebSocket.CLOSED);
});

test("images and quoted messages cross the actual reverse socket and native host callbacks", async (t) => {
  const { createServer } = await import("node:http");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  const http = createServer((_req, res) => res.end(png));
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  t.after(() => {
    http.closeAllConnections();
    http.close();
  });
  const adapter = new NapCatAdapter(
    { host: "127.0.0.1", port: 0, path: "/ws", token: "secret", selfId: "123" },
    async () => undefined,
  );
  t.after(() => adapter.teardown());
  let inboundResolve: (v: any) => void = () => {};
  const incoming = new Promise<any>((resolve) => {
    inboundResolve = resolve;
  });
  await adapter.setup({
    onInbound: (_id, _thread, msg) => {
      inboundResolve(msg);
    },
    onMetadata: () => {},
    onAction: () => {},
    onInboundEvent: () => {},
  });
  const ws = new WebSocket(`ws://127.0.0.1:${adapter.connection.port}/ws`, {
    headers: {
      Authorization: "Bearer secret",
      "X-Self-ID": "123",
      "X-Client-Role": "Universal",
    },
  });
  const calls: any[] = [];
  ws.on("message", (raw) => {
    const request = JSON.parse(raw.toString());
    calls.push(request);
    ws.send(
      JSON.stringify({
        echo: request.echo,
        status: "ok",
        retcode: 0,
        data:
          request.action === "get_login_info"
            ? { user_id: 123 }
            : request.action === "get_msg"
              ? {
                  sender: { nickname: "Bob" },
                  message: [{ type: "text", data: { text: "original" } }],
                }
              : { message_id: 99 },
      }),
    );
  });
  await once(ws, "open");
  await delay(20);
  ws.send(
    JSON.stringify({
      post_type: "message",
      self_id: 123,
      message_type: "private",
      message_id: 10,
      user_id: 456,
      time: 1700000000,
      message: [
        {
          type: "image",
          data: {
            url: `http://127.0.0.1:${(http.address() as any).port}/image`,
          },
        },
        { type: "reply", data: { id: 9 } },
      ],
    }),
  );
  const received = await incoming;
  assert.equal(received.content.attachments[0].data, png.toString("base64"));
  assert.equal(received.content.replyTo.text, "original");
  assert.equal(calls.find((c) => c.action === "get_msg").params.message_id, 9);
  await adapter.deliver("private:456", null, {
    kind: "chat",
    content: { text: "reply", replyTo: { id: "10" } },
    files: [{ filename: "tiny.png", data: png }],
  });
  assert.deepEqual(calls.at(-1).params.message, [
    { type: "reply", data: { id: "10" } },
    { type: "text", data: { text: "reply" } },
    { type: "image", data: { file: "base64://" + png.toString("base64") } },
  ]);
});
