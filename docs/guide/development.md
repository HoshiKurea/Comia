# 开发与部署

[项目首页](../../README.md) · [文档导航](README.md) · [架构约定](../architecture.md)

本页面向需要运行源码、执行检查、部署静态站点或继续开发的人。操作手册见[使用指南](user-guide.md)。

## 环境与安装

当前项目版本由 [package.json](../../package.json)定义，要求 Node **22.12.0+**、npm **10+**。文档制作环境为 Windows，Node **24.11.1**、npm **11.6.2**；这不是所有符合最低要求的版本组合都已逐个实测的声明。

```powershell
git clone https://github.com/HoshiKurea/Comia.git
cd Comia
npm ci
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

仓库已公开，可直接获取源码；向仓库推送仍需要相应权限。需要认证时请使用正常的 Git 凭据流程，不把令牌写进命令、远程地址或文档。

使用 `npm ci`遵循锁文件。不要全局升级 Vite 后绕过工程依赖，也不要因版本错误先删锁文件。项目无需 `.env`里的服务端密钥即可本地运行；当前不含业务后端或 AI 推理服务。

## 技术组成

| 组成 | 作用 |
| --- | --- |
| React、TypeScript、Vite | 应用 UI、类型和构建 |
| Zustand | 文档、会话与运行资源状态 |
| Konva、react-konva、Canvas | 画布、控制柄与独立交互预览 |
| polygon-clipping | 轮廓布尔运算；该依赖固定为 0.15.7 |
| jsPDF | 分页 PDF 封装 |
| Vitest、Testing Library | 模型、算法、事务与界面单元测试 |
| Playwright | 真实浏览器行为、输出、离线和性能场景 |

其余依赖及精确安装版本以 [package-lock.json](../../package-lock.json)为准。

`package.json`中的`private: true`用于阻止意外发布 npm 包，不是 GitHub 仓库可见性设置。仓库现为公开；该包配置保持不变。

## 工程入口

| 路径 | 内容 |
| --- | --- |
| [src/main.tsx](../../src/main.tsx) | 应用启动 |
| [src/app/EditorShell.tsx](../../src/app/EditorShell.tsx) | 顶部菜单、项目与编辑器外壳 |
| [src/app/CanvasView.tsx](../../src/app/CanvasView.tsx) | 画布与手势连接 |
| [src/domain/types.ts](../../src/domain/types.ts) | 统一文档模型 |
| [src/domain/limits.ts](../../src/domain/limits.ts) | 数据、几何和输出预算 |
| [src/history/commandBus.ts](../../src/history/commandBus.ts) | 事务提交、撤销重做与文档替换 |
| [src/geometry/matrix.ts](../../src/geometry/matrix.ts) | 坐标矩阵与变换 |
| [src/render/compileScene.ts](../../src/render/compileScene.ts) | 场景编译与画序 |
| [src/render/drawScene.ts](../../src/render/drawScene.ts) | 画布、缩略图和成品共享绘制 |
| [src/assets/AssetLibrary.tsx](../../src/assets/AssetLibrary.tsx) | 素材与文件夹界面 |
| [src/freehand/DrawingWindow.tsx](../../src/freehand/DrawingWindow.tsx) | 自由绘画窗口、独立预览与局部历史 |
| [src/library/componentCatalog.ts](../../src/library/componentCatalog.ts) | 图标组件分类 |
| [src/library/presetModel.ts](../../src/library/presetModel.ts) | 自定义组件与笔刷预设 |
| [src/commands/catalog.ts](../../src/commands/catalog.ts) | 命令与默认快捷键的唯一目录 |
| [src/workspacePanels/PanelWorkspace.tsx](../../src/workspacePanels/PanelWorkspace.tsx) | 停靠／浮动面板工作区 |
| [src/storage/codec.ts](../../src/storage/codec.ts) | 项目文件编码与校验 |
| [src/storage/migrateProject.ts](../../src/storage/migrateProject.ts) | 旧作品迁移 |
| [src/export/exportFiles.ts](../../src/export/exportFiles.ts) | 成品预检与导出 |
| [src/offline/register.ts](../../src/offline/register.ts) | 生产离线安装与版本交互 |
| [tests](../../tests) | 单元、浏览器、离线等测试 |
| [scripts](../../scripts) | 字体校验、离线生成、成品核验和审计 |
| [docs/architecture.md](../architecture.md) | 数据、事务、几何、渲染和暂定产品决策 |
| [docs/STATUS.md](../STATUS.md) | 当前状态与实际检查范围 |
| [tests/config](../../tests/config/README.md) | 专项浏览器、离线与性能入口 |

## 漫画原稿专项

开发行为验证：`npx playwright test --config=tests/config/playwright.manuscript.config.ts`（5237、Edge DPR1/2）。生产离线：先构建，再执行 `npx playwright test --config=tests/config/playwright.manuscript-offline.config.ts`（4257）。覆盖物理尺寸、多页、继承、设置撤销、独立辅助层显隐、保存重开及真实PNG/PDF。性能数据与原始产物位于本地忽略的output/manuscript，不随仓库推送。

## 基础检查

```powershell
npm run typecheck
npm test
npm run build
```

| 命令 | 含义 |
| --- | --- |
| `npm run dev` | 开发服务，支持热更新 |
| `npm run typecheck` | TypeScript 检查 |
| `npm test` | 单元测试，执行后退出 |
| `npm run test:watch` | 单元测试监听 |
| `npm run test:e2e` | 默认 Playwright 浏览器测试 |
| `npm run build` | 字体与字形校验 → 类型检查 → Vite → 生成离线 Service Worker |
| `npm run preview` | 本机检查已有 dist 构建，不重新构建 |

字体未校验通过时，不应绕过构建检查。测试失败时保留真实失败与修复记录，不通过删除断言、跳过测试或降低输出质量“变绿”。

自由绘画的实际Edge流程与DPR1/2性能场景：

```powershell
npx playwright test -c tests/config/playwright.hand-bubble.config.ts
npx playwright test -c tests/config/playwright.selection-properties.config.ts
npx playwright test -c tests/config/playwright.hand-bubble-performance.config.ts
npx playwright test -c tests/config/playwright.freehand.config.ts
npm run build
npx playwright test -c tests/config/playwright.freehand-offline.config.ts
```

手绘气泡／多选属性／压力测试使用5231／5233／5232，素材窗口与离线分别使用5252与4252，不操作开发者正在使用的5173作品。结果写入被忽略的`output/`；数据模型、轮廓、源摘要、事务、重开、尾巴、融合及预算测试位于`tests/unit/freehand.test.ts`。

## 浏览器检查

先准备 Playwright 的浏览器：

```powershell
npx playwright install chromium firefox webkit
```

Windows 默认配置另需已安装 Microsoft Edge。浏览器配置会启动服务或复用已有服务，先读配置中的 `baseURL`、`webServer`和`reuseExistingServer`，避免在用户正在编辑的源站执行修改作品的测试。

### 最近扩展的独立端口测试

[playwright.bubbles-crop.config.ts](../../tests/config/playwright.bubbles-crop.config.ts)使用 5221／5222，拒绝复用已有服务，适合隔离最近气泡、文字、裁剪与切割测试：

```powershell
# 默认 Edge，使用 5221
npx playwright test --config=tests/config/playwright.bubbles-crop.config.ts

