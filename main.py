# main.py
import cv2
import numpy as np
import config
from geometry import create_cylinder_mask
from lbm_core import init_simulation, lbm_step
from acoustics import calc_strouhal_frequency

def display_realtime(u, mask, step, freq):
    """OpenCVを用いて流速（渦度）をリアルタイムにウィンドウ描画する"""
    
    # 渦度の計算
    dv_dx = np.roll(u[1], -1, axis=1) - np.roll(u[1], 1, axis=1)
    du_dy = np.roll(u[0], -1, axis=0) - np.roll(u[0], 1, axis=0)
    vorticity = dv_dx - du_dy
    vorticity[mask] = 0.0

    # 渦度の値を 0〜255 の8ビット画像に正規化 (赤〜青の表現用)
    v_min, v_max = -0.05, 0.05
    norm_vort = np.clip((vorticity - v_min) / (v_max - v_min), 0, 1)
    img_8u = (norm_vort * 255).astype(np.uint8)

    # カラーマップを適用（JETは青〜緑〜赤のグラデーション）
    color_img = cv2.applyColorMap(img_8u, cv2.COLORMAP_JET)

    # 円柱部分を黒で塗りつぶす
    color_img[mask] = [0, 0, 0]

    # 情報テキストを描画
    text = f"Step: {step} | Freq: {freq:.4f}"
    cv2.putText(color_img, text, (10, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)

    # 見やすいように画像を拡大 (2倍)
    display_img = cv2.resize(color_img, (config.NX * 2, config.NY * 2), interpolation=cv2.INTER_NEAREST)

    # ウィンドウに表示
    cv2.imshow("LBM Real-time Simulation", display_img)

def main():
    print("--- 物理パラメータ ---")
    print(f"Reynolds Number: {config.RE}")
    print(f"Relaxation Time (Tau): {config.TAU:.4f}")
    
    mask = create_cylinder_mask()
    f = init_simulation()
    
    probe_x = config.CYLINDER_X
    probe_y = config.CYLINDER_Y + config.CYLINDER_R + 1
    cylinder_diameter = config.CYLINDER_R * 2.0
    
    print("\nシミュレーション開始...")
    print("※シミュレーションウィンドウを選択した状態で『q』キーを押すと終了します。")
    
    for step in range(1, config.MAX_ITERS + 1):
        f, rho, u = lbm_step(f, mask)
        
        # 描画頻度（例えば10ステップごとに描画すると動画がスムーズになります）
        # config.PLOT_FREQ ではなく 10 に固定して滑らかにします
        if step % 10 == 0:
            vx = u[0, probe_y, probe_x]
            vy = u[1, probe_y, probe_x]
            local_v = np.sqrt(vx**2 + vy**2)
            freq = calc_strouhal_frequency(local_v, cylinder_diameter)
            
            # 動画としての描画処理
            display_realtime(u, mask, step, freq)
            
            # 1ミリ秒待機し、キー入力を受け付ける（'q'キーで強制終了）
            if cv2.waitKey(1) & 0xFF == ord('q'):
                print("ユーザー操作により終了しました。")
                break

    # 全て終わったらウィンドウを閉じる
    cv2.destroyAllWindows()
    print("シミュレーション完了。")

if __name__ == "__main__":
    main()