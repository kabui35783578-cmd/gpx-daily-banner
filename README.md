# GPX Daily Banner

GPX Daily Banner 面向使用「一生足迹」和 Obsidian 每日日记的移动端用户：把当天轨迹生成地图封面，并自动插入当天日记。

它的主流程不是持续后台同步，而是：快捷指令把当天轨迹文件保存到 Vault，打开 Obsidian 后插件读取一次并生成封面。

## 快速开始

### 1. 安装并启用插件

本地测试可以将 Release 压缩包解压到；公开仓库建立后，也可以通过 BRAT 安装测试版本：

```text
<你的 Vault>/.obsidian/plugins/gpx-daily-banner
```

然后在 Obsidian 的第三方插件设置中启用 **GPX Daily Banner**。

### 2. 配置日记

打开插件设置：

- 默认自动跟随 Obsidian 核心 **Daily Notes** 的文件夹、日期格式和扩展名。
- 如果你使用其他日记系统，可以关闭“日记配置来源”中的自动跟随，再手动填写路径。
- 日记不存在时默认不会静默创建；可以打开“日记不存在时自动创建”。

### 3. 配置快捷指令同步

插件设置中的公开名称是 **快捷指令同步**，目录设置名称是 **轨迹同步文件夹**。默认目录为：

```text
附件/当日轨迹
```

快捷指令需要完成以下动作：

1. 计算当前日期在目标时区的当天 00:00:00。
2. 将时间转换为 Unix 时间戳（秒），拼接成 `<时间戳>_raw`。
3. 读取 `一生足迹/DailyData/<时间戳>_raw`。
4. 将原始内容保存到 Vault 的轨迹同步文件夹，保留原文件名；如果系统自动增加 `.csv` 后缀也可以。
5. 不要读取或覆盖 `_clean` 文件，也不要修改一生足迹原目录中的文件。

插件设置页提供“复制快捷指令配置步骤”按钮，可直接复制上述说明。

### 4. 读取今天的轨迹

插件打开 Obsidian 后只读取一次当天文件，读取延迟可以在高级设置中调整。如果快捷指令或文件同步较慢：

- 在设置页点击 **重新读取今天文件**；或
- 从命令面板执行 **重新读取今天文件**。

插件不运行后台轮询。轨迹文件没有变化时不会重复生成封面。

## 数据格式与日期

主数据源是当天动态命名的 `_raw` 文件，支持无扩展名和 `.csv` 后缀。插件每行只读取前三列：

```text
Unix 时间戳, 经度, 纬度, 其他列……
```

无效行、重复时间戳和越界坐标会被忽略；`_clean` 文件不会被选作数据源。时区模式决定当天文件名和 GPX 日期边界，移动端通常使用设备本地时区。

## 地图与隐私

默认使用在线地图底图。生成封面时，地图服务商会收到轨迹所在区域的瓦片请求；这不是上传完整轨迹，但可能暴露活动区域。

你可以在基础设置中关闭 **使用在线地图底图**，仅生成不含在线底图的离线轨迹图。在线瓦片加载失败时，插件默认自动生成离线图；地图版权文字会显示在在线地图封面中。

## GPX 辅助功能

一生足迹是首要流程，手动 GPX 功能作为兼容和辅助能力保留：

- 自动处理 Vault 中新建的 `.gpx` 文件；
- 支持 GPX 1.0/1.1、多轨迹和多段路线；
- 支持同一天多个 GPX 合并；
- 支持使用当前 GPX 覆盖日记封面；
- 支持地图失败时的离线图；
- 可选归档或删除手动处理成功的 GPX，默认不删除。

当同一天已经存在一生足迹数据时，自动 GPX 处理不会覆盖当天封面。需要时可通过命令 **使用当前 GPX 覆盖日记封面** 明确执行覆盖。

## 设置分层

基础设置只保留移动端主流程需要的选项：

- 轨迹同步文件夹；
- Daily Notes 自动跟随或手动配置；
- 日记不存在时是否自动创建；
- 是否请求在线地图。

地图瓦片、尺寸、时区、断档阈值、轨迹样式、GPX 归档和调试日志位于高级设置。

旧版本的外部目录模式仍可兼容读取，但不再作为新用户流程。打开设置时可以切换到快捷指令同步。

## 故障排查

| 现象 | 处理方式 |
| --- | --- |
| 设置页显示找不到今天的轨迹文件 | 检查文件名是否为当天时间戳加 `_raw`，以及是否保存到了轨迹同步文件夹 |
| 文件存在但没有封面 | 确认当天日记已经存在，或打开自动创建；然后点击“重新读取今天文件” |
| 轨迹日期不对 | 检查时区模式和快捷指令计算当天 00:00 的时区是否一致 |
| 地图为空或加载失败 | 保持在线地图失败回退开启，或直接关闭在线地图生成离线图 |
| 修改设置后封面没有变化 | 点击“重新生成已有封面”或命令面板中的“重新生成所有轨迹封面” |

## 构建与测试

需要 Node.js 和 pnpm：

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm release
```

`pnpm build` 会生成 `main.js`。`pnpm release` 会创建不包含 `node_modules` 的可安装压缩包。

## English

GPX Daily Banner is a mobile-first Obsidian plugin for users of 一生足迹 and Daily Notes. It reads the day’s `_raw` track file from a Vault folder, renders a map banner, and inserts it into the matching daily note.

The primary flow is intentionally simple: a shortcut copies the source file into the Vault, and the plugin reads it once when Obsidian opens. There is no background polling; a manual refresh command is available when synchronization is delayed.

The plugin follows Obsidian’s core Daily Notes settings by default, supports a manual override, and keeps the existing GPX import workflow as an advanced compatibility feature. Online map tiles are enabled by default with a privacy notice, while offline-only rendering and automatic offline fallback are supported.

For local installation, extract a Release archive into `<vault>/.obsidian/plugins/gpx-daily-banner`, then enable the plugin in Obsidian’s Community Plugins settings. Once a public repository is available, BRAT can be used for testing before a Community Plugins submission.

## License

MIT. See [LICENSE](LICENSE). Release history is in [CHANGELOG.md](CHANGELOG.md).
