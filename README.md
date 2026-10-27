# NanoClaw NapCat QQ Channel

**English** | [简体中文](README.zh-CN.md)

[![npm CI](https://github.com/xqcherry/nanoclaw-channel-napcat/actions/workflows/npm-ci.yml/badge.svg)](https://github.com/xqcherry/nanoclaw-channel-napcat/actions/workflows/npm-ci.yml)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Public beta](https://img.shields.io/badge/status-public%20beta-orange)
[![GitHub stars](https://img.shields.io/github/stars/xqcherry/nanoclaw-channel-napcat?style=flat)](https://github.com/xqcherry/nanoclaw-channel-napcat/stargazers)
![npm downloads](https://img.shields.io/badge/npm%20downloads-not%20published-lightgrey)

Connect QQ to NanoClaw v2 through [NapCatQQ](https://github.com/NapNeko/NapCatQQ). Includes a native channel adapter and automated NapCat deployment with Docker.

> **Public beta.** Protocol tests and temporary NanoClaw integration have passed. Real QQ account messaging is still awaiting manual validation. This project is distributed as source; no npm package has been published. The downloads badge reflects that status.

## Features

- Private chats and group chats with exact QQ mentions.
- Incoming and outgoing text, images, and quoted replies.
- Text options for interactive questions, with authorization handled by NanoClaw.
- Authenticated OneBot 11 Universal reverse WebSocket, heartbeat detection, and reconnect handling.
- Docker setup with persistent QQ login data, generated tokens, and a local WebUI.
- Repeatable channel installation and removal while preserving existing channels, including WeChat.

## Requirements

- A working NanoClaw v2 installation. Integration was checked against `2026.10.1-rc.2`; the installer checks the consumed adapter interface before changing files.
- Node.js 22+, npm, and the host repository's package manager.
- Linux with Docker Engine and Docker Compose for automatic NapCat deployment.
- A QQ account to log in as the bot, and an agent group to bind your chat to.

Other platforms can use an existing NapCat deployment with the external mode below. This package runs inside the NanoClaw host process; it is not a standalone bot server.

## Quick start

Clone this repository, then run from its root:

```bash
git clone https://github.com/xqcherry/nanoclaw-channel-napcat.git
cd nanoclaw-channel-napcat
npm ci --ignore-scripts
npm run setup -- --target /absolute/path/to/nanoclaw --dry-run
npm run setup -- --target /absolute/path/to/nanoclaw
```

Setup installs the adapter, installs host dependencies using the frozen lockfile, builds the host, and starts NapCat through Docker Compose. It pins the pulled image by digest and saves login data, configuration, and plugins under the host's `data/napcat/` directory. Keep the source repository for future updates and removal.

Open **http://127.0.0.1:6099/webui/**. The WebUI login token is the `token` field in the local `data/napcat/config/webui.json` file. Tokens are generated locally and are not printed by setup. Scan the QR code with the QQ account that should act as the bot.

After login, finish the configuration:

```bash
npm run setup -- --target /absolute/path/to/nanoclaw \
  --self-id 123456789 --user-qq 11223344 --agent my-agent \
  --service nanoclaw-example.service
```

Replace the example values:

| Option | Meaning |
| --- | --- |
| `--target` | Absolute path to the NanoClaw host |
| `--self-id` | QQ number of the account logged into NapCat |
| `--user-qq` | Your QQ number, used to chat with the bot |
| `--agent` | Agent folder or ID returned by `ncl groups list` |
| `--service` | Exact systemd user service to restart; omit to restart manually |
| `--external-napcat` | Reuse an existing NapCat service instead of deploying Docker |
| `--dry-run` | Print the intended steps without changing files or accessing the network |

The user binding grants ordinary member access, creates a private chat, and adds a wiring with `sender-scope known`. It does not grant owner or admin roles. Before a bot QQ number is supplied, setup leaves the QQ channel disabled so you can complete login first. A successful setup is not proof that the QQ account is online.

Automatic deployment currently uses Linux host networking. The WebUI and adapter listen on loopback. To log in on a remote server, forward the WebUI port with `ssh -L 6099:127.0.0.1:6099 user@server`, then open the local URL. Repeat setup reuses tokens and login data and refuses conflicting managed files.

## Use an existing NapCat

Put your existing OneBot token in the NanoClaw `.env`, then run:

```bash
npm run setup -- --target /absolute/path/to/nanoclaw \
  --external-napcat --self-id 123456789
```

Configure a **WebSocket client / reverse WebSocket** in [NapCat WebUI](https://napneko.github.io/config/basic):

- URL: `ws://127.0.0.1:3002/onebot/v11/ws`, adjusted for your deployment network.
- Token: the host's `NAPCAT_ACCESS_TOKEN`, sent as a Bearer token.
- Message format: `array`; enable event reporting, heartbeat, and reconnection.
- The connection must provide Universal API and events with `X-Client-Role: Universal` and `X-Self-ID: <bot QQ>`.

| Deployment | Host listen address | NapCat connects to |
| --- | --- | --- |
| Same machine or automatic Linux deployment | `127.0.0.1` | `127.0.0.1` |
| NapCat in bridge Docker, NanoClaw on host | An address reachable from Docker, e.g. `0.0.0.0` | `host.docker.internal`; Linux needs `host-gateway` mapping |
| Same Docker network | `0.0.0.0` inside NanoClaw container | NanoClaw service name |
| Separate machines | Reachable private address | NanoClaw private IP; use trusted TLS and `wss://` across untrusted networks |

Loopback always refers to the current machine or container. The adapter runs in the host process, not an agent container. Incoming image URLs must be reachable by that host.

## Host configuration

The six variables in [config.example.env](config.example.env) belong in the NanoClaw host `.env`. Host process environment variables take precedence. Keep `.env` and runtime data out of Git.

| Variable | Default / purpose |
| --- | --- |
| `NAPCAT_ENABLED` | Disabled unless exactly `true` |
| `NAPCAT_HOST` | `127.0.0.1` |
| `NAPCAT_PORT` | `3002` |
| `NAPCAT_PATH` | `/onebot/v11/ws`, matched exactly |
| `NAPCAT_ACCESS_TOKEN` | Required shared OneBot token |
| `NAPCAT_SELF_ID` | Required bot QQ number |

Tokens are only used between NapCat and the host; they are not passed into agent containers. The adapter becomes online only after token, account headers, and `get_login_info` have been verified.

## Manual bindings and group chats

Platform user IDs are `qq:<QQ>`. Addresses are `private:<QQ>` and `group:<group number>`. Use the local administrator CLI on the running host; check each resource's `help` output before applying examples:

```bash
ncl groups list
ncl users create --id qq:11223344 --kind qq --display-name 'QQ user'
ncl members add --user qq:11223344 --group <agent-group-id>
ncl messaging-groups create --channel-type qq --platform-id private:11223344 --name 'QQ DM' --is-group 0 --unknown-sender-policy strict
ncl wirings create --channel-type qq --platform-id private:11223344 --agent-group <agent-folder> --sender-scope known
```

For a group, create a separate messaging group and wiring:

```bash
ncl messaging-groups create --channel-type qq --platform-id group:55667788 --name 'QQ group' --is-group 1 --unknown-sender-policy strict
ncl wirings create --channel-type qq --platform-id group:55667788 --agent-group <agent-folder> --sender-scope known
```

Replace bracketed placeholders before running these commands. Every participating QQ user needs their own identity and access. DMs respond to authorized messages; group chats trigger only on a real QQ `at` segment targeting the bot. Plain text mentions, CQ strings, and `@all` do not trigger. Existing WeChat bindings remain available.

## Messages and limitations

Text is sent as structured plain text; `[CQ:...]` is never interpreted as a command. Incoming quotes use `get_msg` to retrieve context, keeping the quote ID if retrieval fails. Outgoing replies use a structured `reply` segment.

Images support PNG, JPEG, GIF, and WebP, with file signature checks, a 20 MiB per-image limit, and a 15-second download timeout. Incoming images become Base64 attachments for the host workspace; outgoing images use `base64://`. Failed downloads preserve the text and append an image-unavailable marker.

Answer an interactive text question with `/nc-answer <question ID> <option number>`, numbered from 1. Actual sender identity and chat address are passed to the core for authorization. Expired questions and invalid options are ignored.

Current scope: one account, reverse WebSocket, no threads. Files, voice, friend requests, and group management are not supported. Cards requiring proprietary `requirePresentation` rendering fail explicitly. OneBot has no text-edit API, so terminal question updates arrive as new messages.

API requests time out after 15 seconds. Disconnects reject pending calls, and the adapter does not replay uncertain sends. A host retry may duplicate a message if the original delivery succeeded but its acknowledgement was lost. Deduplication holds up to 2,048 incoming events for five minutes and resets on host restart.

## Development and validation

```bash
npm ci --ignore-scripts
npm test
npm run build
npm run test:host -- --source /absolute/path/to/nanoclaw
```

The host verification command builds a temporary source copy, checks real barrel registration, proves a missing registration import is detected, and validates removal and rebuild. It does not copy `.env`, runtime data, or Git, or modify the source host.

Real QQ validation is still pending:

- [ ] Authorized private text messages and rejection of unknown users.
- [ ] Incoming and outgoing private images.
- [ ] Real group mentions trigger; forged text and `@all` do not.
- [ ] Quote context and missing-message fallback.
- [ ] Text option replies and unauthorized approval rejection.
- [ ] Recovery after NapCat disconnect and reconnect.

To contribute, open an issue or pull request describing the behavior, change, and validation. Never include real QQ login data, tokens, `.env`, or agent workspaces.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Connection rejected with 401 | Both sides use the same token |
| Connection rejected with 403 | Bot account and Universal role headers |
| Connection rejected with 404 | Exact WebSocket path |
| Listening but offline | NapCat login, `get_login_info`, network, and firewall |
| Group gets no reply | Real mention, wiring, known sender, and group membership |
| Image unavailable | Host URL access, image signature, size, and download timeout |
| Setup conflict | Review the named file; do not remove ownership records to bypass checks |

Inspect the managed deployment with `docker compose -f /path/to/nanoclaw/data/napcat/compose.yaml ps` or `logs`. Logs can contain login material; inspect them locally.

## Removal

For a channel-only installation, use these low-level commands:

```bash
node scripts/channel.mjs install --target /absolute/path/to/nanoclaw --dry-run
node scripts/channel.mjs install --target /absolute/path/to/nanoclaw
node scripts/channel.mjs uninstall --target /absolute/path/to/nanoclaw --dry-run
node scripts/channel.mjs uninstall --target /absolute/path/to/nanoclaw
```

After a low-level install or uninstall, run the host's frozen dependency installation and build. The installer checks ownership hashes and interface compatibility, appends one registration import, and pins `ws@8.22.0` and `@types/ws@8.18.2`. Workspaces using `workspace:` dependencies are not supported.

Stop a managed NapCat with `docker compose -f /path/to/nanoclaw/data/napcat/compose.yaml down`. Login data is retained. Follow [REMOVE.md](skills/add-napcat/REMOVE.md) to remove host variables and optional QQ bindings. Channel removal never deletes NapCat account data. Delete `data/napcat/` only if you explicitly intend to erase saved QQ login and configuration.

## Acknowledgements

- [NanoClaw](https://github.com/nanocoai/nanoclaw) provides the host and native channel adapter interface.
- [NapCatQQ](https://github.com/NapNeko/NapCatQQ) provides the QQ protocol implementation. See the [official documentation](https://napneko.github.io/) for installation and configuration.
- [NapCat-Docker](https://github.com/NapNeko/NapCat-Docker) supplies the upstream Docker image used by automatic deployment.
- [OneBot 11](https://github.com/botuniverse/onebot-11) defines the messaging protocol.

Thanks to their maintainers and contributors. This is an independent community integration and is not an official product of those projects.

## License

[MIT](LICENSE) for this repository's code. NapCat, the QQ client, and other upstream components retain their own licenses and terms; this repository does not relicense them.
