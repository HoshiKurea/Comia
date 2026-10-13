# 专项浏览器测试配置

根目录的 [playwright.config.ts](../../playwright.config.ts)是默认入口。本目录保留功能回归、跨引擎、离线及性能配置，避免根目录堆积配置文件。

从**项目根目录**执行，例如：

```powershell
npx playwright test --config=tests/config/playwright.bubbles-crop.config.ts
npx playwright test --config=tests/config/playwright.cross-browser.config.ts
npm run build
npx playwright test --config=tests/config/playwright.offline.config.ts
npx playwright test --config=tests/config/playwright.freehand.config.ts
npx playwright test --config=tests/config/playwright.freehand-offline.config.ts
```

气泡／裁剪的独立配置使用5221；设置`COMIA_BUBBLE_BROWSER=cross`时使用5222与三种引擎。各配置中的`testMatch`、浏览器、超时、DPR和独立端口保持原设置。

性能用例使用对应的`*-performance.config.ts`；基础性能配置另有DPR2入口。应按用例选择配置，避免并发占用同一端口或输出目录。

自由绘画窗口配置使用5252，包含实际流程、局部快捷键和DPR1/2连续输入；其生产离线配置使用4252，需先构建。新入口继续保留既有B笔刷的回归。

配置路径相对本目录解析：`testDir`指向相邻的e2e/offline/performance目录，`webServer.cwd`返回项目根目录，报告与产物留在根目录的`output/`或`test-results/`中并被Git忽略。

这些文件是可重复运行的测试入口，不是测试生成报告；测试断言仍在[tests](../)中。完整运行说明见[开发文档](../../docs/guide/development.md)。

漫画原稿与定位线：`npx playwright test --config=tests/config/playwright.manuscript.config.ts`，独立端口5237，Edge DPR1/2。覆盖新建8页、继承、坐标/撤销、无主绘显隐、保存重开、真实无定位线PNG/PDF和绘制成本。

生产原稿专项：先 `npm run build`，再 `npx playwright test --config=tests/config/playwright.manuscript-offline.config.ts`（4257、Edge DPR1/2），包含原稿及旧项目菜单离线回归。
