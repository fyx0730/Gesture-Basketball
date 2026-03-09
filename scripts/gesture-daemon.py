#!/usr/bin/env python3
import asyncio
import json
import threading
import time
from typing import Optional, Set

import cv2
import mediapipe as mp
import websockets


HOST = "127.0.0.1"
PORT = 8765
CAMERA_INDEX = 0
TARGET_FPS = 15


clients: Set[websockets.WebSocketServerProtocol] = set()
loop_ref: Optional[asyncio.AbstractEventLoop] = None


def dist(a, b):
    dx = a.x - b.x
    dy = a.y - b.y
    return (dx * dx + dy * dy) ** 0.5


def is_fist(lms):
    palm = max(0.0001, dist(lms[0], lms[9]))
    tip_to_mcp = [
        dist(lms[8], lms[5]),
        dist(lms[12], lms[9]),
        dist(lms[16], lms[13]),
        dist(lms[20], lms[17]),
    ]
    folded = sum(1 for d in tip_to_mcp if d / palm < 0.82)
    thumb_folded = dist(lms[4], lms[2]) / palm < 1.0
    return folded >= 3 and thumb_folded


def is_palm(lms):
    palm = max(0.0001, dist(lms[0], lms[9]))
    ext = [
        dist(lms[8], lms[0]),
        dist(lms[12], lms[0]),
        dist(lms[16], lms[0]),
        dist(lms[20], lms[0]),
    ]
    extended = sum(1 for d in ext if d / palm > 1.5)
    thumb_open = dist(lms[4], lms[5]) / palm > 1.25
    return extended >= 3 and thumb_open


async def broadcast(msg):
    if not clients:
        return
    payload = json.dumps(msg, ensure_ascii=False)
    dead = []
    for ws in clients:
        try:
            await ws.send(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)


def publish(msg):
    if loop_ref is None:
        return
    asyncio.run_coroutine_threadsafe(broadcast(msg), loop_ref)


def vision_loop():
    cap = cv2.VideoCapture(CAMERA_INDEX)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 320)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 240)
    cap.set(cv2.CAP_PROP_FPS, TARGET_FPS)

    mp_hands = mp.solutions.hands
    armed = False
    prev_fist = False
    fist_release_seen = False

    with mp_hands.Hands(
        static_image_mode=False,
        max_num_hands=1,
        model_complexity=0,
        min_detection_confidence=0.6,
        min_tracking_confidence=0.6,
    ) as hands:
        interval = 1.0 / TARGET_FPS
        while True:
            start = time.time()
            ok, frame = cap.read()
            if not ok:
                time.sleep(0.2)
                continue
            frame = cv2.flip(frame, 1)
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = hands.process(rgb)

            if result.multi_hand_landmarks:
                lms = result.multi_hand_landmarks[0].landmark
                x = float(lms[9].x)
                y = float(lms[9].y)
                palm = is_palm(lms)
                fist = (not palm) and is_fist(lms)

                publish({"type": "aim", "x": x, "y": y, "ts": time.time()})

                if palm and not armed:
                    armed = True
                    fist_release_seen = False

                if not fist:
                    fist_release_seen = True

                if armed and fist and (not prev_fist) and fist_release_seen:
                    publish({"type": "shoot", "x": x, "y": y, "ts": time.time()})

                prev_fist = fist
            else:
                armed = False
                prev_fist = False
                fist_release_seen = False
                publish({"type": "idle", "ts": time.time()})

            elapsed = time.time() - start
            if elapsed < interval:
                time.sleep(interval - elapsed)


async def ws_handler(ws):
    clients.add(ws)
    try:
        await ws.send(json.dumps({"type": "hello", "message": "gesture daemon online"}))
        async for _ in ws:
            pass
    finally:
        clients.discard(ws)


async def main():
    global loop_ref
    loop_ref = asyncio.get_running_loop()
    thread = threading.Thread(target=vision_loop, daemon=True)
    thread.start()
    async with websockets.serve(ws_handler, HOST, PORT, max_queue=8):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
