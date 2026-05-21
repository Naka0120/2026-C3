# geometry.py
import numpy as np
import config

def create_cylinder_mask():
    """
    グリッド上の円柱の位置を True とした2次元ブール配列を生成する。
    True の場所は「壁」として扱われ、流体が反射（バウンスバック）する。
    """
    # yとxの座標グリッドを作成 (yが0〜NY, xが0〜NX)
    y, x = np.mgrid[0:config.NY, 0:config.NX]
    
    # 円の方程式: (x - cx)^2 + (y - cy)^2 <= r^2
    mask = (x - config.CYLINDER_X)**2 + (y - config.CYLINDER_Y)**2 <= config.CYLINDER_R**2
    return mask