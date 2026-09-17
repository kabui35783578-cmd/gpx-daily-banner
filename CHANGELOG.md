# Changelog

## 0.3.10

### Changed

- 重构优化设置界面：
  - 顶部替换为紧凑的即时状态看板（Status Card），状态、今日轨迹与日记就绪情况一目了然，指南默认收纳不占屏；
  - 启用核心日记跟随模式时，自动隐藏“日记文件夹”、“日期格式”等冗余输入框；
  - 轨迹颜色支持原生调色盘选择与预设色块快速点选；
  - 整合封面角标开关与高级专家参数（默认折叠），大幅减少视觉噪音。

## 0.3.9

### Changed

- 手动上传 GPX 文件时默认直接覆盖对应日期的日记封面（移除一生足迹冲突弹窗拦截），哪天的 GPX 就直接覆盖哪天的封面。
- 一生足迹在后台常规自动同步时，自动保护已由用户手动 GPX 覆盖的日期，避免被一生足迹反向冲刷。
- “同一天多个 GPX”配置项默认调整为“覆盖模式（replace）”。

## 0.3.8

### Fixed

- 修复开启插件后移动端（Live Preview / 编辑模式与阅读模式）日记正文文字紧贴屏幕最左侧边缘的问题，移除全局 `padding-inline: 0` 破坏性样式，恢复并保障移动端自然呼吸内边距。
- 修复日记顶部地图 Hero 下方偶尔露出的 `<!-- gpx-daily-banner:end -->` 标记文本，增强 Unicode 零宽字符净化与多模式隐藏机制。

### Changed

- 优化移动端手机视图适配规则，确保在各类缩放比例下稳定呈现竖屏专用 Hero 封面。
- 确保符合 Obsidian BRAT 插件自动更新与安装标准。

## 0.3.7

### Fixed

- 修复导入历史日期 GPX 时，仅因同日一生足迹 `_raw` 文件存在就被误判为“已有轨迹”而跳过生成的问题；现在只保护已经成功写入且封面文件完整的一生足迹结果。

## 0.3.6

### Fixed

- 修复新打开实时预览时 CodeMirror 复用行并只更新文字节点，导致 `gpx-daily-banner:end` 偶尔未被隐藏的问题。

### Changed

- 优化实时预览与阅读模式切换：移除动态 `:has()` 样式匹配，合并重复 DOM 扫描，并忽略普通正文输入产生的无关 DOM 变化。
- 阅读模式在 Hero 挂载后一次性绑定视图和包装层；窗口、分栏及手机工具栏尺寸变化时只校准相关轨迹视图。
- Hero 入场动效改为按标签页和轨迹只执行一次，缩短为 180ms，并避免全屏图片缩放及主题整页过渡。
- 为当前设备使用的 Hero 图片设置优先加载，另一设备版本改为延迟加载提示。
- 插件启动时只读取一次持久化数据，并在 Markdown 修改事件进入处理流程前直接过滤普通笔记输入。

### Removed

- 删除已经不参与全屏 Hero 的旧封面高度、手机高度和圆角设置、无效的阅读模式标记文本扫描，以及未被调用的旧瓦片预览加载器和辅助导出。

## 0.3.5

### Fixed

- 修复实时预览输入正文时反复扫描整页、重算 Hero 布局并重播入场动画造成的界面闪烁。
- 日记正文修改不再触发“等待日记创建”重试；该重试只在 Markdown 文件首次创建时执行。

## 0.3.4

### Changed

- 为日记生成桌面版和手机竖版两张全屏地图 Hero，同时保留横向封面供 GPX 预览使用。
- 移除会造成大块空白的模糊背景补图逻辑，改为响应式图片铺满首屏。
- 使用稳定的首屏入场动效；触摸上滑或鼠标滚轮继续使用 Obsidian 原生滚动，整张 Hero 与正文同步移动。
- 修复 Bureau 等主题和 Obsidian 核心样式造成的左侧留白、顶部空白与嵌入边距。
- 在屏幕旋转、分屏和移动可视区域变化后自动重新测量并对齐 Hero。

## 0.3.3

- Fixed mobile startup timing by retrying the bridge file read a limited number of times.
- Added create/modify listeners for the current `_raw` bridge file and waited for a stable file before parsing.
- Added lighter AMap `高德清爽标注` and `高德极简标注` presets; the clean preset is now the default for new and legacy default installations.

## 0.3.2

- Fixed the default AMap standard basemap so Chinese place names and street labels are visible.
- Added automatic migration from the previous road-network-only AMap tile configuration.
- Added regression coverage for the labeled AMap tile URL.

## 0.3.1

- Added domestic AMap standard and satellite tile sources.
- Added Tencent satellite tiles as a domestic fallback source.
- Added Tianditu vector tiles with optional TK configuration.
- Added WGS84/GCJ-02 track conversion for domestic map sources.
- Added automatic source fallback and stricter visible-tile completeness checks.
- Removed redundant cache-busting tile retries to reduce mobile network requests.

## 0.3.0

- Reframed the primary workflow around mobile 一生足迹 users.
- Added a first-use guide with bridge-folder status and shortcut instructions.
- Renamed the public data flow to “快捷指令同步” and “轨迹同步文件夹”.
- Added basic/advanced settings sections.
- Added optional alignment with Obsidian core Daily Notes settings.
- Preserved custom daily-note paths when upgrading older installations.
- Added an online-map privacy toggle and offline-only rendering.
- Kept GPX import as an advanced compatibility feature.
- Added bilingual release documentation, MIT licensing, and a release packaging script.

## 0.2.5

- Added mobile bridge reading for 一生足迹 `_raw` files.
- Added offline fallback rendering and manual GPX override commands.
