# acoustics.py
import numpy as np
from numba import njit

@njit
def calc_pipe_resonance(length_m, speed_of_sound=340.0):
    """
    閉管の気柱共鳴による基本周波数 f を計算する
    f = v / (4 * L)
    length_m: パイプの深さ (L) メートル
    speed_of_sound: 音速 (m/s)
    """
    if length_m <= 0:
        return 0.0
    return speed_of_sound / (4.0 * length_m)

@njit
def is_blowing_hard_enough(local_v, threshold=0.01):
    """
    局所風速が、エッジトーンを発生（パイプを鳴らす）させるのに十分か判定する
    local_v: LBM単位系の局所風速
    threshold: 発音の閾値
    """
    return local_v > threshold