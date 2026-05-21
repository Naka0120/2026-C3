# app.py
import asyncio
import cv2
import numpy as np
import base64
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
import uvicorn

import config
from geometry import create_cylinder_mask
from lbm_core import init_simulation, lbm_step
from acoustics import calc_strouhal_frequency

app = FastAPI()

# HTMLファイルを読み込んで返すエンドポイント
@app.get("/")
async def get():
    with open("index.html", "r", encoding="utf-8") as f:
        html_content = f.read()
    return HTMLResponse(html_content)

# LBMの画像を生成しBase64に変換する関数
def generate_frame_base64(u, mask):
    dv_dx = np.roll(u[1], -1, axis=1) - np.roll(u[1], 1, axis=1)
    du_dy = np.roll(u[0], -1, axis=0) - np.roll(u[0], 1, axis=0)
    vorticity = dv_dx - du_dy
    vorticity[mask] = 0.0

    v_min, v_max = -0.05, 0.05
    norm_vort = np.clip((vorticity - v_min) / (v_max - v_min), 0, 1)
    img_8u = (norm_vort * 255).astype(np.uint8)
    color_img = cv2.applyColorMap(img_8u, cv2.COLORMAP_JET)
    color_img[mask] = [0, 0, 0]
    
    # 拡大してJPEGエンコード
    resized = cv2.resize(color_img, (config.NX * 2, config.NY * 2), interpolation=cv2.INTER_NEAREST)
    _, buffer = cv2.imencode('.jpg', resized)
    return base64.b64encode(buffer).decode('utf-8')

# WebSocket通信のエンドポイント
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    
    # シミュレーションの初期化
    mask = create_cylinder_mask()
    f = init_simulation()
    step = 0
    
    # パラメータ更新を受け取る非同期タスク
    async def receive_updates():
        nonlocal mask, f
        try:
            while True:
                data = await websocket.receive_json()
                if data.get("type") == "update":
                    if "u_in" in data:
                        config.U_IN = float(data["u_in"])
                    if "radius" in data:
                        config.CYLINDER_R = int(data["radius"])
                    # パラメータが変わったらマスクと流速を再設定
                    mask = create_cylinder_mask()
                    # 完全にリセットせず、今の分布(f)を維持したまま進行させることも可能
        except WebSocketDisconnect:
            pass

    asyncio.create_task(receive_updates())

    try:
        while True:
            # 1回の送信につき、シミュレーションを数ステップ進めて高速化
            for _ in range(5):
                f, rho, u = lbm_step(f, mask)
                step += 1

            probe_x = config.CYLINDER_X
            probe_y = config.CYLINDER_Y + config.CYLINDER_R + 1
            cylinder_diameter = config.CYLINDER_R * 2.0
            
            local_v = np.sqrt(u[0, probe_y, probe_x]**2 + u[1, probe_y, probe_x]**2)
            freq = calc_strouhal_frequency(local_v, cylinder_diameter)

            img_base64 = generate_frame_base64(u, mask)

            # ブラウザへJSONデータを送信
            await websocket.send_json({
                "step": step,
                "freq": freq,
                "image": img_base64
            })
            
            # CPUを占有しすぎないよう微小なスリープ
            await asyncio.sleep(0.01)
            
    except WebSocketDisconnect:
        print("クライアントが切断しました。")

if __name__ == "__main__":
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)