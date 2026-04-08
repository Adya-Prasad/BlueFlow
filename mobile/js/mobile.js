/**
 * BlueFlow Mobile Client
 * Captures microphone audio via AudioWorklet and streams to PC over WebSocket.
 * Includes comprehensive microphone permission handling.
 */

const SAMPLE_RATE = 16000;

// --- State ---
let audioContext = null;
let mediaStream = null;
let workletNode = null;
let ws = null;
let isStreaming = false;
let permissionState = "unknown"; // "unknown", "prompt", "granted", "denied"

// --- DOM Elements ---
const micBtn = document.getElementById("mic-btn");
const micIcon = document.getElementById("mic-icon");
const micHint = document.getElementById("mic-hint");
const statusText = document.getElementById("status-text");
const statusDot = document.getElementById("status-dot");
const levelBar = document.getElementById("level-fill");
const transcriptionEl = document.getElementById("transcription");
const ringPulse = document.getElementById("ring-pulse");

// Permission modal elements
const permModal = document.getElementById("permission-modal");
const modalTitle = document.getElementById("modal-title");
const modalDesc = document.getElementById("modal-desc");
const modalSteps = document.getElementById("modal-steps");
const modalAllowBtn = document.getElementById("modal-allow-btn");
const modalCloseBtn = document.getElementById("modal-close-btn");
const secureWarning = document.getElementById("secure-warning");

// --- Browser Detection ---
function getBrowser() {
    const ua = navigator.userAgent;
    if (/CriOS/i.test(ua)) return "chrome-ios";
    if (/Chrome/i.test(ua) && !/Edg/i.test(ua)) return "chrome";
    if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) return "safari";
    if (/Firefox/i.test(ua) || /FxiOS/i.test(ua)) return "firefox";
    if (/Edg/i.test(ua)) return "edge";
    if (/SamsungBrowser/i.test(ua)) return "samsung";
    return "other";
}

function isAndroid() {
    return /Android/i.test(navigator.userAgent);
}

