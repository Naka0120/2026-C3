// main_multi.js: UIとアプリケーションロジック (マルチ和音版)

const ws = new WebSocket("ws://" + window.location.host + "/ws");

// --- UI State ---
let currentWidth = 10;
let currentDepth = 30;
const PIPE_Y_TOP = 40;
const THICKNESS = 5;

// --- 3D Viewer Initialization ---
let viewer;
window.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch('/api/config');
        if (res.ok) {
            const config = await res.json();
            
            const windSlider = document.getElementById('wind-slider');
            windSlider.min = config.WIND_MS_RANGE[0];
            windSlider.max = config.WIND_MS_RANGE[1];
            windSlider.value = config.WIND_MS;
            document.getElementById('wind-ms-display').innerText = Math.round(config.WIND_MS);
        }
    } catch (e) {
        console.error("Failed to load config:", e);
    }

    viewer = new Viewer3D('canvas-container');
});

// --- Audio Engine ---
let audioCtx;
let oscillators = [];
let gainNodes = [];
let isPlaying = false;

const updateText = (id, val) => {
    const el = document.getElementById(id);
    if(el) el.innerText = val;
};
const LBM_TO_MS = 340.0 * Math.sqrt(3);

// --- Event Listeners ---
document.getElementById('wind-slider').addEventListener('input', (e) => {
    let val = e.target.value;
    updateText('wind-ms-display', val);
    let payload = { type: 'update', u_in: parseFloat(val) / LBM_TO_MS };
    ws.send(JSON.stringify(payload));
});

const audioBtn = document.getElementById('audio-btn');
audioBtn.addEventListener('click', () => {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    if (!isPlaying) {
        isPlaying = true;
        audioBtn.innerText = 'STOP AUDIO';
        audioBtn.style.background = 'var(--alert)';
    } else {
        isPlaying = false;
        audioBtn.innerText = 'PLAY AUDIO';
        audioBtn.style.background = 'var(--accent)';
        
        // Stop sound immediately
        if (audioCtx) {
            for(let i=0; i<gainNodes.length; i++){
                gainNodes[i].gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
            }
        }
        const badge = document.getElementById('resonance-badge');
        if (badge) {
            badge.innerText = "風切り音のみ (非発音)";
            badge.className = "status-badge";
        }
        updateText('freq-val', "0.0");
    }
});

function base64ToFloat32Array(base64) {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return new Float32Array(bytes.buffer);
}

// --- WebSocket Event Processing ---
ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    // 3Dビューアの流体とパイプ更新
    if (viewer && data.u_data) {
        const uArray = base64ToFloat32Array(data.u_data);
        viewer.updateFluid(uArray, data.nx, data.ny);
        if (data.pipes) {
            viewer.updatePipes(data.pipes, PIPE_Y_TOP, THICKNESS);
        }
    }

    updateText('step-val', `Step: ${data.step}`);
    
    if (data.local_v_list && data.local_v_list.length > 0) {
        const maxV = Math.max(...data.local_v_list);
        updateText('local-v-val', maxV.toFixed(4));
        let localMs = (maxV * LBM_TO_MS).toFixed(1);
        updateText('local-v-ms-val', `(Max: ${localMs} m/s)`);
    }

    const badge = document.getElementById('resonance-badge');

    if (data.freqs && data.is_blowing_list && data.pipes) {
        // オシレーターの数がパイプの数と合わない場合は再生成
        if (audioCtx && isPlaying) {
            while (oscillators.length < data.pipes.length) {
                let osc = audioCtx.createOscillator();
                let gain = audioCtx.createGain();
                osc.type = 'sine';
                gain.gain.value = 0;
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start();
                oscillators.push(osc);
                gainNodes.push(gain);
            }
        }

        let blowingCount = 0;
        let freqStrs = [];

        // Audio Engine (Multi Pipes)
        if (isPlaying && audioCtx && oscillators.length === data.pipes.length) {
            let anyBlowing = false;
            for (let i = 0; i < data.pipes.length; i++) {
                if (data.is_blowing_list[i]) {
                    anyBlowing = true;
                    blowingCount++;
                    freqStrs.push(data.freqs[i].toFixed(1));
                    
                    oscillators[i].frequency.setTargetAtTime(data.freqs[i], audioCtx.currentTime, 0.05);
                    // 全体の音量が割れないように 1/N にスケーリング
                    const baseGain = (data.volumes[i] || 0) * 0.8;
                    const maxAllowedGain = 0.9 / data.pipes.length;
                    const gainVol = Math.min(baseGain, maxAllowedGain);
                    gainNodes[i].gain.setTargetAtTime(gainVol, audioCtx.currentTime, 0.05);
                } else {
                    gainNodes[i].gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
                }
            }
            if (badge) {
                if (anyBlowing) {
                    updateText('freq-val', freqStrs.join(" / "));
                    badge.innerText = `パイプ共鳴中！ (${freqStrs.length}本)`;
                    badge.className = "status-badge active";
                } else {
                    updateText('freq-val', "---");
                    badge.innerText = '風切り音のみ (非発音)';
                    badge.className = "status-badge";
                }
            }
        }
    }
};

ws.onclose = () => {
    console.log("WebSocket disconnected.");
};
