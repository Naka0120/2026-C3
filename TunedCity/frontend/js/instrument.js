// パイプオルガン — acoustics.py / config.py / main.js から移植

const INSTRUMENT_CONFIG = {
    DX_REAL: 0.01,                       // 1グリッド = 0.01m (config.py より)
    SPEED_OF_SOUND: 340.0,
    BASE_PIPE_DEPTH: 30,                 // デフォルト深さ（グリッド単位）→ L=0.3m → 283Hz
    CHORD_RATIOS: [1.0, 0.8, 0.66],     // 和音比率 ド:ミ:ソ
    BLOW_THRESHOLD_MS: 3.0,             // 発音閾値 m/s (acoustics.py と同値)
    MAX_VZ: 1.5,                         // 路地での最大 vz (baseSpeed*inletHalfGap/minHalfGap)
    REFERENCE_WIND_MS: 10.0,            // MAX_VZ に対応する実風速 m/s
    position: { x: 0, y: 0, z: 120 },  // 設置位置: 路地中央
};

let instrumentPipes = [];  // [{ mesh, osc, gainNode, freq }]
let audioCtx = null;
let isAudioPlaying = false;
let isChordMode = false;

function calcPipeResonance(depthGridUnits) {
    const lengthM = depthGridUnits * INSTRUMENT_CONFIG.DX_REAL;
    return INSTRUMENT_CONFIG.SPEED_OF_SOUND / (4.0 * lengthM);
}

function getLocalWindSpeedMs() {
    const { x, z } = INSTRUMENT_CONFIG.position;
    const { vz } = getWindVelocity(x, z);
    return (vz / INSTRUMENT_CONFIG.MAX_VZ) * INSTRUMENT_CONFIG.REFERENCE_WIND_MS;
}

function buildInstrumentPipes() {
    instrumentPipes.forEach(p => {
        scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
    });
    instrumentPipes = [];

    const depths = isChordMode
        ? INSTRUMENT_CONFIG.CHORD_RATIOS.map(r => Math.round(INSTRUMENT_CONFIG.BASE_PIPE_DEPTH * r))
        : [INSTRUMENT_CONFIG.BASE_PIPE_DEPTH];

    const { x: cx, y: cy, z: cz } = INSTRUMENT_CONFIG.position;

    depths.forEach((depth, i) => {
        const freq = calcPipeResonance(depth);
        const pipeHeight = depth * 2;

        const geometry = new THREE.BoxGeometry(3, pipeHeight, 3);
        const material = new THREE.MeshStandardMaterial({
            color: 0x888888,
            metalness: 0.5,
            roughness: 0.4,
            emissive: new THREE.Color(0x000000),
        });
        const mesh = new THREE.Mesh(geometry, material);

        const xOffset = (i - (depths.length - 1) / 2) * 6;
        mesh.position.set(cx + xOffset, cy + pipeHeight / 2, cz);
        mesh.castShadow = true;
        scene.add(mesh);

        instrumentPipes.push({ mesh, freq, osc: null, gainNode: null });
    });
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
            osc.frequency.value = pipe.freq;
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

    document.getElementById('inst-audio-btn').addEventListener('click', () => {
        isAudioPlaying = !isAudioPlaying;
        const btn = document.getElementById('inst-audio-btn');
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

    document.getElementById('inst-chord-toggle').addEventListener('change', (e) => {
        isChordMode = e.target.checked;
        instrumentPipes.forEach(p => {
            if (p.osc) { p.osc.stop(); p.osc = null; p.gainNode = null; }
        });
        buildInstrumentPipes();
        if (isAudioPlaying) initAudio();
    });
}

function updateInstrument() {
    if (instrumentPipes.length === 0) return;

    const windSpeedMs = getLocalWindSpeedMs();
    const isBlowing = windSpeedMs > INSTRUMENT_CONFIG.BLOW_THRESHOLD_MS;
    const pipeCount = instrumentPipes.length;

    instrumentPipes.forEach(pipe => {
        pipe.mesh.material.color.set(isBlowing ? 0xffaa44 : 0x888888);
        pipe.mesh.material.emissive.set(isBlowing ? 0x331100 : 0x000000);

        if (audioCtx && isAudioPlaying && pipe.osc) {
            const now = audioCtx.currentTime;
            if (isBlowing) {
                pipe.osc.frequency.setTargetAtTime(pipe.freq, now, 0.1);
                pipe.gainNode.gain.setTargetAtTime(0.3 / pipeCount, now, 0.1);
            } else {
                pipe.gainNode.gain.setTargetAtTime(0, now, 0.5);
            }
        }
    });

    const speedEl = document.getElementById('inst-wind-speed');
    const freqEl  = document.getElementById('inst-freq');
    const statusEl = document.getElementById('inst-status');

    if (speedEl) speedEl.textContent = windSpeedMs.toFixed(1);
    if (freqEl)  freqEl.textContent  = isBlowing
        ? instrumentPipes.map(p => p.freq.toFixed(0)).join(' / ')
        : '---';
    if (statusEl) {
        statusEl.textContent = isBlowing ? 'パイプ共鳴中！' : '風切り音のみ';
        statusEl.className = 'inst-status' + (isBlowing ? ' inst-resonating' : '');
    }
}
