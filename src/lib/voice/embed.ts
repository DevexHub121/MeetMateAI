/**
 * Speaker embeddings, computed in the browser.
 *
 * The model runs here rather than on the server for one hard reason: the server
 * cannot decode the audio. Recordings are Opus-in-WebM and the deploy is a Node
 * buildpack with no ffmpeg, so there is nothing to turn a stored file into PCM.
 * The browser already holds decoded PCM in its Web Audio graph while recording,
 * so the embedding is computed at the point the samples exist and only the
 * 256-float vector is uploaded — about 1 KB per window.
 *
 * Model: WeSpeaker ResNet34-LM (CC-BY-4.0), the same embedding model pyannote's
 * open-source diarization uses. Vendored under /models so nothing is fetched
 * from a CDN at runtime; the q8 build is 6 MB and measured no less accurate than
 * fp32 (separation margin 0.431 vs 0.427) while loading ~4x faster.
 *
 * Client-only — never import this from server code.
 */

export const EMBED_MODEL_ID = "onnx-community/wespeaker-voxceleb-resnet34-LM";
export const EMBED_MODEL_DTYPE = "q8";
/** Recorded on each profile so a later model change is detectable. */
export const EMBED_MODEL_NAME = `${EMBED_MODEL_ID}@${EMBED_MODEL_DTYPE}`;

export const SAMPLE_RATE = 16000;
/**
 * The model needs enough speech to characterise a voice. Below ~1s embeddings
 * get unstable; ~2s is the point where they settle without costing much CPU.
 */
export const MIN_WINDOW_SECONDS = 1.5;

type Extractor = {
  processor: (audio: Float32Array) => Promise<unknown>;
  model: (inputs: unknown) => Promise<Record<string, { data: ArrayLike<number> }>>;
};

let loading: Promise<Extractor> | null = null;

/**
 * Load the model once per page. Imported dynamically so the ~13 MB library is
 * never part of the initial bundle and never evaluated during SSR.
 */
function load(): Promise<Extractor> {
  if (loading) return loading;
  loading = (async () => {
    const { AutoModel, AutoProcessor, env } = await import(
      "@huggingface/transformers"
    );

    // Serve everything from our own origin. The default would pull the model
    // from the Hugging Face CDN and the wasm from a jsdelivr URL pinned to ORT's
    // exact version — which, for the dev build shipped with transformers.js,
    // isn't published at all.
    // Both flags matter: the browser build defaults allowLocalModels to false,
    // so turning off remote without turning on local disables every source.
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    env.localModelPath = "/models/";
    if (env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.wasmPaths = "/ort/";
    }

    const [processor, model] = await Promise.all([
      AutoProcessor.from_pretrained(EMBED_MODEL_ID),
      AutoModel.from_pretrained(EMBED_MODEL_ID, { dtype: EMBED_MODEL_DTYPE }),
    ]);
    return {
      processor: (audio) => processor(audio),
      model: (inputs) => model(inputs),
    } as Extractor;
  })().catch((err) => {
    // Don't cache a failed load — a retry should be able to succeed.
    loading = null;
    throw err;
  });
  return loading;
}

/** Fetch and compile ahead of time, so the first real window isn't slow. */
export async function warmUp(): Promise<void> {
  await load();
}

/** True once the model is resident, for UI that wants to wait before recording. */
export function isReady(): boolean {
  return loading !== null;
}

/**
 * Embed one window of 16 kHz mono PCM into a unit-length 256-float vector.
 *
 * The model's raw output is NOT unit length (measured L2 norm ~2.0), so this
 * normalises before returning — every consumer, including pgvector's cosine
 * operator, assumes comparable vectors.
 */
export async function embed(pcm16k: Float32Array): Promise<number[]> {
  if (pcm16k.length < SAMPLE_RATE * MIN_WINDOW_SECONDS) {
    throw new Error(
      `window too short: ${(pcm16k.length / SAMPLE_RATE).toFixed(2)}s`,
    );
  }
  const { processor, model } = await load();
  const inputs = await processor(pcm16k);
  const out = await model(inputs);

  // WeSpeakerResNetModel returns the embedding as `last_hidden_state` [1, 256].
  const tensor = out.last_hidden_state ?? Object.values(out)[0];
  if (!tensor?.data) throw new Error("model returned no embedding");

  const raw = Array.from(tensor.data as ArrayLike<number>, Number);
  let sum = 0;
  for (const x of raw) sum += x * x;
  const norm = Math.sqrt(sum);
  if (!norm || !Number.isFinite(norm)) {
    throw new Error("model returned a degenerate embedding");
  }
  return raw.map((x) => x / norm);
}

/**
 * Decode any audio the browser understands into 16 kHz mono PCM.
 *
 * OfflineAudioContext does the resampling, which is why no decoder ships with
 * the app: webm/opus, mp4/aac, mp3 and wav are all handled natively. Memory is
 * the limit rather than format — decoded PCM is ~115 MB per hour at 16 kHz — so
 * callers working with long recordings should be selective about what they
 * decode.
 */
export async function decodeTo16kMono(
  data: ArrayBuffer,
): Promise<Float32Array> {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;

  const tmp = new AudioCtx();
  let decoded: AudioBuffer;
  try {
    decoded = await tmp.decodeAudioData(data);
  } finally {
    void tmp.close();
  }

  const frames = Math.ceil(decoded.duration * SAMPLE_RATE);
  const offline = new OfflineAudioContext(1, frames, SAMPLE_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

/** Root-mean-square level of a window — cheap gate for "is anything here". */
export function rms(pcm: Float32Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / pcm.length);
}
