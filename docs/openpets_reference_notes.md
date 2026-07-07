# OpenPets 参考提炼与 DueFlow 落地边界

本文记录 DueFlow 对 `reference/openpets` 的参考结论。OpenPets 只作为架构样板，不作为 DueFlow 的运行依赖，不复制其源码、素材或插件包。

## 1. 明确边界

- 不把 DueFlow 从 Tauri 改为 Electron。
- 不引入 OpenPets 的包、插件 SDK、资源文件、图片、音频或构建链。
- 不复用 OpenPets 的具体实现代码。
- 只吸收工程模式：事件驱动、状态派生、动作注册、插件隔离、桌宠窗口与控制台分层。

## 2. 可借鉴设计

### 2.1 事件驱动

OpenPets 的插件总线把宿主能力和插件行为解耦，并隔离订阅者错误。DueFlow 采用更轻量的内部事件总线：

- `app.quick-input`：快捷输入请求。
- `overview.updated`：任务、计划、风险、桌宠状态刷新。
- `notice.show`：后续用于统一通知和气泡提示。

事件总线当前在前端窗口内运行；跨窗口事件仍通过 Tauri command/event 完成。

### 2.2 状态派生

OpenPets 将用户偏好、桌宠显示状态和外部活动拆成可测试的纯函数。DueFlow 对应建立 `petRuntime`：

- 后端仍提供事实状态：任务、计划、风险、`pet_state`。
- 前端 `derivePetRuntimeSnapshot` 负责派生展示需要的标签、动画类、风险计数和待办计数。
- 组件不再自己散落计算桌宠 label、severity 和 action。

### 2.3 动作注册

OpenPets 的插件动作和宠物 API 给扩展留出边界。DueFlow 当前先实现内置动作注册：

- `open-main`
- `quick-input`
- `toggle-pet`

后续可以扩展为本地技能/插件动作，例如“生成今日摘要”“静音 2 小时”“拖拽文件识别”“切换桌宠形象”。

### 2.4 桌宠窗口与控制台分层

OpenPets 将宠物窗口、控制中心、托盘和主进程职责拆开。DueFlow 保持现有结构：

- Tauri 壳：窗口、托盘、全局快捷键、后端自启动。
- React 主窗口：DDL 工作台、确认流、设置、自检。
- React 桌宠窗口：轻量状态展示和入口动作。
- Python 本地 API：输入解析、LLM 抽取、计划、风险和导出。

### 2.5 失败隔离

OpenPets 的插件运行时重视错误隔离和状态回滚。DueFlow 需要延续这个原则：

- 事件订阅者异常不能破坏主 UI。
- 桌宠动作失败只影响该动作，不影响状态轮询。
- LLM/OCR/文件解析失败进入 Inbox 错误态，不能直接丢数据。
- 后续插件化能力必须有权限、配额和 manifest 校验。

## 3. 本轮已落地

