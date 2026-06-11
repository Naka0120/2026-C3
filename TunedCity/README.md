# Virtual City Wind Visualization

## プロジェクト概要
風を意図的に整流・加速させる仮想の建築構造「Aero-Acoustic Unit（漏斗型ビル＋ストリート・キャニオン）」をブラウザ上に3Dで構築し、風況ベクトルを可視化するプロジェクトです。
Three.jsを用いて空間のジオメトリと風のパーティクルアニメーションを描画し、将来的なCFD（数値流体力学）データとの連携を見据えた基盤を構築します。

## 使用技術
* **3D可視化:** Three.js
* **UI/データビジュアライゼーション:** D3.js
* **ローカルサーバー:** Python (Flask)

## 開発環境のセットアップ

仮想環境（venv）を作成し、毎回 `source` コマンド等でアクティベートせずに直接実行する場合は以下の手順で進めてください。

1. 仮想環境の作成
```bash
python3 -m venv venv
```

2. パッケージのインストール
```bash
./venv/bin/pip install -r requirements.txt
# Windows: venv\Scripts\pip install -r requirements.txt
```

## 動作確認
```bash
cd backend
../venv/bin/python app.py
# Windows: ..\venv\Scripts\python app.py
```
ブラウザで `http://localhost:5000` にアクセスしてください。