# Windows 上的 Chromium、Firefox、WebKit，使用 5222
$env:COMIA_BUBBLE_BROWSER = 'cross'
try {
    npx playwright test --config=tests/config/playwright.bubbles-crop.config.ts
} finally {
    Remove-Item Env:COMIA_BUBBLE_BROWSER -ErrorAction SilentlyContinue
}
```

这是一组相关回归，不代表所有历史测试文件都被选入。需要覆盖新模块时，检查配置的 `testMatch`并选择相应测试，而不是仅依赖此命令。

### 默认、跨引擎与生产离线

以下配置会使用 5173／4173；先确认没有用户作品占用这些站点，或为验证复制配置并设置独立端口：

```powershell
npx playwright test --config=playwright.config.ts
npx playwright test --config=tests/config/playwright.cross-browser.config.ts
npm run build
npx playwright test --config=tests/config/playwright.offline.config.ts
```

[默认配置](../../playwright.config.ts)使用 Edge，[跨引擎配置](../../tests/config/playwright.cross-browser.config.ts)使用 Chromium、Firefox、WebKit；[离线配置](../../tests/config/playwright.offline.config.ts)测试生产构建。不要并发运行依赖同一端口或同一输出文件的配置。

真实输入法、系统选择器、实体触笔和特定设备浏览器行为需单独记录，不能用脚本发出的模拟事件冒充人工实测。

<a id="deployment"></a>
## 生产构建与静态部署

### 本机查看构建

```powershell
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

