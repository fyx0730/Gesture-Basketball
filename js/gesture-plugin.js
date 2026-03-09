/**
 * Basketball FRVR Gesture Plugin - Precision Alignment Edition
 * Optimized: Pixel-perfect physics synchronization
 */

const Config = {
    sensitivityX: 2.1,     
    sensitivityY: 1.6,     
    gravity: 22.5,         // 精准重力补偿
    okThreshold: 0.05,
    fiveThreshold: 0.4,
    smoothing: 0.12,       
    ballStartPos: { x: 0.5, y: 0.82 }, // 修正球心起始点
    hoopPos: { x: 0.5, y: 0.30 },      
    baseYForce: 450,       // 配合高重力的基础推力
    shotCooldown: 1800,
    armDelayMs: 35,        // 保持较快但略去抖
    minAimMovePx: 2,       // 轻微位移即可
    firstShotGuardMs: 160, // 轻度首发保护
    fistFoldThreshold: 0.82,
    thumbFoldThreshold: 0.98,
    palmExtendThreshold: 1.55,
    palmThumbOpenThreshold: 1.35,
    palmStableFrames: 2,
    fistStableFrames: 2,
    adaptiveEnabled: true,
    targetFps: 20,
    modelComplexity: 0,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7,
    debug: true
};

class GesturePlugin {
    constructor() {
        this.videoElement = null;
        this.canvasElement = null;
        this.ctx = null;
        this.hands = null;
        this.camera = null;
        this.isProcessingFrame = false;
        this.lastFrameSentAt = 0;
        
        this.isAiming = false;
        this.isInCooldown = false;
        this.palmStartPoint = null; 
        this.smoothPalmPoint = { x: 0, y: 0 };
        this.smoothPalmNorm = { x: 0.5, y: 0.5 };
        this.fistLatched = false;
        this.aimStartedAt = 0;
        this.hasMovedEnough = false;
        this.fistFrames = 0;
        this.handSeen = false;
        this.palmFrames = 0;
        this.armedByPalm = false;
        this.prevRawPalmPoint = null;
        this.jitterEma = 0;
        this.handFrames = 0;
        this.palmStartNorm = null;
        this.palmScaleRef = 0.09;
        this.fistReleasedSinceAimStart = false;
        this.prevFist = false;
        this.requireFistRelease = false;
        this.dynamic = {
            armDelayMs: Config.armDelayMs,
            minAimMovePx: Config.minAimMovePx,
            palmStableFrames: Config.palmStableFrames,
            fistStableFrames: Config.fistStableFrames,
            fistFoldThreshold: Config.fistFoldThreshold,
            thumbFoldThreshold: Config.thumbFoldThreshold,
            palmExtendThreshold: Config.palmExtendThreshold,
            palmThumbOpenThreshold: Config.palmThumbOpenThreshold
        };
        
        this.gameCanvas = document.getElementById('gameCanvas');
        this.initUI();
        this.loadScripts().then(() => this.initMediaPipe());
    }

    async loadScripts() {
        const scripts = [
            './vendor/mediapipe/hands/hands.js',
            './vendor/mediapipe/camera_utils/camera_utils.js'
        ];
        for (const src of scripts) {
            await new Promise((res) => {
                const s = document.createElement('script');
                s.src = src; s.onload = res;
                document.head.appendChild(s);
            });
        }
    }

    initUI() {
        this.canvasElement = document.createElement('canvas');
        this.canvasElement.id = 'gesture-overlay';
        Object.assign(this.canvasElement.style, {
            position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
            zIndex: '10000', pointerEvents: 'none'
        });
        document.body.appendChild(this.canvasElement);
        this.ctx = this.canvasElement.getContext('2d');

        this.videoElement = document.createElement('video');
        Object.assign(this.videoElement.style, {
            position: 'fixed', bottom: '20px', left: '20px', width: '180px', height: '135px',
            borderRadius: '12px', border: '3px solid #00fbff', zIndex: '10001',
            transform: 'scaleX(-1)', backgroundColor: '#000', boxShadow: '0 0 20px rgba(0,251,255,0.4)',
            pointerEvents: 'none'
        });
        document.body.appendChild(this.videoElement);
        
        const resize = () => {
            this.canvasElement.width = window.innerWidth;
            this.canvasElement.height = window.innerHeight;
        };
        window.addEventListener('resize', resize);
        resize();
    }

