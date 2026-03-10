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
3. **第三方 SDK**: Poki SDK 等第三方服务需要网络连接和有效的 API 密钥

## 开发建议

- 使用浏览器开发者工具（F12）查看控制台错误
- 检查 Network 标签页确认资源加载情况
- 游戏核心代码在 `v/1576154515838/external.js` 中

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

