# Basketball FRVR - 本地运行指南

这是一个基于 HTML5 的篮球投篮游戏项目。

## 快速开始

由于项目使用相对路径加载资源，需要通过 HTTP 服务器运行（不能直接打开 HTML 文件）。

### 方法 1: 使用 Python（推荐，最简单）

如果你安装了 Python：

```bash
# Python 3
python3 -m http.server 8000

# Python 2
python -m SimpleHTTPServer 8000
```

然后在浏览器中访问：`http://localhost:8000`

### 方法 2: 使用 Node.js

如果你安装了 Node.js，可以使用 `http-server`：

```bash
# 安装 http-server（全局安装，只需一次）
npm install -g http-server

# 运行服务器
http-server -p 8000
```

### 方法 3: 使用 VS Code

如果你使用 VS Code：

1. 安装 "Live Server" 扩展
2. 右键点击 `index.html` 或 `frame.html`
3. 选择 "Open with Live Server"

### 方法 4: 使用 PHP

如果你安装了 PHP：

```bash
php -S localhost:8000
```

## 访问游戏

启动服务器后，可以通过以下方式访问：

- **主游戏页面**: `http://localhost:8000/index.html`
- **Frame包装器**: `http://localhost:8000/frame.html`
- **第三方集成页面**: `http://localhost:8000/ubg235.html`

### BroadcastChannel 双页隔离模式（推荐 Pi 稳定性）

- **页面 A（游戏接收端）**: `http://localhost:8000/index.html?runtimeRole=game`
- **页面 B（摄像头识别端）**: `http://localhost:8000/camera.html?runtimeRole=camera`

说明：

- 两页必须同源（同协议/域名/端口）
- 页面 B 通过 `BroadcastChannel("gesture_bus")` 发送 `shot` 事件
- 页面 B 会额外发送 `aim` 状态（手势点位与抛物线参数）
- 页面 A 在游戏页本地绘制瞄准点/抛物线提示，玩家无需看识别页
- 页面 A 监听 `shot` 事件并注入游戏输入
- 若 `BroadcastChannel` 在设备浏览器不稳定，会自动回退到 `localStorage` 跨页消息通道
- 保留原单页模式：`runtimeRole=hybrid`（默认）

## 项目结构

```
basketball-frvr/
├── index.html          # 主游戏页面
├── frame.html          # iframe包装器
├── v/                  # 游戏资源文件
│   └── 1576154515838/
│       ├── external.js # 游戏核心代码
│       └── i/         # 图片资源
├── js/                 # 第三方脚本
├── patch/              # SDK和补丁文件
└── main.min.js         # GameDistribution SDK
```

## 注意事项

1. **CORS 问题**: 某些第三方脚本可能因为 CORS 策略无法加载，这是正常的
2. **分析脚本**: 项目包含 Google Analytics 等分析脚本，本地运行时可能无法正常工作
3. **广告已移除**: 主入口使用无广告版 PokiSDK 桩（`patch/poki-sdk.js`），不加载任何广告 SDK

## 开发建议

- 使用浏览器开发者工具（F12）查看控制台错误
- 检查 Network 标签页确认资源加载情况
- 游戏核心代码在 `v/1576154515838/external.js` 中

### 手势调试（投篮失效排查）

在 URL 添加 `?debugGesture=1` 启用控制台调试输出，例如：

```
http://localhost:8000/index.html?debugGesture=1
```

控制台会输出：
- `forceRelease`：每次释放 pointer 的原因（longFrame、handLost、resize、idlePeriodic、aimExpired、staleLock、shotComplete 等）
- `shot`：每次投篮的 dispatch 结果（startOk、moveOk、endOk）
- 问题复现时，可查看最后几条日志以定位触发条件

## 无广告模式

项目已配置为本地无广告运行：

- **本地配置**：`v/1576154515838/config/basketball.v3.json` 提供无广告配置（`showInterstitial: false`、`providers: []`）
- **external.js 已打补丁**：配置请求从远程改为本地路径
- **PokiSDK 桩**：`patch/poki-sdk.js` 提供无广告桩实现
- **运行时补丁**：`applyRuntimeNoAdsPatch` 覆盖 `showInterstitial`、`showInterstitialAd` 等

若仍出现广告，可检查：
1. 控制台是否还有 `cdn.frvr.com/config` 或 `bucket.frvr.com/config` 请求
2. 是否出现 `Ads: Loading XS-ads.js`（表示配置未生效）

## 故障排除

如果遇到问题：

1. 确认服务器正在运行
2. 检查浏览器控制台是否有错误
3. 确认所有资源文件都存在
4. 尝试使用不同的端口（如 8080, 3000）

## 树莓派 5 离线自启动（Kiosk）

已提供一键部署脚本：`scripts/deploy-pi-kiosk.sh`

```bash
cd ~/basketball-frvr
sudo bash scripts/deploy-pi-kiosk.sh
```

脚本会自动完成：
- 安装并配置 `nginx`，发布当前项目为本地站点
- 配置桌面自动登录（如系统支持 `raspi-config`）
- 配置 Chromium 全屏自启动
- 默认启用摄像头权限自动放行（手势识别需要）

可选参数示例：

```bash
sudo PROJECT_DIR=/home/pi/basketball-frvr \
     APP_BASE_PATH=/ \
     SITE_ROOT=/var/www/basketball-frvr \
     RUN_OFFLINE_CHECK=1 \
     AUTO_ALLOW_CAMERA=1 \
     INSTALL_UNCLUTTER=1 \
     bash scripts/deploy-pi-kiosk.sh
```

## 本机一键开发启动（Mac/Linux）

已提供脚本：`scripts/dev-start.sh`

```bash
bash scripts/dev-start.sh
```

默认会同时启动：

- 本地静态服务：`http://127.0.0.1:8000`

常用参数示例：
  
```bash
HTTP_PORT=8000 bash scripts/dev-start.sh
```

