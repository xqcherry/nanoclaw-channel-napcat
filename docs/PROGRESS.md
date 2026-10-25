# 执行记录 — PLAN.md

2026-10-25：从只有 PLAN.md 的独立空仓库开始。已读取本机 NanoClaw v2 接口、CONTRIBUTING.md、渠道规范。

执行顺序：连接管理 → 消息转换与图片 → 原生适配器与注册 → 安装卸载 → 中文文档与集成验收。

决策：此仓库为新建专用开发目录，使用 feat/napcat-channel 分支原地开发；原 NanoClaw 仓库只读，临时副本集成。没有独立设计规范，PLAN.md 是验收依据。

接口核对：原生 onInbound 使用结构化 content、isMention/isGroup；入站图片用 Base64 data；onAction 传真实用户身份和来源地址；问题选项通过宿主 resolveQuestionRender 查询。

已完成：

- 连接管理：Token/Universal/账号校验，初始化与在线分离，唯一 echo，15 秒 API 超时，连接替换时拒绝旧请求，ping/pong 与账号 offline 检测，关闭时清理资源。
- 消息：私聊/群聊映射，精确 @，自身消息过滤，2048 条/5 分钟去重，引用查询及失败 ID 保留，CQ 纯文本，20 MiB 图片下载/上传，15 秒下载超时及关闭取消。
- 原生适配器：严格权限默认、无线程、openDM、实时选项解析、真实 QQ 身份回传核心。
- 安装：显式 target、只读 dry-run、接口签名预检、文件哈希冲突保护、幂等注册、原子文件写入及失败回滚、锁文件预生成、依赖所有权与共享依赖保留。
- 文档：中文 README、配置示例、/add-napcat SKILL.md/REMOVE.md、真实 QQ 联调清单。

验证进展：15 项测试首次全绿后补充了安装边界和真实 socket 图片/引用测试。临时真实宿主（NanoClaw 2026.10.1-rc.2）安装、重复安装、构建、注册测试、删除 import 的反证测试、卸载和重建已通过；最终更改后重跑。

修正：旧连接账号校验延迟返回会覆盖新连接，已用连接代次阻止；回归用例经历失败后通过。宿主 `evaluateEngage` 把字面 `.` 视为匹配全部，因此 DM 默认使用 `.`，覆盖纯图片消息。OneBot API 中 QQ/消息查询 ID 使用 number，外部身份和地址仍用规范字符串。

限制：特殊 `requirePresentation` 卡片的专有展示不支持，明确投递失败；普通文字选项可用。OneBot 无文本编辑 API，终态通过新增消息展示。真实 QQ 联调尚未执行，按计划在 README 中逐项列为待验证，不将模拟协议测试当作账号联调证据。
