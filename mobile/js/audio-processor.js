/**
 * AudioWorklet processor — captures raw PCM Int16 audio from the microphone.
 * Runs in a dedicated audio thread for low-latency processing.
 */
class PCMProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._bufferSize = 2048;
        this._buffer = new Float32Array(this._bufferSize);
        this._writeIndex = 0;
    }

    process(inputs) {
        const input = inputs[0];
        if (!input || input.length === 0) return true;

        const channelData = input[0]; // mono
        if (!channelData) return true;

        for (let i = 0; i < channelData.length; i++) {
            this._buffer[this._writeIndex++] = channelData[i];

            if (this._writeIndex >= this._bufferSize) {
                // Convert Float32 [-1, 1] → Int16 [-32768, 32767]
                const int16 = new Int16Array(this._bufferSize);
                for (let j = 0; j < this._bufferSize; j++) {
                    const s = Math.max(-1, Math.min(1, this._buffer[j]));
                    int16[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
                this.port.postMessage(int16.buffer, [int16.buffer]);
                this._buffer = new Float32Array(this._bufferSize);
                this._writeIndex = 0;
            }
        }
        return true;
    }
}

registerProcessor("pcm-processor", PCMProcessor);
