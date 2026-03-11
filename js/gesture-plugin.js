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
    startDelayMs: 2200,
    cameraWidth: 480,
    cameraHeight: 360,
    lowPowerCameraWidth: 320,
    lowPowerCameraHeight: 240,
    ultraLiteCameraWidth: 256,
    ultraLiteCameraHeight: 192,
    autoRecoverMs: 2000,
    releaseLockTimeoutMs: 2600,
    channelName: 'gesture_bus',
    busStorageKey: '__gesture_bus_message__',
    aimPostIntervalMs: 33,
    remoteAimTtlMs: 240,
    maxWebGlRecoveries: 1,
    ultraLiteTargetFps: 8,
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
        this.isMediaPipeReady = false;
        this.recoverTimer = null;
        this.webglRecoveries = 0;
        this.statusLabel = null;
        this.lowPower = false;
        this.isUltraLiteMode = false;
        this.currentFps = Config.targetFps;
        this.manualLoopTimer = null;
        this.mediaStream = null;
        
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
        this.requireOpenAfterShot = false;
        this.openAfterShotFrames = 0;
        this.pendingFistEdge = false;
        this.lastShotAt = 0;
        this.lastShotToken = 0;
        this.lastResultAt = 0;
        this.wasInterrupted = false;
        this.interruptedAt = 0;
        this.runtimeDebugEnabled = this.isRuntimeDebugEnabled();
        this.lastDispatchDiag = null;
        this.runtimeRole = this.resolveRuntimeRole();
        this.shotSeq = 0;
        this.lastReceivedShotSeq = 0;
        this.aimSeq = 0;
        this.lastReceivedAimSeq = 0;
        this.bc = null;
        this.busStorageKey = Config.busStorageKey;
        this.storageBusEnabled = false;
        this.storageBusHandler = null;
        this.busReady = false;
        this.lastAimPostAt = 0;
        this.remoteAimState = null;
        this.remoteAimUpdatedAt = 0;
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
        this.initBroadcastChannel();
        if (this.runtimeRole === 'game') {
            this.setupGameBusReceiver();
            this.startRemoteAimRenderLoop();
            if (this.statusLabel) {
                this.statusLabel.textContent = '游戏接收模式已启动';
                this.statusLabel.style.display = this.runtimeDebugEnabled ? 'block' : 'none';
            }
            this.emitRuntimeStatus({ mode: 'ready_game' });
            return;
        }
        // On low-end devices (e.g. Raspberry Pi), delaying camera/MediaPipe startup
        // avoids stealing GPU resources during the game's critical first render.
        setTimeout(() => {
            this.loadScripts().then(() => this.initMediaPipe());
        }, Config.startDelayMs);
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

    isRuntimeDebugEnabled() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            return params.get('showRuntime') === '1';
        } catch (_) {
            return false;
        }
    }

    resolveRuntimeRole() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            const role = (params.get('runtimeRole') || params.get('role') || 'hybrid').toLowerCase();
            if (role === 'game' || role === 'camera' || role === 'hybrid') return role;
        } catch (_) {}
        return 'hybrid';
    }

    initBroadcastChannel() {
        this.bc = null;
        this.storageBusEnabled = false;
        this.busReady = false;
        if (typeof window.BroadcastChannel === 'function') {
            try {
                this.bc = new BroadcastChannel(Config.channelName);
            } catch (_) {
                this.bc = null;
            }
        }
        try {
            if (typeof window.localStorage !== 'undefined' && window.addEventListener) {
                this.storageBusEnabled = true;
            }
        } catch (_) {
            this.storageBusEnabled = false;
        }
        this.busReady = !!this.bc || this.storageBusEnabled;
    }

    setupGameBusReceiver() {
        const handler = (data) => {
            if (!data || !data.type || !data.payload) return;
            if (data.type === 'shot') {
                const seq = Number(data.payload.seq || 0);
                if (seq && seq <= this.lastReceivedShotSeq) return;
                if (seq) this.lastReceivedShotSeq = seq;
                this.playRemoteShot(data.payload);
                return;
            }
            if (data.type === 'aim') {
                const seq = Number(data.payload.seq || 0);
                if (seq && seq <= this.lastReceivedAimSeq) return;
                if (seq) this.lastReceivedAimSeq = seq;
                this.remoteAimState = data.payload;
                this.remoteAimUpdatedAt = Date.now();
            }
        };
        if (this.bc) {
            this.bc.onmessage = (event) => {
                handler(event && event.data);
            };
        }
        if (!this.storageBusEnabled) return;
        this.storageBusHandler = (event) => {
            if (!event || event.key !== this.busStorageKey || !event.newValue) return;
            try {
                const parsed = JSON.parse(event.newValue);
                handler(parsed && parsed.message);
            } catch (_) {}
        };
        window.addEventListener('storage', this.storageBusHandler);
    }

    sendBusMessage(message) {
        let sent = false;
        if (this.bc) {
            try {
                this.bc.postMessage(message);
                sent = true;
            } catch (_) {}
        }
        if (this.storageBusEnabled) {
            try {
                const packet = JSON.stringify({
                    nonce: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
                    message
                });
                window.localStorage.setItem(this.busStorageKey, packet);
                sent = true;
            } catch (_) {}
        }
        return sent;
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

        if (this.runtimeRole !== 'game') {
            this.videoElement = document.createElement('video');
            Object.assign(this.videoElement.style, {
                position: 'fixed', bottom: '20px', left: '20px', width: '180px', height: '135px',
                borderRadius: '12px', border: '3px solid #00fbff', zIndex: '10001',
                transform: 'scaleX(-1)', backgroundColor: '#000', boxShadow: '0 0 20px rgba(0,251,255,0.4)',
                pointerEvents: 'none'
            });
            document.body.appendChild(this.videoElement);
        }

        this.statusLabel = document.createElement('div');
        Object.assign(this.statusLabel.style, {
            position: 'fixed',
            left: '20px',
            bottom: '165px',
            zIndex: '10002',
            color: '#ffffff',
            font: 'bold 14px Arial',
            background: 'rgba(0,0,0,0.55)',
            border: '1px solid rgba(0,251,255,0.55)',
            borderRadius: '8px',
            padding: '6px 10px',
            display: 'none'
        });
        document.body.appendChild(this.statusLabel);
        
        const resize = () => {
            if (!this.canvasElement) return;
            this.canvasElement.width = window.innerWidth;
            this.canvasElement.height = window.innerHeight;
        };
        window.addEventListener('resize', resize);
        resize();
    }

    initMediaPipe() {
        this.hands = new window.Hands({ locateFile: (f) => `./vendor/mediapipe/hands/${f}` });
        this.lowPower = !!window.__FORCE_GAME_2D || /linux arm|aarch64|raspberry|cros/i.test(navigator.userAgent || "");
        this.hands.setOptions({
            maxNumHands: 1,
            modelComplexity: Config.modelComplexity,
            minDetectionConfidence: Config.minDetectionConfidence,
            minTrackingConfidence: Config.minTrackingConfidence,
            useCpuInference: this.lowPower
        });
        this.hands.onResults((res) => this.processHands(res));
        this.isMediaPipeReady = true;
        if (this.lowPower) {
            this.startManualLowPowerLoop(Config.lowPowerCameraWidth, Config.lowPowerCameraHeight);
        } else {
            this.camera = new window.Camera(this.videoElement, {
                onFrame: async () => {
                    const now = performance.now();
                    const minInterval = 1000 / Math.max(1, this.currentFps);
                    if (!this.isMediaPipeReady || this.isProcessingFrame || (now - this.lastFrameSentAt) < minInterval) return;
                    this.isProcessingFrame = true;
                    this.lastFrameSentAt = now;
                    try {
                        await this.hands.send({ image: this.videoElement });
                    } catch(e) {
                    } finally {
                        this.isProcessingFrame = false;
                    }
                },
                width: Config.cameraWidth, height: Config.cameraHeight
            });
            this.camera.start();
        }
        this.attachWebGlRecoveryHooks();
        this.emitRuntimeStatus();
    }

    async startManualLowPowerLoop(width, height) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: width },
                    height: { ideal: height },
                    facingMode: 'user',
                    frameRate: { ideal: this.currentFps, max: this.currentFps }
                },
                audio: false
            });
            this.mediaStream = stream;
            this.videoElement.srcObject = stream;
            await this.videoElement.play();
            this.runManualFrameLoop();
        } catch (e) {
            if (this.statusLabel) {
                this.statusLabel.textContent = '无法启动摄像头，请检查权限';
                this.statusLabel.style.display = 'block';
            }
        }
    }

    runManualFrameLoop() {
        if (this.manualLoopTimer) clearTimeout(this.manualLoopTimer);
        const tick = async () => {
            const now = performance.now();
            const minInterval = 1000 / Math.max(1, this.currentFps);
            if (this.isMediaPipeReady && !this.isProcessingFrame && (now - this.lastFrameSentAt) >= minInterval) {
                this.isProcessingFrame = true;
                this.lastFrameSentAt = now;
                try {
                    await this.hands.send({ image: this.videoElement });
                } catch (e) {
                } finally {
                    this.isProcessingFrame = false;
                }
            }
            this.manualLoopTimer = setTimeout(tick, minInterval);
        };
        tick();
    }

    attachWebGlRecoveryHooks() {
        const canvas = this.getGameCanvas();
        if (!canvas) return;
        canvas.addEventListener('webglcontextlost', (e) => {
            try { e.preventDefault(); } catch(_) {}
            this.webglRecoveries += 1;
            if (this.webglRecoveries > Config.maxWebGlRecoveries) {
                this.enableUltraLiteMode();
                return;
            }
            this.temporarilyPauseMediaPipe();
        }, { passive: false });
        canvas.addEventListener('webglcontextrestored', () => {
            this.resumeMediaPipe();
        });
    }

    temporarilyPauseMediaPipe() {
        this.isMediaPipeReady = false;
        this.isProcessingFrame = false;
        this.wasInterrupted = true;
        this.interruptedAt = Date.now();
        if (this.recoverTimer) clearTimeout(this.recoverTimer);
        this.recoverTimer = setTimeout(() => this.resumeMediaPipe(), Config.autoRecoverMs);
    }

    resumeMediaPipe() {
        this.isMediaPipeReady = true;
        this.recoverTimer = null;
        this.hardResetGestureState();
        this.wasInterrupted = false;
    }

    async enableUltraLiteMode() {
        if (this.isUltraLiteMode) return;
        this.isUltraLiteMode = true;
        this.currentFps = Config.ultraLiteTargetFps;
        this.webglRecoveries = 0;
        this.temporarilyPauseMediaPipe();
        if (this.statusLabel) {
            this.statusLabel.textContent = '已切换到手势超轻量模式';
            this.statusLabel.style.display = 'block';
        }
        if (!this.lowPower) return;
        try {
            if (this.mediaStream) {
                const tracks = this.mediaStream.getVideoTracks();
                if (tracks && tracks[0] && tracks[0].applyConstraints) {
                    await tracks[0].applyConstraints({
                        width: { ideal: Config.ultraLiteCameraWidth },
                        height: { ideal: Config.ultraLiteCameraHeight },
                        frameRate: { ideal: Config.ultraLiteTargetFps, max: Config.ultraLiteTargetFps }
                    });
                }
            }
        } catch (_) {}
        setTimeout(() => this.resumeMediaPipe(), Config.autoRecoverMs);
    }

    processHands(results) {
        if (!this.ctx) return;
        this.ctx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
        const nowTs = Date.now();
        this.clearStaleShotLocks(nowTs);
        if (this.lastResultAt > 0 && (nowTs - this.lastResultAt) > 900) {
            // Recover from long frame gap (renderer hitch / context hiccup).
            this.hardResetGestureState();
        }
        this.lastResultAt = nowTs;

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
                    if (this.requireOpenAfterShot) {
                        this.openAfterShotFrames += 1;
                        if (this.openAfterShotFrames >= 2) {
                            this.requireOpenAfterShot = false;
                        }
                    }
                } else {
                    this.openAfterShotFrames = 0;
                }
                const fistEdge = isFist && !this.prevFist;
                this.prevFist = isFist;
                if (fistEdge) {
                    this.pendingFistEdge = true;
                }
                if (!isFist) {
                    this.pendingFistEdge = false;
                }

                // Safety unlock: avoid being stuck in require-release state after long play.
                if (this.requireFistRelease && !isFist && (Date.now() - this.lastShotAt) > 1200) {
                    this.requireFistRelease = false;
                }
                if (this.requireFistRelease && (Date.now() - this.lastShotAt) > Config.releaseLockTimeoutMs) {
                    this.requireFistRelease = false;
                    this.fistLatched = false;
                }

                const aimElapsed = Date.now() - this.aimStartedAt;
                const moveDist = this.palmStartPoint
                    ? this.distance(this.smoothPalmPoint, this.palmStartPoint)
                    : 0;
                if (moveDist >= this.dynamic.minAimMovePx) this.hasMovedEnough = true;

                const canShoot = this.isAiming &&
                    this.armedByPalm &&
                    !this.requireOpenAfterShot &&
                    !this.requireFistRelease &&
                    !this.fistLatched &&
                    this.pendingFistEdge &&
                    fistConfirmed &&
                    !isPalm &&
                    aimElapsed >= this.dynamic.armDelayMs &&
                    aimElapsed >= Config.firstShotGuardMs &&
                    (this.hasMovedEnough || aimElapsed > 420) &&
                    this.fistFrames >= this.dynamic.fistStableFrames;

                if (canShoot) {
                    this.fistLatched = true;
                    this.requireFistRelease = true;
                    this.requireOpenAfterShot = true;
                    this.openAfterShotFrames = 0;
                    this.pendingFistEdge = false;
                    this.lastShotAt = Date.now();
                    this.executeSynchronizedShot();
                }
            }
            if (this.runtimeRole === 'camera') {
                const shot = this.isAiming ? this.computeShotVector() : null;
                this.postAimToBus({
                    hasHand: true,
                    isPalm,
                    isFist,
                    isAiming: this.isAiming,
                    isInCooldown: this.isInCooldown,
                    palmNorm: this.smoothPalmNorm,
                    shot
                });
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
            this.requireOpenAfterShot = false;
            this.openAfterShotFrames = 0;
            this.pendingFistEdge = false;
            this.wasInterrupted = false;
            if (this.runtimeRole === 'camera') {
                this.postAimToBus({
                    hasHand: false,
                    isPalm: false,
                    isFist: false,
                    isAiming: false,
                    isInCooldown: this.isInCooldown
                }, true);
            }
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
        this.lastShotToken = Date.now();
        const shot = this.computeShotVector();
        const deltaX = shot.deltaX;
        const currentYForce = shot.currentYForce;

        const ballX = this.canvasElement.width * Config.ballStartPos.x;
        const ballY = this.canvasElement.height * Config.ballStartPos.y;
        const releaseX = ballX + deltaX;
        const releaseY = ballY - currentYForce; 

        if (this.runtimeRole === 'camera') {
            const posted = this.postShotToBus(ballX, ballY, releaseX, releaseY);
            this.emitRuntimeStatus({ shotDispatch: posted ? 'bus_posted' : 'bus_failed' });
            this.finalizeShotStateAfterDispatch();
            return;
        }

        // Preflight release sweep clears any stuck "pointer down" state
        // in the game input pipeline after render hitches/context hiccups.
        this.simulateReleaseSweep(ballX, ballY);

        // 模拟更长的滑动时间以确保引擎采样稳定
        const startOk = this.simulateAll('start', ballX, ballY);
        if (!startOk) {
            this.emitRuntimeStatus({ shotDispatch: 'start_failed' });
            this.hardResetGestureState();
            return;
        }
        setTimeout(() => {
            const moveOk = this.simulateAll('move', releaseX, releaseY);
            setTimeout(() => {
                const endOk = this.simulateAll('end', releaseX, releaseY);
                // Extra release pass to avoid "stuck down" in Pixi input manager.
                this.forceReleaseGameInput(releaseX, releaseY);
                this.emitRuntimeStatus({
                    shotDispatch: (startOk && moveOk && endOk) ? 'ok' : 'partial_fail',
                    dispatchStartOk: !!startOk,
                    dispatchMoveOk: !!moveOk,
                    dispatchEndOk: !!endOk
                });
                if (Config.debug) console.log(`🏀 Shot Final Path Sync! Force: ${currentYForce.toFixed(0)}`);
                this.finalizeShotStateAfterDispatch();
            }, 25); 
        }, 25);
    }

    finalizeShotStateAfterDispatch() {
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
        const token = this.lastShotToken;
        setTimeout(() => {
            if (this.lastShotToken !== token) return;
            this.isInCooldown = false;
        }, Config.shotCooldown);
        setTimeout(() => {
            if (this.lastShotToken !== token) return;
            this.requireFistRelease = false;
            this.fistLatched = false;
        }, Config.releaseLockTimeoutMs);
    }

    postShotToBus(startX, startY, endX, endY) {
        if (!this.bc || !this.canvasElement || !this.canvasElement.width || !this.canvasElement.height) {
            return false;
        }
        this.shotSeq += 1;
        const w = this.canvasElement.width;
        const h = this.canvasElement.height;
        const payload = {
            seq: this.shotSeq,
            t: Date.now(),
            start: {
                x: this.clamp(startX / w, 0, 1),
                y: this.clamp(startY / h, 0, 1)
            },
            end: {
                x: this.clamp(endX / w, 0, 1),
                y: this.clamp(endY / h, 0, 1)
            }
        };
        try {
            return this.sendBusMessage({ type: 'shot', payload });
        } catch (_) { return false; }
    }

    postAimToBus(state, force) {
        if (this.runtimeRole !== 'camera' || !this.bc || !this.canvasElement) return;
        const now = performance.now();
        if (!force && (now - this.lastAimPostAt) < Config.aimPostIntervalMs) return;
        this.lastAimPostAt = now;
        this.aimSeq += 1;
        const payload = {
            seq: this.aimSeq,
            t: Date.now(),
            hasHand: !!state.hasHand,
            isPalm: !!state.isPalm,
            isFist: !!state.isFist,
            isAiming: !!state.isAiming,
            isInCooldown: !!state.isInCooldown,
            palm: {
                x: this.normalizeRatio(state.palmNorm && state.palmNorm.x, 0.5),
                y: this.normalizeRatio(state.palmNorm && state.palmNorm.y, 0.5)
            },
            shot: state.shot ? {
                deltaX: Number(state.shot.deltaX) || 0,
                currentYForce: Number(state.shot.currentYForce) || Config.baseYForce
            } : null
        };
        try {
            this.sendBusMessage({ type: 'aim', payload });
        } catch (_) {}
    }

    playRemoteShot(payload) {
        const target = this.getGameCanvas();
        if (!target) return;
        const rect = target.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const sxN = this.normalizeRatio(payload.start && payload.start.x, Config.ballStartPos.x);
        const syN = this.normalizeRatio(payload.start && payload.start.y, Config.ballStartPos.y);
        const exN = this.normalizeRatio(payload.end && payload.end.x, Config.ballStartPos.x);
        const eyN = this.normalizeRatio(payload.end && payload.end.y, Config.ballStartPos.y);
        const sx = rect.left + sxN * rect.width;
        const sy = rect.top + syN * rect.height;
        const ex = rect.left + exN * rect.width;
        const ey = rect.top + eyN * rect.height;
        this.simulateReleaseSweep(sx, sy);
        const startOk = this.simulateAll('start', sx, sy);
        if (!startOk) return;
        setTimeout(() => {
            this.simulateAll('move', ex, ey);
            setTimeout(() => {
                this.simulateAll('end', ex, ey);
                this.forceReleaseGameInput(ex, ey);
            }, 25);
        }, 25);
    }

    startRemoteAimRenderLoop() {
        if (this.runtimeRole !== 'game' || !this.ctx || !this.canvasElement) return;
        const loop = () => {
            this.renderRemoteAimState();
            window.requestAnimationFrame(loop);
        };
        window.requestAnimationFrame(loop);
    }

    renderRemoteAimState() {
        if (!this.ctx || !this.canvasElement) return;
        this.ctx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
        if (!this.remoteAimState) return;
        if ((Date.now() - this.remoteAimUpdatedAt) > Config.remoteAimTtlMs) {
            return;
        }
        const r = this.remoteAimState;
        if (!r.hasHand) return;
        const palmPoint = {
            x: this.normalizeRatio(r.palm && r.palm.x, 0.5) * this.canvasElement.width,
            y: this.normalizeRatio(r.palm && r.palm.y, 0.5) * this.canvasElement.height
        };
        const shot = r.shot || { deltaX: 0, currentYForce: Config.baseYForce };
        this.drawAimOverlay({
            palmPoint,
            isPalm: !!r.isPalm,
            isFist: !!r.isFist,
            isInCooldown: !!r.isInCooldown,
            isAiming: !!r.isAiming,
            shot
        });
    }

    normalizeRatio(value, fallback) {
        const v = Number(value);
        const f = Number(fallback);
        if (!isFinite(v)) return this.clamp(isFinite(f) ? f : 0.5, 0, 1);
        return this.clamp(v, 0, 1);
    }

    hardResetGestureState() {
        this.isAiming = false;
        this.isInCooldown = false;
        this.palmStartPoint = null;
        this.palmStartNorm = null;
        this.hasMovedEnough = false;
        this.fistLatched = false;
        this.requireFistRelease = false;
        this.fistFrames = 0;
        this.palmFrames = 0;
        this.prevFist = false;
        this.fistReleasedSinceAimStart = false;
        this.armedByPalm = false;
        this.handFrames = 0;
        this.pendingFistEdge = false;
        // Keep requireOpenAfterShot to enforce release-before-next-shot rule.
        this.openAfterShotFrames = 0;
        this.emitRuntimeStatus({ shotDispatch: 'state_reset' });
    }

    clearStaleShotLocks(nowTs) {
        if (!this.lastShotAt) return;
        const elapsed = nowTs - this.lastShotAt;
        let changed = false;

        // Hard unlock even when hand remains fist, to avoid permanent deadlock.
        if (this.isInCooldown && elapsed > (Config.shotCooldown + 800)) {
            this.isInCooldown = false;
            changed = true;
        }
        if ((this.requireFistRelease || this.fistLatched) && elapsed > (Config.releaseLockTimeoutMs + 800)) {
            this.forceReleaseGameInput();
            this.requireFistRelease = false;
            this.fistLatched = false;
            changed = true;
        }

        if (changed) {
            if (this.statusLabel) {
                this.statusLabel.textContent = '已自动恢复手势投篮';
                this.statusLabel.style.display = 'block';
                setTimeout(() => {
                    if (this.statusLabel) this.statusLabel.style.display = 'none';
                }, 900);
            }
            this.emitRuntimeStatus({ shotDispatch: 'force_unlock', lockElapsedMs: elapsed });
        }
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
        const cached = this.gameCanvas;
        if (!cached || !cached.isConnected || cached.id !== 'gameCanvas') {
            this.gameCanvas = document.getElementById('gameCanvas');
        } else if (!document.body.contains(cached)) {
            this.gameCanvas = document.getElementById('gameCanvas');
        }
        return this.gameCanvas;
    }

    simulateAll(phase, x, y) {
        let target = this.getGameCanvas();
        if (!target) return false;

        let rect = target.getBoundingClientRect();
        if (!rect.width || !rect.height) {
            // Context recovery can recreate canvas; retry a fresh lookup once.
            this.gameCanvas = null;
            target = this.getGameCanvas();
            if (!target) return false;
            rect = target.getBoundingClientRect();
            if (!rect.width || !rect.height) return false;
        }
        const diag = {
            phase,
            targetConnected: !!(target && target.isConnected),
            rectValid: !!(rect.width && rect.height),
            pointerDispatches: 0,
            mouseDispatches: 0,
            touchDispatches: 0
        };

        const clientX = Math.min(rect.right - 1, Math.max(rect.left + 1, x));
        const clientY = Math.min(rect.bottom - 1, Math.max(rect.top + 1, y));
        const buttons = phase === 'end' ? 0 : 1;
        const pointerType = phase === 'start' ? 'pointerdown' : (phase === 'move' ? 'pointermove' : 'pointerup');
        const mouseType = phase === 'start' ? 'mousedown' : (phase === 'move' ? 'mousemove' : 'mouseup');
        const touchType = phase === 'start' ? 'touchstart' : (phase === 'move' ? 'touchmove' : 'touchend');
        const commonBubbles = { bubbles: true, cancelable: true, view: window };

        const recipients = this.getDispatchRecipients(target);
        if (typeof window.PointerEvent === 'function') {
            diag.pointerDispatches = this.dispatchToRecipients(recipients, () => new PointerEvent(pointerType, {
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

        diag.mouseDispatches = this.dispatchToRecipients(recipients, () => new MouseEvent(mouseType, {
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
                diag.touchDispatches = this.dispatchToRecipients(recipients, () => new TouchEvent(touchType, {
                    ...commonBubbles,
                    touches: phase === 'end' ? [] : [touchPoint],
                    targetTouches: phase === 'end' ? [] : [touchPoint],
                    changedTouches: [touchPoint]
                }));
            }
        } catch(e) {}
        this.lastDispatchDiag = diag;
        const success = (diag.pointerDispatches + diag.mouseDispatches + diag.touchDispatches) > 0;
        if (!success) {
            this.emitRuntimeStatus({ shotDispatch: 'dispatch_failed', phase });
        }
        return success;
    }

    getDispatchRecipients(target) {
        const recipients = [target];
        if (document && document !== target) recipients.push(document);
        if (window && window !== target) recipients.push(window);
        return recipients;
    }

    dispatchToRecipients(recipients, createEvent) {
        let sent = 0;
        for (let i = 0; i < recipients.length; i++) {
            const node = recipients[i];
            if (!node || typeof node.dispatchEvent !== 'function') continue;
            try {
                node.dispatchEvent(createEvent());
                sent += 1;
            } catch (_) {}
        }
        return sent;
    }

    simulateReleaseSweep(x, y) {
        // Fire a couple of release/cancel packets to unstick engines
        // that missed a previous "end" event during a freeze.
        this.simulateAll('end', x, y);
        this.simulateAll('end', x, y);
        this.forceReleaseGameInput(x, y);
    }

    emitRuntimeStatus(extra = {}) {
        if (!this.runtimeDebugEnabled) return;
        try {
            const lockElapsedMs = this.lastShotAt ? (Date.now() - this.lastShotAt) : 0;
            const detail = {
                engine: this.lowPower ? 'lite' : 'legacy',
                runtimeRole: this.runtimeRole,
                busReady: this.busReady,
                currentFps: this.currentFps,
                lowPower: this.lowPower,
                forceGame2d: !!window.__FORCE_GAME_2D,
                isInCooldown: this.isInCooldown,
                requireFistRelease: this.requireFistRelease,
                requireOpenAfterShot: this.requireOpenAfterShot,
                pendingFistEdge: this.pendingFistEdge,
                fistLatched: this.fistLatched,
                wasInterrupted: this.wasInterrupted,
                lockElapsedMs,
                dispatchDiag: this.lastDispatchDiag,
                ...extra
            };
            window.dispatchEvent(new CustomEvent('gesture-runtime-update', { detail }));
        } catch (_) {}
    }

    forceReleaseGameInput(x, y) {
        let target = this.getGameCanvas();
        if (!target) return;
        const rect = target.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const clientX = typeof x === 'number'
            ? Math.min(rect.right - 1, Math.max(rect.left + 1, x))
            : Math.floor(rect.left + rect.width * 0.5);
        const clientY = typeof y === 'number'
            ? Math.min(rect.bottom - 1, Math.max(rect.top + 1, y))
            : Math.floor(rect.top + rect.height * 0.5);
        const recipients = this.getDispatchRecipients(target);
        const common = { bubbles: true, cancelable: true, view: window, clientX, clientY };

        if (typeof window.PointerEvent === 'function') {
            this.dispatchToRecipients(recipients, () => new PointerEvent('pointercancel', {
                ...common, button: 0, buttons: 0, isPrimary: true, pointerId: 1, pointerType: 'touch'
            }));
            this.dispatchToRecipients(recipients, () => new PointerEvent('pointerup', {
                ...common, button: 0, buttons: 0, isPrimary: true, pointerId: 1, pointerType: 'touch'
            }));
        }
        this.dispatchToRecipients(recipients, () => new MouseEvent('mouseup', {
            ...common, button: 0, buttons: 0
        }));
        this.dispatchToRecipients(recipients, () => new MouseEvent('mousemove', {
            ...common, button: 0, buttons: 0
        }));
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
                this.dispatchToRecipients(recipients, () => new TouchEvent('touchcancel', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    touches: [],
                    targetTouches: [],
                    changedTouches: [touchPoint]
                }));
                this.dispatchToRecipients(recipients, () => new TouchEvent('touchend', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    touches: [],
                    targetTouches: [],
                    changedTouches: [touchPoint]
                }));
            }
        } catch (_) {}
    }

    render(isPalm, isFist) {
        const shot = this.isAiming ? this.computeShotVector() : { deltaX: 0, currentYForce: Config.baseYForce };
        this.drawAimOverlay({
            palmPoint: this.smoothPalmPoint,
            isPalm,
            isFist,
            isInCooldown: this.isInCooldown,
            isAiming: this.isAiming && !!this.palmStartPoint,
            shot
        });
    }

    drawAimOverlay(params) {
        const color = params.isInCooldown ? 'rgba(255,255,255,0.3)' : (params.isFist ? '#ffcc00' : (params.isPalm ? '#00fbff' : '#ffffff'));
        this.drawGlowPoint(params.palmPoint.x, params.palmPoint.y, 10, color);
        if (params.isAiming && !params.isInCooldown) {
            const bx = this.canvasElement.width * Config.ballStartPos.x;
            const by = this.canvasElement.height * Config.ballStartPos.y;
            this.ctx.fillStyle = '#00fbff';
            this.ctx.font = 'bold 20px Arial';
            this.ctx.fillText(params.isFist ? '✊ 触发投篮' : (params.isPalm ? '🖐 手掌瞄准' : '✋ 调整手势'), params.palmPoint.x + 25, params.palmPoint.y + 10);
            this.drawVectorParabola(bx, by, params.shot.deltaX, params.shot.currentYForce);
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
