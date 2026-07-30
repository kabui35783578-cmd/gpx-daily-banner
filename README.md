# GPX Daily Banner

GPX Daily Banner 面向使用「一生足迹」和 Obsidian 每日日记的移动端用户：把当天轨迹生成地图封面，并自动插入当天日记。

它的主流程不是持续后台同步，而是：快捷指令把当天轨迹文件保存到 Vault，打开 Obsidian 后插件读取一次并生成封面。

## 快速开始

### 1. 安装并启用插件

本地测试可以将 GitHub Release 压缩包解压到；也可以把公开仓库地址交给 BRAT 安装测试版本：

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

插件打开 Obsidian 后会按读取延迟执行有限次数的启动重试；轨迹同步文件在 Vault 中创建或修改时也会自动触发读取，不运行后台轮询。读取延迟可以在高级设置中调整。如果快捷指令或文件同步仍较慢：

- 在设置页点击 **重新读取今天文件**；或
- 从命令面板执行 **重新读取今天文件**。

轨迹文件没有变化时不会重复生成封面。

### 5. 日记中的全屏轨迹图

当天会额外生成桌面版和手机竖版两张 Hero 轨迹图，日记开头按屏幕宽度只显示对应版本，地图本身铺满第一屏，不再依赖模糊背景补空。横向 `YYYY-MM-DD-gpx-banner.png` 仍保留给 GPX 预览使用。打开日记时 Hero 会以轻微入场动效铺满首屏；向上滑动或使用电脑鼠标滚轮时，继续使用 Obsidian 原生滚动带动整张 Hero 与正文同步移动，不会锁住正文。

## 数据格式与日期

主数据源是当天动态命名的 `_raw` 文件，支持无扩展名和 `.csv` 后缀。插件每行只读取前三列：

```text
Unix 时间戳, 经度, 纬度, 其他列……
```

无效行、重复时间戳和越界坐标会被忽略；`_clean` 文件不会被选作数据源。时区模式决定当天文件名和 GPX 日期边界，移动端通常使用设备本地时区。

## 地图与隐私

默认使用国内高德清爽标注地图。生成封面时，地图服务商会收到轨迹所在区域的瓦片请求；这不是上传完整轨迹，但可能暴露活动区域。

在高级设置的“地图背景”中可以切换以下预置源：

| 地图源 | 适用场景 |
| --- | --- |
| 高德清爽标注（推荐） | 浅色道路与中文标注，适合作为日记封面 |
| 高德标准（国内） | 信息更密集的标准道路底图 |
| 高德极简标注 | 更少 POI 的浅色底图 |
| 高德卫星影像（国内） | 查看卫星影像 |
| 腾讯卫星影像（国内备用） | 高德不可用时的国内备用影像 |
| 天地图矢量（需 TK） | 使用天地图服务；需要填写你自己的 TK |
| CARTO / OpenStreetMap / OpenTopoMap | 海外或公共地图备用源 |

手机 GPS 原始轨迹通常是 WGS84。高德和腾讯底图使用 GCJ-02，插件会在中国境内自动转换轨迹后再绘制；如果你的 `_raw` 已经由其他工具转换过，请在“轨迹坐标系”中选择 GCJ-02，避免重复转换。天地图和公共地图源按 WGS84 绘制。

选定地图源加载失败时，插件会尝试其他国内源和 CARTO；全部在线源失败后，只要开启“在线地图失败时生成离线图”，仍会生成带轨迹线的离线封面。插件已取消同一瓦片的随机缓存破坏请求，减少手机端重复请求；仍建议把“最大地图瓦片数量”保持在较小值。

天地图 TK 只填写在当前 Vault 的插件设置中，不要把它写进仓库、截图或公开配置。地图服务的域名、访问策略和可用性可能变化，插件保留“自定义”瓦片地址作为兼容入口。

你可以在基础设置中关闭 **使用在线地图底图**，仅生成不含在线底图的离线轨迹图。在线瓦片加载失败时，插件默认自动生成离线图；地图版权文字会显示在在线地图封面中。

这里的地图网络和轨迹采集是两条独立链路：插件只能读取 Vault 中已经存在的 `_raw` 文件。如果手机端根本没有生成或同步 `_raw`，应另外检查一生足迹的定位权限、后台运行权限、系统省电限制，以及打开 Obsidian 后再执行一次同步；仅更换地图源不能补回缺失的轨迹数据。

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
| 地图为空或加载失败 | 切换高德清爽标注、高德标准或腾讯卫星等国内源，保持在线地图失败回退开启，或直接关闭在线地图生成离线图 |
| 手机端没有 `_raw` 文件 | 这不是地图源问题；检查一生足迹定位与后台权限、系统省电限制，以及快捷指令是否把文件保存到了 Vault |
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
