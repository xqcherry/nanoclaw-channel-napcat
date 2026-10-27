# NanoClaw NapCat QQ 渠道

[English](README.md) | **简体中文**

[![npm CI](https://github.com/xqcherry/nanoclaw-channel-napcat/actions/workflows/npm-ci.yml/badge.svg)](https://github.com/xqcherry/nanoclaw-channel-napcat/actions/workflows/npm-ci.yml)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Public beta](https://img.shields.io/badge/status-public%20beta-orange)
[![GitHub stars](https://img.shields.io/github/stars/xqcherry/nanoclaw-channel-napcat?style=flat)](https://github.com/xqcherry/nanoclaw-channel-napcat/stargazers)
![npm downloads](https://img.shields.io/badge/npm%20downloads-not%20published-lightgrey)

独立源码安装包，面向 NanoClaw v2、Node.js 22+。原生 ChannelAdapter 在宿主进程监听单账号 OneBot 11 Universal 反向 WebSocket，支持私聊、群聊、文字、图片、精确 @、引用及文字选项回复。

**Public beta**：自动化测试和临时宿主集成已验证，真实 QQ 联调仍待完成。尚未发布 npm 包，请使用源码安装；npm downloads 标识如实显示未发布。

## 快速开始：自动安装 NapCat

准备已可用的 NanoClaw v2、Node.js 22+ 和 Linux Docker Compose。在本源码包根目录执行：

```bash
npm ci --ignore-scripts
npm run setup -- --target /absolute/path/to/nanoclaw --dry-run
npm run setup -- --target /absolute/path/to/nanoclaw
```

安装器自动安装渠道、冻结锁文件安装宿主依赖、构建，并部署上游 NapCat Docker 镜像。首次拉取后固定镜像 digest；账号、配置、插件保存在目标的 `data/napcat/`。WebUI 为 `http://127.0.0.1:6099/webui/`，登录 Token 在本地 `data/napcat/config/webui.json` 的 `token` 字段；不要把它提交或发到聊天里。

打开 WebUI，扫码登录机器人 QQ。随后再次执行，将号码和 agent 替换为实际值：

```bash
npm run setup -- --target /absolute/path/to/nanoclaw \
  --self-id 123456789 --user-qq 11223344 --agent my-agent \
  --service nanoclaw-example.service
```

`--self-id` 是机器人 QQ，`--user-qq` 是和机器人聊天的用户 QQ，`--agent` 是 `ncl groups list` 中的 folder 或 ID。只授予普通成员资格。`--service` 指定要重启的 systemd 用户服务；不指定则自行重启。无机器人号时渠道保持禁用，先完成登录；成功生成配置也不代表 QQ 已在线。重复执行复用密钥及登录数据。已有微信渠道和绑定保留。

本机自动部署使用 Linux host 网络，仅本机访问 WebUI；远程服务器通过 SSH 转发访问，例如 `ssh -L 6099:127.0.0.1:6099 user@server`。已有 NapCat 或非 Linux 系统可使用 `--external-napcat --self-id <机器人QQ>`，先在宿主 `.env` 填写现有服务使用的 `NAPCAT_ACCESS_TOKEN`；网络及 NapCat 配置按下文处理。

## 致谢

本项目基于 [NanoClaw](https://github.com/nanocoai/nanoclaw) 的原生渠道接口，使用 [NapCatQQ](https://github.com/NapNeko/NapCatQQ) 提供的 QQ 协议能力，并通过上游 [NapCat-Docker](https://github.com/NapNeko/NapCat-Docker) 镜像完成自动部署。感谢这些项目的维护者与贡献者。

NapCat 的安装及配置资料见 [官方文档](https://napneko.github.io/)，通信规范参考 [OneBot 11](https://github.com/botuniverse/onebot-11)。本项目为独立社区集成，并非上述项目的官方产品。

## 许可证

本项目代码采用 [MIT License](LICENSE)。NapCat、QQ 客户端及其他上游组件保留各自许可证和使用条款；本项目的 MIT 许可不重新授权这些组件。

## 仅安装渠道源码

本包默认只交付源码，不改动正在运行的 NanoClaw。准备 Node.js 22+、npm 和目标使用的包管理器，先在源码包根目录运行：

```bash
npm ci --ignore-scripts
npm test
npm run build
node scripts/channel.mjs install --target /absolute/path/to/nanoclaw --dry-run
node scripts/channel.mjs install --target /absolute/path/to/nanoclaw
```

再到目标目录执行：

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
pnpm exec vitest run src/channels/napcat.registration.test.ts
```

npm 管理的目标使用 `npm ci --ignore-scripts`。按宿主自己的规则构建需要的原生依赖。安装器先检查实际接口和冲突，将源码复制到 `src/channels/napcat*`，追加一条 `import './napcat.js';`，安装 `/add-napcat` 技能和示例，并固定 `ws@8.22.0`、`@types/ws@8.18.2`。依赖锁文件在临时目录生成成功后才写目标；`--dry-run` 不写文件或访问依赖注册表。重复安装不重复注册，修改过的渠道文件会报告冲突并停止。其他渠道的 import 和文件保持用户原有内容。

安装所有权和文件 SHA-256 记录在 `.claude/skills/add-napcat/install-state.json`。保留本源码包，以便重装和卸载。目标若已有不同版本的同名直接依赖，先由维护者统一版本；安装器会停止，避免改写共享依赖。兼容性检查严格比较已消费的适配器接口签名，接口变动需重新评估后更新开发契约快照。目标不支持依赖 `workspace:` 的多包工作区安装。

## 宿主配置

将 [config.example.env](config.example.env) 的六项配置填到目标 `.env`，将示例值换为实际值。也支持宿主进程环境变量，优先于 `.env`。

| 变量 | 含义与默认值 |
| --- | --- |
| `NAPCAT_ENABLED` | 只有 `true` 启用；默认禁用 |
| `NAPCAT_HOST` | 监听地址，默认 `127.0.0.1` |
| `NAPCAT_PORT` | 监听端口，默认 `3002` |
| `NAPCAT_PATH` | 精确 WebSocket 路径，默认 `/onebot/v11/ws` |
| `NAPCAT_ACCESS_TOKEN` | 必填，双方一致的随机 Token |
| `NAPCAT_SELF_ID` | 必填，NapCat 登录的机器人 QQ 号 |

Token 只供 NapCat 与宿主鉴权，不进入 agent 容器。安装器不填写真实配置。`.env` 已忽略，请在目标确认同样忽略。监听成功后宿主初始化即可完成；只有反向连接通过 Token、账号头和 `get_login_info` 校验才在线。

## NapCat 反向 WebSocket

在 [NapCat WebUI](https://napneko.github.io/config/basic) 添加 **WebSocket 客户端**（反向 WS）：

- URL：`ws://127.0.0.1:3002/onebot/v11/ws`，按下表替换主机地址。
- Token：与 `NAPCAT_ACCESS_TOKEN` 一致，NapCat 通过 `Authorization: Bearer …` 发送。
- 消息格式：`array`（结构化消息段）；启用事件上报、心跳和断线重连。该客户端必须提供 Universal API 与事件双工连接，`X-Client-Role: Universal`、`X-Self-ID: <机器人QQ号>`。
- 保存并启用客户端，登录配置的 QQ 账号。OneBot 请求及 `echo` 关联按 [OneBot 11 反向 WS](https://github.com/botuniverse/onebot-11/blob/master/communication/ws-reverse.md)；接口依据 [NapCat API](https://napneko.github.io/onebot/api)。

| 部署方式 | 宿主监听 | NapCat 客户端 URL 的主机 |
| --- | --- | --- |
| 两者在同一主机 | `127.0.0.1` | `127.0.0.1` |
| NapCat 在 Docker，NanoClaw 在宿主 | 可被容器到达的地址，如 `0.0.0.0` | `host.docker.internal`；Linux 配置 `extra_hosts: ["host.docker.internal:host-gateway"]` |
| 两者在同一 Docker 网络 | NanoClaw 容器内 `0.0.0.0` | NanoClaw 服务名，如 `nanoclaw` |
| 两者在不同机器 | 可到达的内网地址 | NanoClaw 内网 IP；经不可信网络使用受信任的 TLS 反向代理 `wss://` |

`127.0.0.1` 始终指当前容器或机器。不要将 NanoClaw agent 容器误当作适配器所在宿主。图片 URL 也必须能被 NanoClaw 宿主访问，不要求 NapCat 与宿主共享文件系统。

## QQ 身份与 agent 绑定

用户标识是 `qq:<用户QQ号>`，私聊地址是 `private:<用户QQ号>`，群聊地址是 `group:<群号>`；机器人号和用户号是不同用途。`openDM` 接受裸 QQ 号或 `qq:` 身份并返回私聊地址。

在已运行并可用的宿主，使用本机管理员 CLI 操作。先检查 `ncl users help`、`ncl messaging-groups help`、`ncl wirings help`；下面的用户、群号和 agent 参数都是示例，替换后再执行：

```bash
ncl groups list
ncl users create --id qq:11223344 --kind qq --display-name 'QQ 用户'
ncl members add --user qq:11223344 --group <agent-group-id>
ncl messaging-groups create --channel-type qq --platform-id private:11223344 --name 'QQ 私聊' --is-group 0 --unknown-sender-policy strict
ncl wirings create --channel-type qq --platform-id private:11223344 --agent-group <agent-folder> --sender-scope known
```

群聊使用另一条 messaging group 和 wiring：

```bash
ncl messaging-groups create --channel-type qq --platform-id group:55667788 --name 'QQ 群' --is-group 1 --unknown-sender-policy strict
ncl wirings create --channel-type qq --platform-id group:55667788 --agent-group <agent-folder> --sender-scope known
```

请把 `<agent-group-id>` 和 `<agent-folder>` 替换成 `ncl groups list` 返回值，不要带尖括号执行。成员资格满足普通交流需求；需要审批管理权限时，由用户明确决定授予 `ncl roles grant --user qq:11223344 --role admin --group <agent-group-id>`。身份字段直接取 NapCat 已认证事件中的发送者 QQ 号，消息正文无法替换身份。

默认私聊匹配所有通过权限检查的消息（使用宿主约定的 `.` 匹配全部，包括纯图片消息），群聊只有 QQ 真实 `at` 消息段精确命中机器人号才触发；`@全体`、正文中的 `@123` 或 CQ 字符串都不算。两个场景均禁用线程、未知发送者策略为 `strict`。群内每位需要使用 agent 的用户都要有对应身份和权限。

## 消息、图片与交互

文字始终发送为 `text` 消息段，`[CQ:...]` 当作普通文字。入站引用用 `get_msg` 补充原作者和文字；查不到时保留引用 ID。出站 `replyTo.id` 产生结构化 `reply` 段。

入站 HTTP(S) 图片下载超时 15 秒，单张上限 20 MiB，校验 PNG、JPEG、GIF 或 WebP 文件头，转 Base64 交给宿主保存到工作区。下载失败保留消息文字并追加 `[图片不可用]`。出站使用宿主 outbox 文件的图片字节，以 `base64://` 发送；首版不支持文件、语音、好友申请及群管理。

问题呈现完整标题、问题和从 1 开始的文字选项。用户发送 `/nc-answer <问题ID> <选项序号>`，适配器通过宿主实时问题解析器找到选项值，并携带实际发送者 `qq:<QQ号>`、实际会话地址传给 `onAction`。过期问题和越界选项不触发；是否有权回答由核心判断。命令不触发额外 agent 回复。需要专有自定义审批展示的 `requirePresentation` 卡片会投递失败；普通问题和标准文字选项可用。OneBot 没有消息文本编辑接口，宿主终态更新以新消息补充展示。

API 默认等待 15 秒；断线、重连替换和关闭会立即拒绝对应连接的待处理请求。适配器不重放发送，投递失败交回宿主处理。网络丢失回执时，远端可能已经收到消息，宿主重试可能重复发送。WebSocket 每 30 秒 ping，连续一次未收到上一轮 pong 会断开；NapCat 报告账号 offline 时也会断开。重复入站事件缓存上限 2048、保留 5 分钟，宿主重启后重新建立。

## 验证

```bash
npm ci --ignore-scripts
npm test
npm run build
npm run test:host -- --source /absolute/path/to/nanoclaw
```

最后一个命令只复制源码和构建配置到临时目录，不复制 `.env`、运行时数据或 Git，也不修改源宿主。它验证真实宿主构建、barrel 注册、删除 import 后测试确实失败、恢复后卸载和重建。`tests/host/channels/adapter.ts` 是开发用接口快照，不安装到目标；真实兼容性由目标接口检查及临时宿主构建确认。

### 真实 QQ 联调清单

本次没有实际 QQ 账号联调，以下均为**待人工验证**，模拟协议通过不代表 QQ 客户端已验证：

- [ ] 私聊发送文字，确认普通成员可访问已绑定 agent，陌生人无法访问。
- [ ] 私聊双向图片，确认 agent 工作区能读取图片，QQ 能显示出站图片。
- [ ] 群内真正 @ 机器人可触发；普通消息、文本伪造 @ 和 @全体不触发。
- [ ] 引用原消息可见上下文；过旧消息仍保留引用 ID。
- [ ] 普通问题文字选项可回答；无权用户不能批准审批。
- [ ] NapCat 断线重连后恢复收发；中断的请求失败并由宿主按策略处理。

## 排障与卸载

- 连接 401：检查双方 Token；403：检查机器人账号及 Universal 连接角色；404：核对精确路径。
- 监听在线但 QQ 离线：检查 `get_login_info` 返回账号、NapCat 登录状态、容器网络与防火墙。
- 群内无回复：使用 QQ 的真正 @，检查 wiring、`sender-scope known`、成员和宿主权限。
- 图片不可用：检查宿主访问图片 URL、大小、格式和 15 秒超时；文本仍会保留。
- 安装失败：按冲突路径审阅用户修改；备份后手工协调，不删除所有权记录绕过检查。异常终止遗留 `.napcat-install.lock` 时，确认没有安装进程运行后手动删除锁文件再重试。

```bash
node scripts/channel.mjs uninstall --target /absolute/path/to/nanoclaw --dry-run
node scripts/channel.mjs uninstall --target /absolute/path/to/nanoclaw
```

随后按 [REMOVE.md](skills/add-napcat/REMOVE.md) 删除六项环境配置、关闭 NapCat 对应客户端，按需通过 `ncl` 清理 qq 绑定，执行宿主冻结锁文件安装和构建。卸载会保留原有依赖和被其他源码使用的共享依赖。完整执行记录见 [docs/PROGRESS.md](docs/PROGRESS.md)。
