# Changelog

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