    initMediaPipe() {
        this.hands = new window.Hands({ locateFile: (f) => `./vendor/mediapipe/hands/${f}` });
        this.hands.setOptions({
            maxNumHands: 1,
            modelComplexity: Config.modelComplexity,
            minDetectionConfidence: Config.minDetectionConfidence,
            minTrackingConfidence: Config.minTrackingConfidence
        });
        this.hands.onResults((res) => this.processHands(res));
        this.camera = new window.Camera(this.videoElement, {
            onFrame: async () => {
                const now = performance.now();
                const minInterval = 1000 / Math.max(1, Config.targetFps);
                if (this.isProcessingFrame || (now - this.lastFrameSentAt) < minInterval) return;
                this.isProcessingFrame = true;
                this.lastFrameSentAt = now;
                try {
                    await this.hands.send({ image: this.videoElement });
                } catch(e) {
                } finally {
                    this.isProcessingFrame = false;
                }
            },
            width: 640, height: 480
        });
        this.camera.start();
    }

    processHands(results) {
        if (!this.ctx) return;
        this.ctx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);

        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const lms = results.multiHandLandmarks[0];
            this.handFrames += 1;
            const palmNorm = { x: 1 - lms[9].x, y: lms[9].y };
            const rx = palmNorm.x * this.canvasElement.width;
            const ry = palmNorm.y * this.canvasElement.height;
            this.updateAdaptiveThresholds(rx, ry);
            const isPalm = this.isPalmGesture(lms);
            const isFist = !isPalm && this.isFistGesture(lms);
            if (!isFist) {
                this.fistLatched = false;
                this.requireFistRelease = false;
            }
            if (!this.handSeen) {
                // First detected frame: hard-sync to avoid huge baseline offset.
                this.smoothPalmPoint.x = rx;
                this.smoothPalmPoint.y = ry;
                this.smoothPalmNorm = { ...palmNorm };
                this.handSeen = true;
            } else {
                this.smoothPalmPoint.x += (rx - this.smoothPalmPoint.x) * Config.smoothing;
                this.smoothPalmPoint.y += (ry - this.smoothPalmPoint.y) * Config.smoothing;
                this.smoothPalmNorm.x += (palmNorm.x - this.smoothPalmNorm.x) * Config.smoothing;
                this.smoothPalmNorm.y += (palmNorm.y - this.smoothPalmNorm.y) * Config.smoothing;
            }