- 新增 `desktop/src/eventBus.ts`：前端内部类型化事件总线。
- 新增 `desktop/src/petRuntime.ts`：桌宠展示状态派生和动作注册。
- 新增 `desktop/src/platform.ts`：统一 Tauri runtime 判断和 command 调用。
- 主窗口快捷输入改为发布/订阅事件。
- 主窗口 overview 更新会发布 `overview.updated`，系统提醒改为消费该事件。
- 悬浮桌宠按钮改为调用统一动作注册，快速输入动作会触发 Tauri `focus_quick_input_window`。
- `notice.show` 已接入主窗口提示条，输入、编辑、导出和桌宠动作可以通过事件统一提示。
- `notice.show` warning 已桥接到 Tauri 系统通知，普通 info/success 默认保留在应用内，支持显式 system 标记，并通过本地存储做 5 分钟短时去重。
- 桌宠动作已具备 `queued` / `cancelled` / `started` / `retrying` / `finished` / `failed` / `blocked` 生命周期事件，悬浮窗口会展示排队、取消、执行中、重试、失败、冷却和忙碌反馈。
- 桌宠动作失败已分类为 `desktop_unavailable`、`permission_denied`、`transient_desktop` 和 `unknown`；非桌面运行时与权限拒绝不再无意义重试，瞬时桌面命令失败仍按动作配置有限重试。
- 内置桌宠动作支持本地策略偏好，设置页可调整每个动作的冷却时间和重试次数，并展示该动作是否需要桌面窗口控制权限。
- 新增 `desktop/tests/pet-runtime.test.ts` 与 `npm run test:runtime`，覆盖桌宠状态派生和动作执行路径。
- 新增 `desktop/src/petManifest.ts`，用内置 manifest 管理桌宠形象名称、版本、授权和状态素材解析，为后续自定义形象留出边界。
- 新增 `desktop/src/desktopBridge.ts`，将主窗口 `notice.show` 通过 Tauri window event 转发给桌宠窗口，实现跨窗口气泡提示。
- 桌宠窗口支持文件拖拽入口：拖入文件后调用现有 `intakeFile`，通过 `dueflow://intake` 将 `IntakeResponse` 发给主窗口，并打开同一套草稿确认面板。
- 桌宠拖拽文件结果已分层反馈：有草稿进入确认面板，重复/无草稿/失败记录跳到 Inbox 并高亮对应项，不支持文件、空文件、解析失败和本地服务连接失败会显示明确气泡。
- 桌宠气泡会保留最近一次成功拖拽的定位动作，可再次打开主窗口并高亮对应草稿或 Inbox 项；拖拽失败会显示本轮失败次数和重新拖入提示。
- Inbox 高亮项会自动滚动到可视区域；`failed` Inbox 项支持一键重试抽取，重试前会清除上一次错误。
- 重复 Inbox 项会带 `duplicate_of` 原始记录摘要，前端显示“重复于”并支持一键跳转原始记录。
- 新增 `desktop/src/skillRegistry.ts`，以声明式 manifest 管理内置技能、动作和权限；当前只允许白名单权限，并强制禁用外部代码执行。
- Tauri 壳新增本地 `skills/` 目录只读扫描，只读取 `skill.json` / `*.skill.json` manifest，限制 64 KiB，并把解析结果交给前端 registry 做安全审计。
- 设置页新增本地插件管理入口：可刷新 manifest 扫描、打开固定 `skills/` 目录、查看前 5 条校验结果，通过前端偏好启用/禁用本地 manifest，并展开查看路径、元信息、权限、动作和完整错误。
- 已启用且校验通过的本地 manifest 动作会合并进可见动作列表，但标记为“本地只读”，不会执行第三方代码。
- 可见动作列表支持全部/内置/本地筛选，并展示动作权限标签；只有绑定到 DueFlow 内置桌宠命令的动作可执行。
- 内置桌宠动作已加入单队列串行执行、待执行项取消、成功后短冷却、失败分类、用户可配置冷却/重试策略，以及桌面命令失败时的有限自动重试。
- `petRuntime` 测试覆盖等待、无任务、信息不完整、DDL 接近、逾期、动作重试、冷却、队列和取消等核心状态路径。
- Tauri 壳新增本地 `pets/` 投放目录和 `pets-active/` 受控启用目录扫描，只读取 `pet.json` / `*.pet.json` manifest，限制 64 KiB，并把解析结果交给前端形象 registry 做安全审计。
- 设置页新增本地桌宠形象管理入口：可刷新 manifest 扫描、打开固定 `pets/` 目录、查看前 5 条校验结果，并展开查看路径、来源、名称、版本、作者、许可证、尺寸、缩放、缩略图、状态资产和完整错误/警告。
- 桌宠形象 manifest 已校验稳定 id、显式授权、尺寸、缩放、状态名、相对资源路径和安全图片扩展名；本地形象支持预览、确认授权后导入受控副本、运行时解析为 Tauri 文件 URL，并可回退内置形象。
- 桌宠形象授权确认已从路径列表升级为记录：保存受控 manifest 路径、确认时的 license 文本和确认时间，并兼容旧的 path-only 偏好。
- 本地桌宠形象预览会优先使用 manifest 声明的缩略图，并缓存本地资产 URL；运行时形象异常回退内置形象时，桌宠气泡会提示回退原因且避免轮询重复刷屏。
- 新增 `import_local_pet_appearance` Tauri 命令：启用形象时重新读取 manifest，只复制声明的本地图片资产到 `pets-active/<id>-<version>/`，拒绝 URL、绝对路径、父级越界、不支持扩展名和超大资产，并通过 staging 目录保证失败不破坏当前副本。
- Tauri Rust 单测覆盖本地桌宠形象导入成功路径、缩略图/状态资产复制、导入来源目录边界，以及资产缺失时保留既有 active 副本并清理 staging 目录。
- 新增 `/desktop/self-check` 和设置页自检结果，覆盖数据库目录可写、SQLite 完整性、表结构、Inbox/导出目录可写、LLM 配置和 OCR 可用性。
- 新增 `npm run preflight`，发布脚本默认调用本地 self-check；存在 error 时阻断打包，warning 默认只提示。
- 新增 `/desktop/database/backup`、备份列表/下载接口和设置页数据库备份入口，用 SQLite 在线备份生成一致快照，发布和升级前可以先落地并核对恢复点。
- 新增 `/desktop/database/restore` 和设置页受控恢复入口：只允许恢复安全命名的本地备份，先做 SQLite 完整性和核心表校验，再创建恢复前备份，最后替换当前数据库。
- 数据库初始化维护 SQLite `PRAGMA user_version`，并抽出轻量迁移 runner：当前支持 `0 -> 1`，会幂等确保 v1 表存在，未来版本会拒绝启动，self-check 和恢复流程都会校验 schema version，为后续桌面端升级和迁移留出明确兼容边界。
- 新增 `/desktop/about` 和设置页版本信息卡片，集中展示 API version、schema version、Python/平台、数据路径和备份恢复能力，便于桌面端排障和用户环境核对。
- `npm run preflight` 已接入 `/desktop/about`，发布前会打印版本/平台/数据库路径摘要，并阻断 schema version 与 supported schema version 不一致或备份/恢复/诊断导出能力缺失的构建。
- macOS release manifest 已由独立脚本生成并嵌入 preflight 摘要，记录自检计数、API/schema version、Python/平台和支持能力；新增回归测试覆盖有/无 preflight 两种发布场景，方便追溯发布包的本地验证状态。
- 新增 `/desktop/diagnostics`、诊断报告导出和设置页导出诊断入口，输出版本、自检、数据统计和最近备份摘要，不包含 Inbox 原文或任务标题，方便用户本机排障交付；诊断 JSON 仅保留最近 10 份，并只清理 DueFlow 安全命名文件。
- 新增 `npm run test:smoke` 桌面冒烟门禁：使用临时数据库启动隔离 API，校验 Tauri 主窗口/桌宠窗口配置，并通过真实 HTTP 流程覆盖文件输入、重复检测、草稿确认、状态更新、导出、备份、恢复和诊断导出，同时断言诊断报告不包含 Inbox 原文或任务标题。

## 4. 后续上线级升级方向

1. 增加签名前人工桌面窗口检查：启动 Tauri、真实拖拽样例文件、确认草稿、切换桌宠形象的窗口表现，并核对系统通知权限。