function isIOS() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// --- WebSocket URL ---
function getWsUrl() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws/audio`;
}

// --- UI Updates ---
function setStatus(text, state) {
    if (statusText) statusText.textContent = text;
    if (statusDot) {
        statusDot.className = "status-dot";
        if (state) statusDot.classList.add(state);
    }
}

function setLevel(value) {
    if (levelBar) {
        levelBar.style.width = `${Math.min(value * 100, 100)}%`;
    }
}

function setStreaming(active) {
    isStreaming = active;
    if (micBtn) micBtn.classList.toggle("active", active);
    if (ringPulse) ringPulse.classList.toggle("pulsing", active);
    if (micIcon) micIcon.textContent = active ? "⏹" : "🎙";
    if (micHint) micHint.textContent = active ? "Tap to stop" : "Tap to start speaking";
}

// --- Calculate local audio level ---
function calcLevel(int16Buffer) {
    const arr = new Int16Array(int16Buffer);
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
        sum += arr[i] * arr[i];
    }
    const rms = Math.sqrt(sum / arr.length);
    return Math.min(rms / 8000, 1);
}

// =========================================================================
// Permission Handling
// =========================================================================

/** Check current microphone permission state */
async function checkMicPermission() {
    // 1) Check if getUserMedia is even available
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        permissionState = "unavailable";
        return "unavailable";
    }

    // 2) Try the Permissions API (not supported in all browsers)
    try {
        const result = await navigator.permissions.query({ name: "microphone" });
        permissionState = result.state; // "granted", "denied", or "prompt"

        // Listen for changes (user changes setting in background)
        result.onchange = () => {
            permissionState = result.state;
            if (result.state === "granted") {
                hidePermissionModal();
                setStatus("Connected — Tap to speak", "connected");
                if (micHint) micHint.textContent = "Tap to start speaking";
            }
        };

        return result.state;
    } catch (e) {
        // Permissions API not supported — we'll find out when we try getUserMedia
        permissionState = "unknown";
        return "unknown";
    }
}

/** Show the permission modal with appropriate content */
function showPermissionModal(reason) {
    if (!permModal) return;

    const browser = getBrowser();

    if (reason === "denied") {
        // Permission was explicitly denied — show settings instructions
        modalTitle.textContent = "Microphone Access Blocked";
        modalDesc.textContent =
            "You previously denied microphone access. Please enable it in your browser settings to use BlueFlow.";
        modalSteps.style.display = "block";
        modalAllowBtn.textContent = "Try Again";

        // Show browser-specific steps
        showBrowserSteps(browser);

    } else if (reason === "unavailable") {
        // getUserMedia not available (insecure context or old browser)
        modalTitle.textContent = "Microphone Not Available";
        if (location.protocol !== "https:") {
            modalDesc.textContent =
                "Microphone access requires a secure HTTPS connection. Please use the HTTPS link shown on your PC's BlueFlow dashboard.";
            secureWarning.style.display = "flex";
        } else {
            modalDesc.textContent =
                "Your browser does not support microphone access. Please try using Chrome, Firefox, or Safari.";
        }
        modalSteps.style.display = "none";
        modalAllowBtn.textContent = "Retry";

    } else if (reason === "error") {
        // Some other error
        modalTitle.textContent = "Microphone Error";
        modalDesc.textContent =
            "Failed to access the microphone. Please check that no other app is using it, and try again.";
        modalSteps.style.display = "block";
        showBrowserSteps(browser);
        modalAllowBtn.textContent = "Try Again";

    } else {
        // First time — prompt the user
        modalTitle.textContent = "Microphone Permission Required";
        modalDesc.textContent =
            "BlueFlow needs access to your microphone to stream your voice to your PC. Tap 'Allow Microphone' and then grant permission in the browser popup.";
        modalSteps.style.display = "none";
        secureWarning.style.display = "none";
        modalAllowBtn.textContent = "Allow Microphone";
    }

    permModal.classList.add("visible");
}

/** Show browser-specific permission steps */
function showBrowserSteps(browser) {
    // Hide all steps first
    document.querySelectorAll(".modal-steps .step").forEach(s => (s.style.display = "none"));

    if (browser === "chrome" || browser === "edge" || browser === "samsung") {
        show("step-chrome");
        show("step-chrome-2");
        show("step-chrome-3");
        show("step-chrome-4");
    } else if (browser === "safari" || browser === "chrome-ios") {
        show("step-safari");
    } else {
        show("step-generic");
    }

    // Always show Android app-level permission hint on Android
    if (isAndroid()) {
        show("step-android-settings");
    }
}

function show(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = "flex";
}

function hidePermissionModal() {
    if (permModal) permModal.classList.remove("visible");
}

// =========================================================================
// WebSocket
// =========================================================================

function connectWebSocket() {
    const url = getWsUrl();
    ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
        setStatus("Connected — Tap to speak", "connected");
        console.log("WebSocket connected");
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.type === "transcription" && transcriptionEl) {
                if (msg.final) {
                    // Remove partial
                    const partial = document.getElementById("partial");
                    if (partial) partial.remove();
                    // Add final line
                    const p = document.createElement("p");
                    p.textContent = msg.text;
                    transcriptionEl.appendChild(p);
                    transcriptionEl.scrollTop = transcriptionEl.scrollHeight;
                } else {
                    let partial = document.getElementById("partial");
                    if (!partial) {
                        partial = document.createElement("p");
                        partial.id = "partial";
                        partial.className = "partial";
                        transcriptionEl.appendChild(partial);
                    }
                    partial.textContent = msg.text;
                    transcriptionEl.scrollTop = transcriptionEl.scrollHeight;
                }
            }
        } catch (e) {
            // ignore non-JSON
        }
    };

    ws.onclose = () => {
        setStatus("Disconnected", "disconnected");
        if (isStreaming) stopStreaming();
        setTimeout(connectWebSocket, 2000);
    };

    ws.onerror = () => {
        setStatus("Connection error", "error");
    };
}

// =========================================================================
// Audio Capture
// =========================================================================

async function startStreaming() {
    // 1) Check if getUserMedia exists at all
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showPermissionModal("unavailable");
        return;
    }

    // 2) Check permission state
    const perm = await checkMicPermission();
    if (perm === "denied") {
        showPermissionModal("denied");
        return;
    }

    try {
        setStatus("Requesting mic access...", "connecting");

        // Request microphone — this triggers the browser's native permission prompt
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: SAMPLE_RATE,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
        });

        // Permission granted! Update state
        permissionState = "granted";

        // Create AudioContext at 16kHz
        audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
        const source = audioContext.createMediaStreamSource(mediaStream);

        // Load AudioWorklet
        await audioContext.audioWorklet.addModule("/mobile/js/audio-processor.js");
        workletNode = new AudioWorkletNode(audioContext, "pcm-processor");

        workletNode.port.onmessage = (event) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(event.data);
                setLevel(calcLevel(event.data));
            }
        };

        source.connect(workletNode);
        workletNode.connect(audioContext.destination);

        setStreaming(true);
        setStatus("Streaming...", "streaming");

        // Remove stale partial
        const partial = document.getElementById("partial");
        if (partial) partial.remove();

    } catch (err) {
        console.error("Mic error:", err);

        // Determine the specific error reason
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
            // User clicked "Block" or permission was previously denied
            permissionState = "denied";
            showPermissionModal("denied");
            setStatus("Mic permission denied", "error");

        } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
            // No microphone hardware found
            setStatus("No microphone found on this device", "error");
            showPermissionModal("error");

        } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
            // Mic is in use by another app or hardware error
            setStatus("Mic busy — close other apps using it", "error");
            showPermissionModal("error");

        } else if (err.name === "OverconstrainedError") {
            // Requested constraints can't be satisfied — try simpler constraints
            try {
                mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                permissionState = "granted";
                audioContext = new AudioContext();
                const source = audioContext.createMediaStreamSource(mediaStream);
                await audioContext.audioWorklet.addModule("/mobile/js/audio-processor.js");
                workletNode = new AudioWorkletNode(audioContext, "pcm-processor");
                workletNode.port.onmessage = (event) => {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(event.data);
                        setLevel(calcLevel(event.data));
                    }
                };
                source.connect(workletNode);
                workletNode.connect(audioContext.destination);
                setStreaming(true);
                setStatus("Streaming...", "streaming");
            } catch (e2) {
                showPermissionModal("error");
                setStatus("Mic error", "error");
            }

        } else if (err.name === "SecurityError") {
            // Insecure context
            showPermissionModal("unavailable");
            setStatus("HTTPS required for microphone", "error");

        } else {
            // Unknown error
            showPermissionModal("error");
            setStatus("Mic error — see popup", "error");
        }
    }
}

function stopStreaming() {
    if (workletNode) {
        workletNode.disconnect();
        workletNode = null;
    }
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    if (mediaStream) {
        mediaStream.getTracks().forEach((t) => t.stop());
        mediaStream = null;
    }

    setStreaming(false);
    setLevel(0);
    setStatus("Connected — Tap to speak", "connected");
}

// =========================================================================
// Event Listeners
// =========================================================================

if (micBtn) {
    micBtn.addEventListener("click", async () => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            setStatus("Not connected to PC", "error");
            return;
        }
        if (isStreaming) {
            stopStreaming();
        } else {
            await startStreaming();
        }
    });
}

// Modal buttons
if (modalAllowBtn) {
    modalAllowBtn.addEventListener("click", async () => {
        hidePermissionModal();
        await startStreaming();
    });
}

if (modalCloseBtn) {
    modalCloseBtn.addEventListener("click", () => {
        hidePermissionModal();
    });
}

// Close modal on overlay click
if (permModal) {
    permModal.addEventListener("click", (e) => {
        if (e.target === permModal) hidePermissionModal();
    });
}

// =========================================================================
// Init
// =========================================================================
connectWebSocket();

// Pre-check mic permission on load (to show UI hints)
checkMicPermission().then((state) => {
    if (state === "denied") {
        if (micHint) micHint.textContent = "⚠︎ Mic blocked — tap for help";
        micBtn?.classList.add("warning");
    } else if (state === "unavailable") {
        if (micHint) micHint.textContent = "⚠︎ Mic not available";
    }
});