打开 [http://127.0.0.1:4173/](http://127.0.0.1:4173/)。`preview`用于检查构建结果，不是面向公网的生产服务器。

### 部署步骤

1. 构建成功后，将 **dist 的完整内容**部署到静态站点根路径。
2. 同时提供入口、构建 assets、fonts、licenses、Service Worker 及其生成清单。不要只传 HTML/JS。
3. 以 HTTPS 提供生产站点；本地开发使用 localhost／127.0.0.1。设置正确静态内容类型，避免资源请求被统一回退成 HTML。
4. 首次打开，检查界面、字体、资源和离线安装；刷新并重新打开保存的项目，再做一次成品输出。
5. 更新时保证同一构建的文件完整可用，再发布对应入口和离线版本；避免长缓存把旧入口和新资源混搭。

当前 Vite 配置使用默认根路径 `/`。**子目录部署不是本文已验证的即插即用方案**：需要同步调整 Vite base、Service Worker 生成 URL／scope，并实测首次安装、更新及离线路径。

### 离线范围与更新

生产版 Service Worker 缓存应用静态资源，并校验完整性。首次必须能访问完整生产站点，约 31.9 MiB 的打包中文字体也包含在资源中；开发服务不安装此缓存。

离线缓存不是作品备份，不缓存用户项目下载或远程素材。清除缓存或浏览器回收站点数据后，需要重新安装。新版本完整准备后，应用提供重启入口；先保存作品，再按提示切换。其他仍打开的标签可继续使用自己的旧版本，不强制一起刷新。

## 维护约束

- 文档是单一作品数据源，内容编辑统一通过事务；手势草稿不能逐帧进历史。
- 高速预览使用独立交互层，保持原画序与祖先裁剪；不能通过把拖动物体临时置顶来掩盖问题。
- 修改模型时同步更新工厂、校验、迁移、复制、预设、存储、渲染和成品路径。
- 编号跨项目页面唯一；切割插号与普通创建不同，测试需检查跨页顺延、删除、撤销和自定义名称。
- 导出不能静默缩倍率、跳过失败素材或以占位内容代替真实资源。
- 新行为按可观测验收标准验证；每次测试注明命令、源码版本、设备、场景与实际结果。
- 不把暂定产品决策改写为最终承诺；技术修订和未确认项记录到当前状态与架构约定。

## 存储与隐私边界

作品在浏览器本地编辑，素材资源随用户主动保存的文件／目录管理。恢复记录使用 IndexedDB，工作区和首选项使用浏览器站点存储；它们具有站点与设备边界。

本机字体访问由用户触发，只保存作品请求的字体名称，不把本机字体文件打包到漫画。项目不提供云端作品同步；自行部署时，托管平台的访问日志、访问控制和第三方资源政策仍由部署者管理。

正式源文件建议备份；源码仓库不应包含用户私有漫画、凭据和测试产生的大型输出。[.gitignore](../../.gitignore)已排除本地依赖、dist、output、常见凭据和机器设置。

<a id="verification"></a>
## 验收证据与范围

当前发布范围和检查见 [STATUS](../STATUS.md)。**不要把文档中的通过数理解成你刚克隆的环境已经执行过检查**。新环境应执行对应命令并保存自己的结果。

Windows 的 WebKit 自动化不等于 macOS Safari 实机。macOS Safari 与实体触笔验收由用户取消；新原生输入法、系统选择器人工操作和 GPU 最终扫描等未执行项仍保留为未执行。

历史机器台账、阶段报告及依赖本机原始证据的一次性审计脚本不再上传。原始日志、trace、PNG/PDF和规划记录保留在原开发机；公共仓库保留测试源和可重复运行的配置，重新运行会生成本机证据。

构建需要的字体校验／离线生成脚本、格式测试素材生成器和可重复使用的成品解析脚本仍保留。Python成品解析脚本`verify-export-artifacts.py`需要安装PyMuPDF并先运行对应导出测试；它不是前端启动依赖。

<a id="reporting"></a>
## 问题报告与继续开发

报告包含：

1. 系统、浏览器名称与版本，使用开发／生产构建，实际访问地址。
2. 可复现步骤，包括工具、按键、选择层级、是否锁定、是否正在输入法组合。
3. 实际结果与预期结果，以及完整错误提示和必要截图。
4. 涉及素材的格式、尺寸、文件大小，页面像素、DPI 和导出倍率。
5. 是否能在新建空项目重现，以及能否提供去除私密内容的最小项目。
6. 源码提交、执行的检查命令与实际结果；未执行的检查明确写未执行。

继续开发前先读 [STATUS](../STATUS.md)、[架构约定](../architecture.md)与适用 AGENTS.md，检查工作树，避免覆盖他人修改。项目源码当前没有指定开源许可证；贡献与分发权限需与仓库所有者确认。字体许可另见 [OFL](../../public/licenses/noto-cjk-OFL.txt)。

### 属性面板专项核验

```powershell
npx playwright test --config tests/config/playwright.reference-properties.config.ts
npx playwright test --config tests/config/playwright.reference-performance.config.ts
npx playwright test --config tests/config/playwright.selection-properties.config.ts
npx playwright test --config tests/config/playwright.hand-bubble.config.ts
npx playwright test --config tests/config/playwright.hand-bubble-performance.config.ts
```

性能配置使用单worker，避免与其他测试并行测量。测试只测JS输入／绘制，不代表GPU帧呈现；输出存本机忽略目录。效果输出以真实PNG/PDF生成和解析为准，不用CSS截图代替。
