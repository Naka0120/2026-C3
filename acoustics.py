# acoustics.py
import numpy as np
from numba import njit

@njit
def calc_strouhal_frequency(v, d, st=0.2):
    """
    ストローハル効果による発生周波数を計算する。
    v: 局所風速の大きさ (スカラー値)
    d: 円柱の直径 (スカラー値)
    st: ストローハル数 (デフォルト0.2)
    
    戻り値:
    f: 推定される周波数
    """
    # ゼロ除算を回避するための微小値
    epsilon = 1e-6
    
    # 公式: f = (St * V) / D
    f = (st * v) / (d + epsilon)
    return f