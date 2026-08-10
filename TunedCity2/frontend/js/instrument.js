// パイプオルガン — acoustics_strict.py のロジックに基づく厳密な物理モデル（マルチ和音対応）

const INSTRUMENT_CONFIG = {
    DX_REAL: 0.01,                       // 1グリッド = 0.01m
    SPEED_OF_SOUND: 340.0,
    BASE_PIPE_DEPTH: 32,                 // デフォルト深さ C4=約261Hz 
    
    // グループA (微風 5m/s でジャストミート) - C Major
    GROUP_A_RATIOS: [1.0, 0.794, 0.667], // C4, E4, G4 に近い比率 (約261Hz, 329Hz, 392Hz)
    GROUP_A_TARGET_WIND: 5.0,
    
    // グループB (強風 10m/s でジャストミート) - A Minor
    GROUP_B_RATIOS: [0.595, 0.500, 0.397], // A4, C5, E5 に近い比率 (約440Hz, 523Hz, 659Hz)
    GROUP_B_TARGET_WIND: 10.0,

    SLIT_WIDTH: 0.003,                   // 実質的な物理スリット幅(3mm) -> UI上の太さ表現とは別
    
    MAX_VZ: 1.5,
    REFERENCE_WIND_MS: 20.0,             // 最大20m/sオーバーまで出せるように
    position: { x: 0, y: 0, z: 120 },    // 設置位置: 路地中央
};

let instrumentPipes = [];  // [{ mesh, osc, gainNode, f1, f3, virtualSlitWidth, currentMode, baseColor }]
let audioCtx = null;
let isAudioPlaying = false;
let isChordMode = true; // 常に和音モードとする

// 物理的な周波数を計算（閉管）
function calcClosedPipeFrequencies(depthGridUnits) {
    const lengthM = depthGridUnits * INSTRUMENT_CONFIG.DX_REAL;
    const widthM = 0.03; // 空洞の太さは3cmと仮定
    const deltaL = 0.425 * widthM; // 開口端補正
    const effL = lengthM + deltaL;
    
    const f1 = INSTRUMENT_CONFIG.SPEED_OF_SOUND / (4.0 * effL); // 基本音
    const f3 = 3.0 * f1; // 第3倍音
    return { f1, f3 };
}

// 仮想スリット幅を計算（指定風速でジャストミートさせるため）
function calcVirtualSlitWidth(targetWindMs, targetFreq) {
    // f_e = 0.2 * V / W => W = 0.2 * V / f_e
    return 0.2 * targetWindMs / targetFreq;
}

// エッジトーンと共鳴の計算 (acoustics_strict.py 相当)
function calcAcoustics(pipe, windMs) {
    if (windMs < 1.0) return { freq: pipe.f1, mode: pipe.currentMode, volume: 0, isOverblow: false };

    // エッジトーン周波数
    const fe = 0.2 * (windMs / pipe.virtualSlitWidth);
    
    // ヒステリシスによるモード判定
    let newMode = pipe.currentMode;
    if (pipe.currentMode === 1) {
        if (fe > pipe.f3 * 0.8) newMode = 3;
    } else {
        if (fe < pipe.f1 * 1.2) newMode = 1;
    }
    
    const fn = (newMode === 1) ? pipe.f1 : pipe.f3;
    
    // 共鳴効率（Q値による帯域の計算）
    // Q=1.5〜2.0程度にすることで、ある程度の帯域幅を持たせ、和音Aと和音Bがクロスフェードするようにする
    const Q = 1.8; 
    const detune = (fe - fn) / fn;
    let efficiency = 1.0 / (1.0 + 4.0 * (Q * Q) * (detune * detune));
    
    // カットオフ閾値 (0.15未満は完全に無音にする)
    if (efficiency < 0.15) efficiency = 0.0;
    
    // 音量計算 (運動エネルギー)
    let volume = 0;
    const threshold = 2.0;
    if (windMs > threshold && efficiency > 0) {
        const basePower = Math.log10(1.0 + (windMs - threshold)) * 3.0;
        volume = 0.8 * basePower * efficiency;
        if (volume > 1.0) volume = 1.0;
    }
    
    return { freq: fn, mode: newMode, volume: volume, isOverblow: (newMode === 3) };
}

function getLocalWindSpeedMs() {
    const { x, z } = INSTRUMENT_CONFIG.position;
    // wind.js の getWindVelocity が必要
    if (typeof getWindVelocity !== 'function') return 0;
    const { vz } = getWindVelocity(x, z);
    return (vz / INSTRUMENT_CONFIG.MAX_VZ) * INSTRUMENT_CONFIG.REFERENCE_WIND_MS;
}

