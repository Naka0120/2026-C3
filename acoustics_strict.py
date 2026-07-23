# acoustics_strict.py
import numpy as np
from numba import njit
import math

@njit
def calc_actual_frequency(length_m, width_m, global_v_ms, local_v_ms, current_mode, speed_of_sound=340.0):
    """
    風速、パイプの長さ、幅からエッジトーン周波数を計算し、
    ヒステリシスを考慮して鳴るべき倍音モードとその周波数、および共鳴効率を返す。
    ※マルチ和音仕様のため、共鳴帯域を極端に狭くし、デッドゾーンでは完全に無音にする。
    """
    if length_m <= 0 or width_m <= 0:
        return 0.0, 1, 0.0

    # 開口端補正 (End correction)
    delta_L = 0.425 * width_m
    effective_length = length_m + delta_L

    # パイプの共鳴周波数（閉管）
    f_r1 = speed_of_sound / (4.0 * effective_length)      # 基本音 (モード1)
    f_r3 = 3.0 * speed_of_sound / (4.0 * effective_length)  # 第3倍音 (モード3)

    # カルマン渦（エッジトーン）の周波数
    b = width_m
    if b <= 0:
        b = 0.001
        
    width_scale = 1.0 / 32.0
    virtual_b = b * width_scale

    f_e = 0.2 * (global_v_ms / virtual_b)

    # ヒステリシス（デッドゾーン）によるモード遷移の判定
    new_mode = current_mode
    if current_mode == 1:
        if f_e > f_r3 * 0.8: # さらに厳しく
            new_mode = 3
    else: # current_mode == 3
        if f_e < f_r1 * 1.2: # さらに厳しく
            new_mode = 1

    f_n = f_r1 if new_mode == 1 else f_r3

    # 共鳴効率の計算
    Q = 3.0 # 共鳴の鋭さを1.5から3.0へ引き上げ、ストライクゾーンを非常に狭くする
    detune = (f_e - f_n) / f_n
    efficiency = 1.0 / (1.0 + 4.0 * (Q**2) * (detune**2))

    # 完全な無音化（デッドゾーンの厳密化）
    if efficiency < 0.25:
        efficiency = 0.0 # 少しでも外れたら完全に鳴らないようにする

    return f_n, new_mode, efficiency

@njit
def calc_volume(wind_v_ms, threshold=3.0, efficiency=1.0):
    if wind_v_ms <= threshold:
        return 0.0
    
    # 運動エネルギー由来の基本パワー
    base_power = math.log10(1.0 + (wind_v_ms - threshold)) * 3.0
    
    k = 0.8
    volume = k * base_power * efficiency
    
    if volume > 1.0:
        volume = 1.0
        
    return volume
