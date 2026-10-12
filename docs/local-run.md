# 本机运行 Comia

运行说明已合并到当前用户文档，旧链接保留作为入口。

- [快速上手：安装、启动与第一张漫画](guide/getting-started.md)
- [开发与部署：构建、测试、静态站点与离线](guide/development.md)
- [使用手册：真正裁剪、独立遮罩、字体与保存](guide/user-guide.md)
- [常见问题：端口、Node 版本、文件和输出](guide/faq.md)

最低环境：Node.js **22.12.0+**，npm **10+**。项目目录内执行：

```powershell
npm ci
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

浏览器打开 [http://127.0.0.1:5173/](http://127.0.0.1:5173/)。生产预览需先构建；不要直接双击 dist/index.html。开发模式不安装生产离线缓存。

当前 `C` 是改变素材实例选择范围的真正裁剪，`Shift+C` 是独立遮罩；早期“编辑裁剪”说明指的是适配分镜取景，不能替代这两个工具的当前操作指南。
