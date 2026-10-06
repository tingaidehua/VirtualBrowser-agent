# 本地同步（Local Sync）

在保留原有「云同步」的前提下，增加免费的「本地同步」：

- 侧栏「云同步」下方会出现「本地同步」
- 设置页若出现云同步相关区块，也会插入本地同步目录配置入口
- 默认目录：`~/OneDrive/VirtualBrowser/`（即 `%USERPROFILE%\OneDrive\VirtualBrowser`）
- 启动时自动加载（可关）
- 退出时自动上传已开启本地同步的环境（可关）

## 同步内容

与换机所需数据对齐：

- 环境配置（`virtual.dat` 中的 profile）
- 分组等全局配置（`global.dat`）
- 环境缓存目录（`Workers/<id>`，含 Cookie 等）

目录结构：

```
OneDrive/VirtualBrowser/
  manifest.json
  virtual.dat
  global.dat
  environments/
    <syncId>/
      meta.json
      worker/
```

## 使用

1. 打开 VirtualBrowser
2. 点侧栏「本地同步」
3. 确认同步位置（可改）
4. 勾选本地环境 →「批量开启本地同步」→「批量上传」
5. 换电脑：安装同版本 VirtualBrowser 后打开「本地同步」，勾选同步库项 →「批量下载/恢复」，再刷新环境列表

## 技术说明

- GitHub 上的 `C:\workspace\VirtualBrowser` **不是**完整桌面端源码（缺 Electron 主进程 / Chromium，主逻辑在加密的 `app.jsc`）
- 本功能通过修改安装目录实现：
  - `resources/app` → junction 到 `_asar_extract`
  - `resources/local-sync/` 提供 IPC 与 UI 注入
  - 原 `app.asar` 备份为 `app.asar.official.bak`

## 恢复原版

管理员 PowerShell：

```powershell
Stop-Process -Name VirtualBrowser -Force -ErrorAction SilentlyContinue
Remove-Item "C:\Program Files\VirtualBrowser\resources\app" -Force -ErrorAction SilentlyContinue
cmd /c rmdir "C:\Program Files\VirtualBrowser\resources\app"
Move-Item "C:\Program Files\VirtualBrowser\resources\app.asar.official.bak" "C:\Program Files\VirtualBrowser\resources\app.asar"
Remove-Item "C:\Program Files\VirtualBrowser\resources\local-sync" -Recurse -Force
```
