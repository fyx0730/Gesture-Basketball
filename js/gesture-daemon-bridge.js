(function () {
    var ua = (navigator.userAgent || "").toLowerCase();
    var isPiLike = ua.indexOf("raspberry") >= 0 || ua.indexOf("aarch64") >= 0 || ua.indexOf("armv7") >= 0 || ua.indexOf("armv8") >= 0;
    if (!window.__USE_EXTERNAL_GESTURE_DAEMON && !isPiLike) return;

    var WS_URL = window.__GESTURE_DAEMON_URL || "ws://127.0.0.1:8765";
    var RECONNECT_MS = 1500;
    var SHOT_COOLDOWN_MS = 1400;

    var state = {
        ws: null,
        connected: false,
        isAiming: false,
        isCooldown: false,
        startNorm: null,
        smoothNorm: { x: 0.5, y: 0.5 },
        gameCanvas: null,
        overlay: null,
        ctx: null,
        status: null
    };

    function clamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }

    function ensureUi() {
        if (!state.overlay) {
            var c = document.createElement("canvas");
            c.id = "gesture-daemon-overlay";
            Object.assign(c.style, {
                position: "fixed",
                top: "0",
                left: "0",
                width: "100%",
                height: "100%",
                zIndex: "9998",
                pointerEvents: "none"
            });
            document.body.appendChild(c);
            state.overlay = c;
            state.ctx = c.getContext("2d");
            function resize() {
                state.overlay.width = window.innerWidth;
                state.overlay.height = window.innerHeight;
            }
            window.addEventListener("resize", resize);
            resize();
        }
        if (!state.status) {
            var s = document.createElement("div");
            Object.assign(s.style, {
                position: "fixed",
                left: "20px",
                top: "20px",
                zIndex: "9999",
                color: "#ffffff",
                font: "bold 14px Arial",
                background: "rgba(0,0,0,0.55)",
                border: "1px solid rgba(0,251,255,0.55)",
                borderRadius: "8px",
                padding: "6px 10px"
            });
            document.body.appendChild(s);
            state.status = s;
        }
    }

    function setStatus(text) {
        ensureUi();
        state.status.textContent = text;
    }

    function getGameCanvas() {
        state.gameCanvas = state.gameCanvas || document.getElementById("gameCanvas");
        return state.gameCanvas;
    }

    function dispatchShot(startX, startY, endX, endY) {
        var target = getGameCanvas();
        if (!target) return;
        var rect = target.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        function fire(phase, x, y) {
            var clientX = clamp(x, rect.left + 1, rect.right - 1);
            var clientY = clamp(y, rect.top + 1, rect.bottom - 1);
            var buttons = phase === "end" ? 0 : 1;
            var pointerType = phase === "start" ? "pointerdown" : (phase === "move" ? "pointermove" : "pointerup");
            var mouseType = phase === "start" ? "mousedown" : (phase === "move" ? "mousemove" : "mouseup");
            var common = { bubbles: true, cancelable: true, view: window };

            if (typeof window.PointerEvent === "function") {
                target.dispatchEvent(new PointerEvent(pointerType, {
                    clientX: clientX,
                    clientY: clientY,
                    button: 0,
                    buttons: buttons,
                    isPrimary: true,
                    pointerId: 1,
                    pointerType: "touch",
                    bubbles: common.bubbles,
                    cancelable: common.cancelable,
                    view: common.view
                }));
            }
            target.dispatchEvent(new MouseEvent(mouseType, {
                clientX: clientX,
                clientY: clientY,
                button: 0,
                buttons: buttons,
                bubbles: common.bubbles,
                cancelable: common.cancelable,
                view: common.view
            }));
        }

        fire("start", startX, startY);
        setTimeout(function () {
            fire("move", endX, endY);
            setTimeout(function () {
                fire("end", endX, endY);
            }, 24);
        }, 24);
    }

    function renderAim() {
        ensureUi();
        if (!state.ctx) return;
        state.ctx.clearRect(0, 0, state.overlay.width, state.overlay.height);
        if (!state.connected) return;

        var x = state.smoothNorm.x * state.overlay.width;
        var y = state.smoothNorm.y * state.overlay.height;
        state.ctx.save();
        state.ctx.shadowBlur = 10;
        state.ctx.shadowColor = "#00fbff";
        state.ctx.fillStyle = "#00fbff";
        state.ctx.beginPath();
        state.ctx.arc(x, y, 10, 0, Math.PI * 2);
        state.ctx.fill();
        state.ctx.restore();
    }

    function onAim(msg) {
        if (typeof msg.x !== "number" || typeof msg.y !== "number") return;
        var nx = clamp(msg.x, 0, 1);
        var ny = clamp(msg.y, 0, 1);
        state.smoothNorm.x += (nx - state.smoothNorm.x) * 0.25;
        state.smoothNorm.y += (ny - state.smoothNorm.y) * 0.25;
        if (!state.isAiming) {
            state.isAiming = true;
            state.startNorm = { x: state.smoothNorm.x, y: state.smoothNorm.y };
        }
        renderAim();
    }

    function onShoot() {
        if (state.isCooldown || !state.isAiming || !state.startNorm) return;
        var w = window.innerWidth || 1280;
        var h = window.innerHeight || 720;

        var ballX = w * 0.5;
        var ballY = h * 0.82;
        var dxNorm = state.smoothNorm.x - state.startNorm.x;
        var dyNorm = state.startNorm.y - state.smoothNorm.y;
        var deltaX = dxNorm * w * 2.9;
        var yForce = Math.max(200, 450 + dyNorm * h * 1.2);

        var releaseX = ballX + deltaX;
        var releaseY = ballY - yForce;
        dispatchShot(ballX, ballY, releaseX, releaseY);

        state.isAiming = false;
        state.startNorm = null;
        state.isCooldown = true;
        setTimeout(function () { state.isCooldown = false; }, SHOT_COOLDOWN_MS);
    }

    function connect() {
        ensureUi();
        setStatus("手势服务连接中...");
        try {
            state.ws = new WebSocket(WS_URL);
        } catch (e) {
            setStatus("手势服务连接失败，重试中");
            setTimeout(connect, RECONNECT_MS);
            return;
        }
        state.ws.onopen = function () {
            state.connected = true;
            setStatus("手势服务已连接");
        };
        state.ws.onclose = function () {
            state.connected = false;
            state.isAiming = false;
            setStatus("手势服务已断开，重连中");
            setTimeout(connect, RECONNECT_MS);
        };
        state.ws.onerror = function () {
            setStatus("手势服务异常，重连中");
        };
        state.ws.onmessage = function (ev) {
            var msg;
            try { msg = JSON.parse(ev.data); } catch (_) { return; }
            if (!msg || !msg.type) return;
            if (msg.type === "aim") onAim(msg);
            if (msg.type === "shoot") onShoot();
            if (msg.type === "idle") {
                state.isAiming = false;
                state.startNorm = null;
            }
        };
    }

    window.addEventListener("load", function () {
        connect();
    });
})();
