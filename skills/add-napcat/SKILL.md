---
name: add-napcat
description: 安装、配置和验证 NanoClaw v2 的 NapCat QQ 渠道；支持反向 WebSocket、私聊、群聊、文字和图片。
---

# 添加 NapCat QQ 渠道

1. 确认用户指定的 NanoClaw 目标目录，读取目标的 AGENTS.md 和 CONTRIBUTING.md。保留所有现有渠道。
2. 找到本独立源码包的根目录，设置 `NAPCAT_SOURCE` 为其绝对路径、`NANOCLAW_TARGET` 为目标绝对路径。运行 `npm ci --ignore-scripts` 安装源码包工具依赖。
3. 在源码包根目录执行 `node scripts/channel.mjs install --target "$NANOCLAW_TARGET" --dry-run`。解决报告的接口不兼容或同名文件冲突后，运行相同命令去掉 `--dry-run` 完成安装。安装记录保存于目标 `.claude/skills/add-napcat/install-state.json`；保留源码包以便更新和卸载。
4. 在目标根目录执行 `pnpm install --frozen-lockfile --ignore-scripts` 和 `pnpm run build`，执行 `pnpm exec vitest run src/channels/napcat.registration.test.ts` 验证真实 barrel 注册。npm 管理的目标使用 `npm ci --ignore-scripts`。按目标自身规则处理所需原生依赖构建。
5. 阅读源码包 README.md 的配置和绑定步骤，在目标 `.env` 手动填写 config.example.env 中六个变量。Token 由用户在本机输入，避免写入聊天、日志或 Git。机器人 QQ 号必须与 NapCat 登录账号一致。
6. 在 NapCat WebUI 添加 WebSocket 客户端，设置相同 URL 和 Token、消息格式为 array、启用心跳和重连；按 README.md 选择本机或 Docker 地址。
7. 用 `ncl` 创建 `qq:<用户QQ号>` 身份、授予用户明确授权的角色或 agent 成员资格，创建私聊/群聊 messaging group 并绑定 agent。使用目标 `ncl help` 和各资源 `help` 核对参数，遵循 README.md 的示例。
8. 用户选择重启宿主服务后，完成 README.md 的真实 QQ 联调清单；没有真实账号时明确记录未验证。

## 交互问题

问题以文字选项显示，回复 `/nc-answer <问题ID> <选项序号>`（从 1 开始）。适配器查询当前问题选项并传真实 QQ 身份，授权由 NanoClaw 核心处理。需要专有自定义审批展示的卡片会明确投递失败。

## 排障

- 离线：核对监听地址、端口、反向客户端 URL、防火墙、Bearer Token、机器人 QQ 号以及 Universal 连接。
- 群聊不触发：使用 QQ 客户端真正 @ 机器人，确认 wiring 和成员权限。
- 图片不可用：检查宿主能否访问 NapCat 上报的 HTTP(S) 图片 URL、20 MiB 大小及 PNG/JPEG/GIF/WebP 格式。
- 安装冲突：先审阅并备份用户修改，勿强制覆盖；根据 install-state.json 的哈希定位文件。
- 卸载：遵循同目录 REMOVE.md。
