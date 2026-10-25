# NanoClaw NapCat QQ 渠道实施计划

## 交付目标

在 `/home/xqcherry/rep/nanoclaw-channel-napcat` 创建独立 Git 仓库，交付可安装的渠道源码包。首版连接一个 NapCat QQ 账号，支持反向 WebSocket、私聊和群聊、文字及图片收发、群内 @ 触发和引用消息。

采用 TypeScript、Node.js 22 和 `ws`，实现 NanoClaw 原生 `ChannelAdapter`。安装后适配器运行在 NanoClaw 宿主进程内。

## 连接与消息行为

- 渠道类型使用 `qq`，安装技能命名为 `/add-napcat`。用户 ID 为 `qq:<QQ号>`；会话地址为 `private:<QQ号>`、`group:<群号>`。通过 `openDM()` 将用户标识转换为私聊地址。
- 配置使用 `NAPCAT_ENABLED`、`NAPCAT_HOST`、`NAPCAT_PORT`、`NAPCAT_PATH`、`NAPCAT_ACCESS_TOKEN`、`NAPCAT_SELF_ID`。默认监听 `127.0.0.1:3002/onebot/v11/ws`；启用时要求提供 Token 和机器人 QQ 号。
- 接受 OneBot 11 Universal 反向连接，校验鉴权和账号。监听成功即可完成初始化；账号校验成功后才标记在线。相同账号重连替换旧连接，旧连接未完成的请求立即失败。
- API 使用唯一 `echo` 关联响应，默认超时 15 秒。断线时停止发送并交回宿主投递失败处理；不主动重放状态不明的发送请求。关闭适配器时清理连接、监听器和计时器。
- 入站消息转换为 NanoClaw 标准 `chat` 内容，包含发送者、文字、附件和引用上下文。忽略自身消息，使用有界缓存过滤重复事件。
- 私聊默认响应所有通过权限检查的消息；群聊默认仅在明确 @ 机器人时触发。两者均不启用线程，未知发送者默认采用 `strict` 策略。
- 入站引用通过 `get_msg` 补充原消息，查询失败时保留引用 ID。出站使用结构化消息段，文字始终按纯文本发送，避免将用户内容解释为 CQ 指令。
- 图片下载后转换为现有 Base64 附件格式，由 NanoClaw 保存到工作区；出站图片直接发送 Base64，兼容 NapCat 与 NanoClaw 不共享文件系统的部署。单图限制 20 MiB、下载超时 15 秒，失败时保留文字并标注图片不可用。
- 交互问题呈现为文字选项，以 `/nc-answer <问题ID> <选项序号>` 回传 `onAction`。实际身份和授权仍由 NanoClaw 核心校验。

协议依据：[NapCat 配置说明](https://napneko.github.io/config/basic)、[官方 API 文档](https://napneko.github.io/onebot/api)。

## 仓库与安装

- 分离反向连接管理、消息转换和渠道注册逻辑；提供协议模拟测试、中文 README、配置示例及 `/add-napcat` 的 `SKILL.md` 和 `REMOVE.md`。
- 提供 `install --target <NanoClaw路径>`、`uninstall --target <NanoClaw路径>` 和 `--dry-run`。安装前检查目标适配器接口及文件冲突。
- 安装仅复制渠道自有文件、追加一条注册 import，并添加锁定版本的依赖。重复执行保持幂等；遇到被用户修改的同名文件时停止并说明冲突。
- 卸载删除本渠道安装的文件和注册项；共享依赖仍有其他使用者时保留。配置由用户按示例填写，脚本不写入真实 Token。
- 文档覆盖 NapCat WebSocket 客户端配置、Docker 网络地址、QQ 身份及 agent 绑定步骤、排障与卸载。
- 默认只交付独立仓库；实际安装须显式指定目标路径。

## 验证与验收

- 模拟 NapCat 验证鉴权失败、账号不符、重连替换、心跳失联、API 乱序响应、超时及资源清理。
- 验证私聊与群聊映射、精准 @ 判断、自身消息过滤、重复事件、引用查询失败和纯文本 CQ 内容。
- 验证图片双向传输、下载失败、大小限制，以及文字选项回传真实用户身份。
- 在临时 NanoClaw 副本验证安装、重复安装、卸载、真实渠道 barrel 注册和宿主构建。
- 提供真实 QQ 联调清单：私聊文字与图片、群内 @、引用消息、NapCat 重连。没有实际账号联调时，交付说明明确记录未验证项。

## 默认范围

首版只支持单账号和反向 WebSocket；文件、语音、好友申请处理及群管理留待后续。当前 NanoClaw 仓库已有的微信渠道改动保留。本次不包含远程仓库创建、发布或运行中服务的配置切换。

## 后续开发参考

本计划基于本机 `/home/xqcherry/rep/nanoclaw-v2` 的 NanoClaw v2 接口整理。开发开始时应重新读取该项目的 `AGENTS.md`、`CONTRIBUTING.md` 和相关接口，确认版本兼容。

重点参考：

- `src/channels/adapter.ts`：`ChannelAdapter`、`ChannelSetup`、`InboundMessage`、`OutboundMessage`、`ChannelDefaults`。
- `src/channels/channel-registry.ts` 与 `src/channels/index.ts`：自注册及宿主生命周期。
- `src/session-manager.ts`：入站附件的 Base64 `data` 转工作区 `localPath`。
- `container/agent-runner/src/formatter.ts`：`senderId`、`sender`、`text`、`replyTo`、`attachments` 的消费格式。
- `src/channels/chat-sdk-bridge.ts` 与 `src/modules/approvals/`：问题选项呈现、回传和权限校验。
- `docs/skill-guidelines.md`：安装幂等、集成测试、依赖固定版本和完整卸载要求。

实施时在本独立仓库开发；通过临时 NanoClaw 副本完成集成验证。真实 Token 和本机配置不得提交到 Git。
