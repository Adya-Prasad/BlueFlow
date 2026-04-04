/**
 * BlueFlow Dashboard Client
 * Connects to /ws/dashboard to receive live status, audio levels, and transcription.
 */

// --- State ---
let ws = null;
let allText = [];

// --- DOM ---
const phoneStatusDot  = document.getElementById("phone-status-dot");
const phoneStatusText = document.getElementById("phone-status-text");
const streamingDot    = document.getElementById("streaming-dot");
const streamingText   = document.getElementById("streaming-text");
const levelFill       = document.getElementById("level-fill");
const transcription   = document.getElementById("transcription");
const copyBtn         = document.getElementById("copy-btn");
const clearBtn        = document.getElementById("clear-btn");
const deviceSelect    = document.getElementById("device-select");
const deviceHint      = document.getElementById("device-hint");
const micBadgeDot     = document.getElementById("mic-badge-dot");
const sttBadgeDot     = document.getElementById("stt-badge-dot");
const phoneUrlEl      = document.getElementById("phone-url");
const toast           = document.getElementById("toast");

// --- Helpers ---
function showToast(msg, duration = 2500) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), duration);
}

function setPhoneUrl() {
    const proto = location.protocol;
    const host = location.hostname === "localhost" || location.hostname === "127.0.0.1"
        ? location.host : location.host;
    const url = `${proto}//${location.host}/phone`;
    if (phoneUrlEl) phoneUrlEl.textContent = url;
}

// --- Load devices ---
async function loadDevices() {
    try {
        const res = await fetch("/api/devices");
        const devices = await res.json();
        if (!deviceSelect) return;
        deviceSelect.innerHTML = "";
        devices.forEach(d => {
            const opt = document.createElement("option");
            opt.value = d.index;
            opt.textContent = `${d.name}`;
            deviceSelect.appendChild(opt);
        });
    } catch (e) {
        console.error("Failed to load devices:", e);
    }
}

// --- WebSocket ---
function connectDashboard() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${location.host}/ws/dashboard`;
    ws = new WebSocket(url);

    ws.onopen = () => {
        console.log("Dashboard WebSocket connected");
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            handleMessage(msg);
        } catch (e) {
            console.error("WS parse error:", e);
        }
    };

    ws.onclose = () => {
        console.log("Dashboard WS disconnected — reconnecting...");
        setTimeout(connectDashboard, 2000);
    };

    ws.onerror = () => {};
}

function handleMessage(msg) {
    switch (msg.type) {
        case "status":
            // Initial status on connect
            updatePhoneStatus(msg.phone_connected, msg.phone_ip);
            updateStreamingStatus(msg.streaming);
            if (msg.device) {
                if (deviceHint) deviceHint.textContent = `Active: ${msg.device}`;
                // Select the active device in dropdown
                if (deviceSelect) deviceSelect.value = msg.device_index;
            }
            if (micBadgeDot) {
                micBadgeDot.classList.toggle("active", !!msg.device);
                micBadgeDot.classList.toggle("error", !msg.device);
            }
            if (sttBadgeDot) {
                sttBadgeDot.classList.toggle("active", msg.transcription_enabled);
                sttBadgeDot.classList.toggle("error", !msg.transcription_enabled);
            }
            break;

        case "phone_connected":
            updatePhoneStatus(true, msg.ip);
            showToast("📱 Phone connected!");
            break;

        case "phone_disconnected":
            updatePhoneStatus(false, null);
            updateStreamingStatus(false);
            setLevel(0);
            showToast("Phone disconnected");
            break;

        case "transcription":
            handleTranscription(msg);
            if (msg.level !== undefined) setLevel(msg.level);
            break;

        case "audio_level":
            setLevel(msg.level);
            updateStreamingStatus(true);
            break;

        case "device_changed":
            if (deviceHint) deviceHint.textContent = `Active: ${msg.device}`;
            if (deviceSelect) deviceSelect.value = msg.device_index;
            showToast(`Switched to: ${msg.device}`);
            break;

        case "error":
            showToast(`⚠️ ${msg.message}`, 4000);
            break;
    }
}

function updatePhoneStatus(connected, ip) {
    if (phoneStatusDot) {
        phoneStatusDot.className = "status-indicator " + (connected ? "connected" : "disconnected");
    }
    if (phoneStatusText) {
        phoneStatusText.textContent = connected ? `Connected (${ip})` : "Waiting for phone...";
    }
}

function updateStreamingStatus(active) {
    if (streamingDot) {
        streamingDot.className = "status-indicator " + (active ? "streaming" : "disconnected");
    }
    if (streamingText) {
        streamingText.textContent = active ? "Active" : "Idle";
    }
}

function setLevel(value) {
    if (levelFill) {
        levelFill.style.width = `${Math.min(value * 100, 100)}%`;
    }
}

// --- Transcription ---
function handleTranscription(msg) {
    if (!transcription) return;

    // Remove placeholder
    const placeholder = transcription.querySelector(".placeholder");
    if (placeholder) placeholder.remove();

    if (msg.final) {
        // Remove partial
        const partial = document.getElementById("partial-line");
        if (partial) partial.remove();

        // Add final text
        const p = document.createElement("p");
        p.textContent = msg.text;
        transcription.appendChild(p);
        allText.push(msg.text);
        transcription.scrollTop = transcription.scrollHeight;
    } else {
        // Update partial
        let partial = document.getElementById("partial-line");
        if (!partial) {
            partial = document.createElement("p");
            partial.id = "partial-line";
            partial.className = "partial";
            transcription.appendChild(partial);
        }
        partial.textContent = msg.text;
        transcription.scrollTop = transcription.scrollHeight;
    }
}

// --- Button Events ---
if (copyBtn) {
    copyBtn.addEventListener("click", () => {
        const text = allText.join("\n");
        if (!text) {
            showToast("Nothing to copy");
            return;
        }
        navigator.clipboard.writeText(text).then(() => {
            showToast("✅ Copied to clipboard!");
        }).catch(() => {
            // Fallback
            const ta = document.createElement("textarea");
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
            showToast("✅ Copied to clipboard!");
        });
    });
}

if (clearBtn) {
    clearBtn.addEventListener("click", () => {
        allText = [];
        if (transcription) {
            transcription.innerHTML = '<p class="placeholder">Transcribed text will appear here...</p>';
        }
        showToast("Cleared");
    });
}

if (deviceSelect) {
    deviceSelect.addEventListener("change", () => {
        const idx = parseInt(deviceSelect.value);
        if (!isNaN(idx) && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "change_device", device_index: idx }));
        }
    });
}

// --- Init ---
setPhoneUrl();
loadDevices();
connectDashboard();
