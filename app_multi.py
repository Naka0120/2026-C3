# app_multi.py
import asyncio
import numpy as np
import base64
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

import config
from geometry import create_pipe_mask
from lbm_core import init_simulation, lbm_step
from acoustics_strict import calc_actual_frequency, calc_volume

app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def get():
    with open("static/index_multi.html", "r", encoding="utf-8") as f:
        html_content = f.read()
    return HTMLResponse(html_content)

@app.get("/api/config")
async def get_config():
    return {
        "WIND_MS_RANGE": config.WIND_MS_RANGE,
        "PIPE_WIDTH_RANGE": config.PIPE_WIDTH_RANGE,
        "PIPE_DEPTH_RANGE": config.PIPE_DEPTH_RANGE,
        "PIPE_WIDTH": config.BASE_PIPE_WIDTH,
        "PIPE_DEPTH": config.BASE_PIPE_DEPTH,
        "WIND_MS": config.U_IN * config.LBM_TO_MS,
        "CHORD_MODE": True
    }

def generate_vector_field_base64(u):
    u_bytes = u.astype(np.float32).tobytes()
    return base64.b64encode(u_bytes).decode('ascii')

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    
    # 6本のパイプを初期化
    config.CHORD_MODE = True
    config.PIPES = []
    
    # 前列: Cメジャー (ド・ミ・ソ) - 低風速用
    c_ratios = [1.0, 0.76, 0.61] 
    # 後列: Aマイナー (ラ・ド・ミ) - 中風速用
    a_ratios = [0.53, 0.43, 0.33]
    
    # 配置
    for i, ratio in enumerate(c_ratios):
        pw = max(5, int(round(config.BASE_PIPE_WIDTH * ratio)))
        pd = max(10, int(round(config.BASE_PIPE_DEPTH * ratio)))
        px = config.BASE_PIPE_X + i * (pw + config.PIPE_SPACING)
        config.PIPES.append({
            'x': int(px), 'width': pw, 'depth': pd,
            'exact_width': config.BASE_PIPE_WIDTH * ratio,
            'exact_depth': config.BASE_PIPE_DEPTH * ratio
        })
    for i, ratio in enumerate(a_ratios):
        pw = max(5, int(round(config.BASE_PIPE_WIDTH * ratio)))
        pd = max(10, int(round(config.BASE_PIPE_DEPTH * ratio)))
        px = config.BASE_PIPE_X + 40 + i * (pw + config.PIPE_SPACING)
        config.PIPES.append({
            'x': int(px), 'width': pw, 'depth': pd,
            'exact_width': config.BASE_PIPE_WIDTH * ratio,
            'exact_depth': config.BASE_PIPE_DEPTH * ratio
        })
        
    mask = create_pipe_mask()
    f = init_simulation()
    step = 0
    
    async def receive_updates():
        nonlocal mask, f
        try:
            while True:
                data = await websocket.receive_json()
                if data.get("type") == "update":
                    if "u_in" in data: 
                        config.U_IN = float(data["u_in"])
        except WebSocketDisconnect:
            pass

    asyncio.create_task(receive_updates())

    try:
        while True:
            for _ in range(5):
                f, rho, u = lbm_step(f, mask)
                step += 1

            freqs = []
            is_blowing_list = []
            local_v_list = []
            volumes = []

            for pipe in config.PIPES:
                if 'mode' not in pipe:
                    pipe['mode'] = 1

                probe_x = pipe['x'] + config.THICKNESS + pipe['width'] // 2
                probe_y = max(0, config.PIPE_Y_TOP - 2)
                
                local_v = np.sqrt(u[0, probe_y, probe_x]**2 + u[1, probe_y, probe_x]**2)
                if np.isnan(local_v):
                    local_v = 0.0
                local_v_list.append(float(local_v))
                
                real_length_m = pipe.get('exact_depth', pipe['depth']) * config.DX_REAL
                width_m = pipe.get('exact_width', pipe['width']) * config.DX_REAL
                local_v_ms = local_v * config.LBM_TO_MS

                global_v_ms = config.U_IN * config.LBM_TO_MS
                
                freq, new_mode, efficiency = calc_actual_frequency(
                    length_m=real_length_m, 
                    width_m=width_m, 
                    global_v_ms=global_v_ms,
                    local_v_ms=local_v_ms, 
                    current_mode=pipe['mode']
                )
                
                pipe['mode'] = new_mode
                freqs.append(float(freq))
                
                vol = calc_volume(global_v_ms, threshold=2.0, efficiency=efficiency)
                volumes.append(float(vol))
                is_blowing_list.append(bool(vol > 0.001))

            img_base64 = generate_vector_field_base64(u)

            await websocket.send_json({
                "step": step,
                "pipes": config.PIPES,
                "freqs": freqs,
                "is_blowing_list": is_blowing_list,
                "local_v_list": local_v_list,
                "volumes": volumes,
                "u_data": img_base64,
                "nx": config.NX,
                "ny": config.NY
            })
            await asyncio.sleep(0.01)
            
    except WebSocketDisconnect:
        print("クライアントが切断しました。")

if __name__ == "__main__":
    uvicorn.run("app_multi:app", host="127.0.0.1", port=8001, reload=True)
