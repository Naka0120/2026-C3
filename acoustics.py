# acoustics.py
import numpy as np
from numba import njit

@njit
def calc_aeolian_resonance(v, d, f1, num_harmonics=8, st=0.2, lock_in_width=0.15, freq_scale=100000.0):
    """
    エオリアンハープの弦の共振（ロックイン現象）を計算する
    v: 局所風速 (LBMの内部単位)
    d: 弦の太さ (LBMの内部単位)
    f1: 弦の基本周波数(Hz)
    freq_scale: LBM単位を現実のHzスケールに変換する係数
    """
    epsilon = 1e-6
    # 1. 素のカルマン渦の発生周波数（シミュレーション単位）
    f_s_lattice = (st * v) / (d + epsilon)
    
    # 2. 現実のHzスケールに拡大
    f_s = f_s_lattice * freq_scale
    
    # 3. ロックイン現象（倍音との共振）の判定
    for n in range(1, num_harmonics + 1):
        f_n = n * f1
        # 渦の周波数が、第n倍音の周波数の±15%以内に入ったら共振
        if abs(f_s - f_n) / f_n < lock_in_width:
            return f_n, n, f_s
            
    # どの倍音とも共振しなかった場合
    return 0.0, 0, f_s