            if (!this.isInCooldown) {
                this.palmFrames = isPalm ? this.palmFrames + 1 : 0;
                this.fistFrames = isFist ? this.fistFrames + 1 : 0;
                const palmConfirmed = this.palmFrames >= this.dynamic.palmStableFrames;
                const fistConfirmed = this.fistFrames >= this.dynamic.fistStableFrames;

                const fallbackAimReady = this.handFrames >= 3;
                if (!this.isAiming && (palmConfirmed || fallbackAimReady)) {
                    // Prefer palm-confirmed arming; fallback to stable hand detection.
                    this.isAiming = true;
                    this.palmStartPoint = { ...this.smoothPalmPoint };
                    this.palmStartNorm = { ...this.smoothPalmNorm };
                    this.palmScaleRef = Math.max(0.05, this.distance(lms[0], lms[9]));
                    this.aimStartedAt = Date.now();
                    this.hasMovedEnough = false;
                    this.fistFrames = 0;
                    this.armedByPalm = true;
                    this.fistReleasedSinceAimStart = false;
                }
                if (palmConfirmed) {
                    this.armedByPalm = true;
                    this.fistLatched = false;
                }
                if (!isFist) {
                    this.fistReleasedSinceAimStart = true;
                }
                const fistEdge = isFist && !this.prevFist;
                this.prevFist = isFist;

                const aimElapsed = Date.now() - this.aimStartedAt;
                const moveDist = this.palmStartPoint
                    ? this.distance(this.smoothPalmPoint, this.palmStartPoint)
                    : 0;
                if (moveDist >= this.dynamic.minAimMovePx) this.hasMovedEnough = true;

                const canShoot = this.isAiming &&
                    this.armedByPalm &&
                    !this.requireFistRelease &&
                    !this.fistLatched &&
                    fistConfirmed &&
                    !isPalm &&
                    aimElapsed >= this.dynamic.armDelayMs &&
                    aimElapsed >= Config.firstShotGuardMs &&
                    (this.hasMovedEnough || aimElapsed > 420) &&
                    this.fistFrames >= this.dynamic.fistStableFrames;

                if (canShoot) {
                    this.fistLatched = true;
                    this.requireFistRelease = true;
                    this.executeSynchronizedShot();
                }
            }
            this.render(isPalm, isFist);
        } else {
            this.isAiming = false;
            this.palmStartPoint = null;
            this.fistLatched = false;
            this.aimStartedAt = 0;
            this.hasMovedEnough = false;
            this.fistFrames = 0;
            this.handSeen = false;
            this.palmFrames = 0;
            this.armedByPalm = false;
            this.prevRawPalmPoint = null;
            this.jitterEma = 0;
            this.handFrames = 0;
            this.palmStartNorm = null;
            this.palmScaleRef = 0.09;
            this.fistReleasedSinceAimStart = false;
            this.prevFist = false;
            this.requireFistRelease = false;
        }
    }

    distance(a, b) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    clamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }

    updateAdaptiveThresholds(rx, ry) {
        if (!Config.adaptiveEnabled) return;
        if (this.prevRawPalmPoint) {
            const frameJitter = this.distance({ x: rx, y: ry }, this.prevRawPalmPoint);
            this.jitterEma = this.jitterEma * 0.85 + frameJitter * 0.15;
        }
        this.prevRawPalmPoint = { x: rx, y: ry };

        const j = this.jitterEma;
        this.dynamic.minAimMovePx = this.clamp(1.5 + j * 0.14, 1.5, 7);
        this.dynamic.armDelayMs = this.clamp(16 + j * 1.8, 16, 95);
        this.dynamic.palmStableFrames = j > 18 ? 3 : 2;
        this.dynamic.fistStableFrames = j > 14 ? 3 : 2;

        // Jitter-aware thresholds: noisy camera -> slightly tolerant fist, slightly stricter palm.
        this.dynamic.fistFoldThreshold = this.clamp(Config.fistFoldThreshold + j * 0.0013, 0.80, 0.90);
        this.dynamic.thumbFoldThreshold = this.clamp(Config.thumbFoldThreshold + j * 0.0013, 0.94, 1.05);
        this.dynamic.palmExtendThreshold = this.clamp(Config.palmExtendThreshold + j * 0.002, 1.45, 1.66);
        this.dynamic.palmThumbOpenThreshold = this.clamp(Config.palmThumbOpenThreshold - j * 0.0015, 1.12, 1.32);
    }

    isFistGesture(lms) {
        // Normalize by palm size to stay robust across camera distance.
        const palmSize = Math.max(0.0001, this.distance(lms[0], lms[9]));
        const tipToMcp = [
            this.distance(lms[8], lms[5]),   // index
            this.distance(lms[12], lms[9]),  // middle
            this.distance(lms[16], lms[13]), // ring
            this.distance(lms[20], lms[17])  // pinky
        ];
        const foldedCount = tipToMcp.filter(d => d / palmSize < this.dynamic.fistFoldThreshold).length;
        const thumbFolded = this.distance(lms[4], lms[2]) / palmSize < this.dynamic.thumbFoldThreshold;
        return foldedCount >= 3 && thumbFolded;
    }

    isPalmGesture(lms) {
        const palmSize = Math.max(0.0001, this.distance(lms[0], lms[9]));
        const extended = [
            this.distance(lms[8], lms[0]),   // index tip to wrist
            this.distance(lms[12], lms[0]),  // middle
            this.distance(lms[16], lms[0]),  // ring
            this.distance(lms[20], lms[0])   // pinky
        ];
        const extendedCount = extended.filter(d => d / palmSize > this.dynamic.palmExtendThreshold).length;
        const thumbOpen = this.distance(lms[4], lms[5]) / palmSize > this.dynamic.palmThumbOpenThreshold;
        return extendedCount >= 3 && thumbOpen;
    }

    executeSynchronizedShot() {
        this.isAiming = false;
        this.isInCooldown = true;
        const shot = this.computeShotVector();
        const deltaX = shot.deltaX;
        const currentYForce = shot.currentYForce;

        const ballX = this.canvasElement.width * Config.ballStartPos.x;
        const ballY = this.canvasElement.height * Config.ballStartPos.y;
        const releaseX = ballX + deltaX;
        const releaseY = ballY - currentYForce; 

        // 模拟更长的滑动时间以确保引擎采样稳定
        this.simulateAll('start', ballX, ballY);
        setTimeout(() => {
            this.simulateAll('move', releaseX, releaseY);
            setTimeout(() => {
                this.simulateAll('end', releaseX, releaseY);
                if (Config.debug) console.log(`🏀 Shot Final Path Sync! Force: ${currentYForce.toFixed(0)}`);
                this.palmStartPoint = null;
                this.aimStartedAt = 0;
                this.hasMovedEnough = false;
                this.fistFrames = 0;
                this.handSeen = false;
                this.palmFrames = 0;
                this.armedByPalm = false;
                this.fistLatched = false;
                this.prevRawPalmPoint = null;
                this.jitterEma = 0;
                this.handFrames = 0;
                this.palmStartNorm = null;
                this.palmScaleRef = 0.09;
                this.fistReleasedSinceAimStart = false;
                this.prevFist = false;
                // Keep requireFistRelease until user actually opens hand.
                setTimeout(() => { this.isInCooldown = false; }, Config.shotCooldown);
            }, 25); 
        }, 25);
    }

    computeShotVector() {
        // Use normalized coordinates + palm-size compensation to reduce camera-distance effect.
        if (this.palmStartNorm) {
            const scaleComp = this.clamp(0.09 / Math.max(0.05, this.palmScaleRef), 0.65, 1.45);
            const dxNorm = (this.smoothPalmNorm.x - this.palmStartNorm.x) * scaleComp;
            const dyNorm = (this.palmStartNorm.y - this.smoothPalmNorm.y) * scaleComp;
            const deltaX = dxNorm * this.canvasElement.width * Config.sensitivityX * 1.4;
            const dy = dyNorm * this.canvasElement.height * Config.sensitivityY * 0.75;
            return {
                deltaX,
                currentYForce: Math.max(200, Config.baseYForce + dy)
            };
        }
        const deltaX = (this.smoothPalmPoint.x - this.palmStartPoint.x) * Config.sensitivityX;
        const dy = (this.palmStartPoint.y - this.smoothPalmPoint.y) * Config.sensitivityY;
        return {
            deltaX,
            currentYForce: Math.max(200, Config.baseYForce + dy)
        };
    }

    getGameCanvas() {
        this.gameCanvas = this.gameCanvas || document.getElementById('gameCanvas');
        return this.gameCanvas;
    }

    simulateAll(phase, x, y) {
        const target = this.getGameCanvas();
        if (!target) return;

        const rect = target.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        const clientX = Math.min(rect.right - 1, Math.max(rect.left + 1, x));
        const clientY = Math.min(rect.bottom - 1, Math.max(rect.top + 1, y));
        const buttons = phase === 'end' ? 0 : 1;
        const pointerType = phase === 'start' ? 'pointerdown' : (phase === 'move' ? 'pointermove' : 'pointerup');
        const mouseType = phase === 'start' ? 'mousedown' : (phase === 'move' ? 'mousemove' : 'mouseup');
        const touchType = phase === 'start' ? 'touchstart' : (phase === 'move' ? 'touchmove' : 'touchend');
        const commonBubbles = { bubbles: true, cancelable: true, view: window };

        if (typeof window.PointerEvent === 'function') {
            target.dispatchEvent(new PointerEvent(pointerType, {
                clientX,
                clientY,
                ...commonBubbles,
                button: 0,
                buttons,
                isPrimary: true,
                pointerId: 1,
                pointerType: 'touch'
            }));
        }

        target.dispatchEvent(new MouseEvent(mouseType, {
            clientX,
            clientY,
            ...commonBubbles,
            button: 0,
            buttons
        }));

        // Keep legacy touch path for old game input handlers.
        try {
            if (typeof window.Touch === 'function' && typeof window.TouchEvent === 'function') {
                const touchPoint = new Touch({
                    identifier: 1,
                    target,
                    clientX,
                    clientY,
                    pageX: clientX,
                    pageY: clientY,
                    screenX: clientX,
                    screenY: clientY
                });
                target.dispatchEvent(new TouchEvent(touchType, {
                    ...commonBubbles,
                    touches: phase === 'end' ? [] : [touchPoint],
                    targetTouches: phase === 'end' ? [] : [touchPoint],
                    changedTouches: [touchPoint]
                }));
            }
        } catch(e) {}
    }

    render(isPalm, isFist) {
        const color = this.isInCooldown ? 'rgba(255,255,255,0.3)' : (isFist ? '#ffcc00' : (isPalm ? '#00fbff' : '#ffffff'));
        this.drawGlowPoint(this.smoothPalmPoint.x, this.smoothPalmPoint.y, 10, color);
        
        if (this.isAiming && this.palmStartPoint && !this.isInCooldown) {
            const bx = this.canvasElement.width * Config.ballStartPos.x;
            const by = this.canvasElement.height * Config.ballStartPos.y;
            const shot = this.computeShotVector();
            const dx = shot.deltaX;
            const currentYForce = shot.currentYForce;
            
            this.ctx.fillStyle = '#00fbff';
            this.ctx.font = 'bold 20px Arial';
            this.ctx.fillText(isFist ? '✊ 触发投篮' : (isPalm ? '🖐 手掌瞄准' : '✋ 调整手势'), this.smoothPalmPoint.x + 25, this.smoothPalmPoint.y + 10);
            this.drawVectorParabola(bx, by, dx, currentYForce);
        }
    }

    drawGlowPoint(x, y, r, color) {
        this.ctx.save();
        this.ctx.shadowBlur = 10; this.ctx.shadowColor = color;
        this.ctx.fillStyle = color;
        this.ctx.beginPath(); this.ctx.arc(x, y, r, 0, Math.PI * 2); this.ctx.fill();
        this.ctx.restore();
    }

    drawVectorParabola(startX, startY, vx, vy) {
        // 核心同步系数：通过映射关系锁定真实落点
        const k = 0.039; 
        const v0x = vx * k;
        const v0y = vy * k;
        const hoopY = this.canvasElement.height * Config.hoopPos.y;
        const hoopX = this.canvasElement.width * Config.hoopPos.x;

        this.ctx.beginPath();
        this.ctx.setLineDash([5, 5]);
        this.ctx.lineWidth = 3;
        
        let foundHoop = false;
        // 使用更小的时间步长以提高预测精度
        for (let i = 0; i < 200; i++) {
            const t = i * 0.04; 
            const px = startX + v0x * t * 60;
            const py = startY - (v0y * t - 0.5 * Config.gravity * t * t) * 60;
            
            if (i === 0) this.ctx.moveTo(px, py); else this.ctx.lineTo(px, py);
            
            if (!foundHoop && v0y - Config.gravity * t < 0 && py >= hoopY) {
                // 缩小进球判定范围，提高必进提示的含金量
                this.ctx.strokeStyle = Math.abs(px - hoopX) < 40 ? '#00ff88' : '#ffcc00';
                this.ctx.stroke();
                foundHoop = true;
            }
            if (py > this.canvasElement.height + 100) break;
        }
        if (!foundHoop) {
            this.ctx.strokeStyle = '#ffcc00';
            this.ctx.stroke();
        }
        this.ctx.setLineDash([]);
    }
}

window.addEventListener('load', () => {
    if (window.gesturePlugin) return;
    window.gesturePlugin = new GesturePlugin();
});