function buildInstrumentPipes() {
    instrumentPipes.forEach(p => {
        scene.remove(p.mesh);
        if(p.mesh.geometry) p.mesh.geometry.dispose();
        if(p.mesh.material) p.mesh.material.dispose();
    });
    instrumentPipes = [];

    const { x: cx, y: cy, z: cz } = INSTRUMENT_CONFIG.position;
    
    // パイプ生成ヘルパー
    const createPipes = (ratios, targetWind, groupOffsetX, colorHex) => {
        if (!isChordMode) ratios = [ratios[0]]; // 単音モードなら最初の1本だけ

        ratios.forEach((ratio, i) => {
            const depth = Math.round(INSTRUMENT_CONFIG.BASE_PIPE_DEPTH * ratio);
            const { f1, f3 } = calcClosedPipeFrequencies(depth);
            const virtualSlitWidth = calcVirtualSlitWidth(targetWind, f1);
            
            const pipeHeight = depth * 1.5; // UI上の高さを少し強調
            
            const geometry = new THREE.BoxGeometry(3, pipeHeight, 3);
            const material = new THREE.MeshStandardMaterial({
                color: colorHex,
                metalness: 0.5,
                roughness: 0.4,
                emissive: new THREE.Color(0x000000),
            });
            const mesh = new THREE.Mesh(geometry, material);

            const xOffset = groupOffsetX + (i - (ratios.length - 1) / 2) * 3.5;
            mesh.position.set(cx + xOffset, cy + pipeHeight / 2, cz);
            mesh.castShadow = true;
            scene.add(mesh);

            instrumentPipes.push({ 
                mesh, f1, f3, virtualSlitWidth, 
                currentMode: 1, 
                osc: null, gainNode: null, baseColor: colorHex
            });
        });
    };

    // グループA (微風 5m/s で共鳴) - 左側に配置
    createPipes(INSTRUMENT_CONFIG.GROUP_A_RATIOS, INSTRUMENT_CONFIG.GROUP_A_TARGET_WIND, -5, 0x88aaff);
    
    // グループB (強風 10m/s で共鳴) - 右側に配置
    if (isChordMode) {
        createPipes(INSTRUMENT_CONFIG.GROUP_B_RATIOS, INSTRUMENT_CONFIG.GROUP_B_TARGET_WIND, 5, 0xffaa88);
    }
}

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();

    instrumentPipes.forEach(pipe => {
        if (!pipe.osc) {
            const osc = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.value = pipe.f1;
            gainNode.gain.value = 0;
            osc.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            osc.start();
            pipe.osc = osc;
            pipe.gainNode = gainNode;
        }
    });
}

function initInstrument() {
    buildInstrumentPipes();

    const btn = document.getElementById('inst-audio-btn');
    if(btn) {
        btn.addEventListener('click', () => {
            isAudioPlaying = !isAudioPlaying;
            btn.textContent = isAudioPlaying ? 'STOP AUDIO' : 'PLAY AUDIO';
            btn.classList.toggle('inst-active', isAudioPlaying);
            if (isAudioPlaying) {
                initAudio();
            } else {
                instrumentPipes.forEach(p => {
                    if (p.gainNode) p.gainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.5);
                });
            }
        });
    }

    const toggle = document.getElementById('inst-chord-toggle');
    if (toggle) {
        // デフォルトで必ず和音モード（6本表示）にする
        toggle.checked = true;
        isChordMode = true;
        buildInstrumentPipes();

        toggle.addEventListener('change', (e) => {
            isChordMode = e.target.checked;
            instrumentPipes.forEach(p => {
                if (p.osc) { p.osc.stop(); p.osc = null; p.gainNode = null; }
            });
            buildInstrumentPipes();
            if (isAudioPlaying) initAudio();
        });
    }
}

function updateInstrument() {
    if (instrumentPipes.length === 0) return;

    const windSpeedMs = getLocalWindSpeedMs();
    let isAnyBlowing = false;
    let isAnyOverblow = false;
    let activeFreqs = [];

    instrumentPipes.forEach(pipe => {
        const result = calcAcoustics(pipe, Math.abs(windSpeedMs));
        pipe.currentMode = result.mode;
        
        const isBlowing = result.volume > 0.01;
        if (isBlowing) {
            isAnyBlowing = true;
            activeFreqs.push(result.freq);
            if (result.isOverblow) isAnyOverblow = true;
            
            // 鳴っているパイプを発光させる
            const highlightColor = result.isOverblow ? 0xff4444 : pipe.baseColor;
            pipe.mesh.material.color.setHex(highlightColor);
            pipe.mesh.material.emissive.setHex(highlightColor);
            pipe.mesh.material.emissiveIntensity = result.volume * 0.8;
        } else {
            // 無音のパイプは暗くする
            pipe.mesh.material.color.setHex(0x555555);
            pipe.mesh.material.emissive.setHex(0x000000);
            pipe.mesh.material.emissiveIntensity = 0;
        }

        if (audioCtx && isAudioPlaying && pipe.osc) {
            const now = audioCtx.currentTime;
            pipe.osc.frequency.setTargetAtTime(result.freq, now, 0.1);
            // パイプの数で音量を割ってクリッピングを防ぐ
            pipe.gainNode.gain.setTargetAtTime((result.volume * 0.4) / instrumentPipes.length, now, 0.1);
        }
    });

    // UIの更新
    const speedEl = document.getElementById('inst-wind-speed');
    const freqEl  = document.getElementById('inst-freq');
    const statusEl = document.getElementById('inst-status');

    if (speedEl) speedEl.textContent = Math.abs(windSpeedMs).toFixed(1);
    
    if (freqEl) {
        freqEl.textContent = activeFreqs.length > 0 
            ? activeFreqs.map(f => Math.round(f)).join('/') + 'Hz'
            : '---';
    }
    
    if (statusEl) {
        if (!isAnyBlowing) {
            statusEl.textContent = '風切り音のみ';
            statusEl.style.color = '#aaa';
            statusEl.className = 'inst-status';
        } else if (isAnyOverblow) {
            statusEl.textContent = 'オーバーブロー!';
            statusEl.style.color = '#ff4444';
            statusEl.className = 'inst-status inst-resonating';
        } else {
            statusEl.textContent = 'パイプ共鳴中';
            statusEl.style.color = '#44ff44';
            statusEl.className = 'inst-status inst-resonating';
        }
    }
}
