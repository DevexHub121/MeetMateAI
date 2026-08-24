"use client";

import { getLiveTranscriptionToken } from "../actions";

// ─────────────────────────────────────────────────────────────────────────────
// Live captions while a meeting records.
//
// This is DISPLAY-ONLY and deliberately throwaway. The authoritative transcript
// still comes from the batch pass over the finished file (see lib/deepgram.ts),
// because streaming diarization only offers diarize_model latest|v1 — there's no
// v2 on the socket — and our buildTurns/smoothSpeakers cleanup needs the whole
// word stream. So live speaker labels ARE worse than the ones you'll see on the
// Transcript tab afterwards. Nothing here is persisted.
//
// We talk to Deepgram with a plain WebSocket rather than the SDK's
// listen.v1.connect(): the SDK passes credentials as an Authorization *header*,
// which a browser can't set on a WebSocket handshake. The browser-supported
// path is the Sec-WebSocket-Protocol subprotocol (see connect() below). Using
// the raw socket also keeps the whole SDK out of the client bundle.
// ─────────────────────────────────────────────────────────────────────────────

const DEEPGRAM_WS = "wss://api.deepgram.com/v1/listen";

const PARAMS: Record<string, string> = {
  model: "nova-3",
  // Same code-switched English/Hindi as the batch pass. nova-3 does support
  // language=multi on streaming, and Deepgram recommends endpointing=100
  // specifically for code-switching.
  language: "multi",
  endpointing: "100",
  smart_format: "true",
  punctuate: "true",
  interim_results: "true",
  utterance_end_ms: "1000",
  diarize: "true",
};

/** How often the feed recorder hands us a chunk. Trades latency for overhead. */
const FEED_MS = 150;
/** Keep the socket alive if the feed stalls; Deepgram closes on prolonged silence. */
const KEEPALIVE_MS = 5000;
const MAX_RETRIES = 8;
/**
 * Cap retained captions so a three-hour meeting can't grow without bound. These
 * are display-only and every line is re-rendered on each update, so the cap is
 * a render budget as much as a memory one — the full record lives on the
 * Transcript tab.
 */
const MAX_LINES = 80;
/**
 * Floor on the gap between renders. Deepgram revises an interim line several
 * times a second and each update re-renders the whole caption list, which was
 * enough to visibly jank the recorder. Coalescing on a leading edge keeps the
 * first word of an utterance immediate and only rate-limits the revisions.
 */
const EMIT_MS = 120;

export type LiveState =
  | "connecting"
  | "listening"
  | "reconnecting"
  /** This browser can't produce a stream Deepgram can read (Safari's fMP4). */
  | "unsupported"
  /** Deepgram wouldn't issue a token — a server-side/credential problem. */
  | "not-configured"
  /** Connected but kept dropping, or gave up retrying. */
  | "unavailable";

export type LiveLine = {
  /** 0 for the in-progress line, which is replaced on every update. */
  id: number;
  speaker: string | null;
  text: string;
  final: boolean;
};

export type LiveTranscriber = { stop: () => void };

/**
 * Deepgram parses a container stream incrementally, so MediaRecorder output can
 * go straight down the socket — but only for containers it can parse that way.
 * Safari's fragmented MP4 isn't one, so we don't pretend to support it.
 */
export function liveCaptionsSupportMime(mime: string): boolean {
  return mime.includes("webm") || mime.includes("ogg");
}

type ResultsMessage = {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: {
    alternatives?: { transcript?: string; words?: { speaker?: number }[] }[];
  };
};

// Diarization labels individual words, and a single caption line can straddle a
// handover. Attributing the line to whoever said most of it is about as much as
// live diarization can honestly support.
function dominantSpeaker(words?: { speaker?: number }[]): string | null {
  if (!words || words.length === 0) return null;
  const counts = new Map<number, number>();
  for (const w of words) {
    if (typeof w.speaker !== "number") continue;
    counts.set(w.speaker, (counts.get(w.speaker) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [speaker, n] of counts) {
    if (n > bestCount) {
      best = speaker;
      bestCount = n;
    }
  }
  return best === null ? null : `Speaker ${best}`;
}

export function startLiveTranscriber(opts: {
  meetingId: string;
  /** The same mixed stream the real recorder uses. */
  stream: MediaStream;
  mimeType: string;
  onLines: (lines: LiveLine[]) => void;
  onState: (state: LiveState) => void;
}): LiveTranscriber {
  let stopped = false;
  let ws: WebSocket | null = null;
  let feed: MediaRecorder | null = null;
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let retries = 0;
  let lastMediaAt = 0;

  // Committed lines, plus the utterance currently being assembled. Deepgram
  // sends interim guesses, then is_final segments, then speech_final to mark the
  // end of an utterance — so a line is "pending" until speech_final/UtteranceEnd.
  const committed: LiveLine[] = [];
  let pending = "";
  let pendingSpeaker: string | null = null;
  let interim = "";
  let nextId = 1;

  let emitTimer: ReturnType<typeof setTimeout> | null = null;
  let lastEmitAt = 0;

  const flushLines = () => {
    emitTimer = null;
    lastEmitAt = Date.now();
    const inProgress = `${pending} ${interim}`.trim();
    opts.onLines(
      inProgress
        ? [
            ...committed,
            { id: 0, speaker: pendingSpeaker, text: inProgress, final: false },
          ]
        : [...committed],
    );
  };

  // Leading-edge throttle. A flush that's already scheduled will read whatever
  // state exists when it fires, so there's nothing to queue — the newest text
  // always wins and intermediate revisions are simply never painted.
  const emit = () => {
    if (emitTimer) return;
    const since = Date.now() - lastEmitAt;
    if (since >= EMIT_MS) {
      flushLines();
      return;
    }
    emitTimer = setTimeout(flushLines, EMIT_MS - since);
  };

  const commit = () => {
    const text = pending.trim();
    const speaker = pendingSpeaker;
    pending = "";
    pendingSpeaker = null;
    interim = "";
    if (!text) return;
    committed.push({ id: nextId++, speaker, text, final: true });
    if (committed.length > MAX_LINES) {
      committed.splice(0, committed.length - MAX_LINES);
    }
  };

  const handleMessage = (raw: unknown) => {
    if (typeof raw !== "string") return;
    let msg: ResultsMessage;
    try {
      msg = JSON.parse(raw) as ResultsMessage;
    } catch {
      return;
    }

    if (msg.type === "UtteranceEnd") {
      commit();
      emit();
      return;
    }
    if (msg.type !== "Results") return;

    const alt = msg.channel?.alternatives?.[0];
    const text = alt?.transcript?.trim() ?? "";
    if (!text) {
      // An empty final is just a pause — don't wipe what's already on screen.
      if (msg.speech_final) {
        commit();
        emit();
      }
      return;
    }

    const speaker = dominantSpeaker(alt?.words);
    if (msg.is_final) {
      // A speaker handover mid-utterance breaks the line, so two voices never
      // get glued into one caption.
      if (pending && speaker && pendingSpeaker && speaker !== pendingSpeaker) {
        commit();
      }
      pending = pending ? `${pending} ${text}` : text;
      pendingSpeaker = pendingSpeaker ?? speaker;
      interim = "";
      if (msg.speech_final) commit();
    } else {
      interim = text;
    }
    emit();
  };

  // Tear down the socket and its feed without ending the session — used between
  // reconnects as well as on stop().
  const detach = () => {
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
    if (feed) {
      feed.ondataavailable = null;
      if (feed.state !== "inactive") {
        try {
          feed.stop();
        } catch {
          // already gone
        }
      }
      feed = null;
    }
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        ws.close();
      } catch {
        // already closing
      }
      ws = null;
    }
  };

  // A second MediaRecorder on the same stream, at a much smaller timeslice. The
  // real recorder (5s chunks → Spaces) is left completely alone: that's the path
  // that produces the file we actually keep, and captions must not be able to
  // break it.
  //
  // Started per connection, not per session — the container header only appears
  // in the first chunk, so a reconnected socket needs a fresh recorder or
  // Deepgram sees a headerless stream.
  const startFeed = (socket: WebSocket) => {
    try {
      const recorder = new MediaRecorder(opts.stream, {
        mimeType: opts.mimeType,
        audioBitsPerSecond: 32000,
      });
      recorder.ondataavailable = (e) => {
        if (!e.data || e.data.size === 0) return;
        if (socket.readyState !== WebSocket.OPEN) return;
        lastMediaAt = Date.now();
        socket.send(e.data);
      };
      recorder.start(FEED_MS);
      feed = recorder;
      return true;
    } catch {
      return false;
    }
  };

  const scheduleReconnect = () => {
    detach();
    if (stopped) return;
    if (retries >= MAX_RETRIES) {
      opts.onState("unavailable");
      return;
    }
    const delay = Math.min(1000 * 2 ** retries, 15000);
    retries += 1;
    opts.onState("reconnecting");
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!stopped) void connect();
    }, delay);
  };

  const connect = async () => {
    if (stopped) return;

    // A fresh token per connection. They're short-lived by design, and this way
    // a reconnect an hour into the meeting is no different from the first one.
    let token: string;
    try {
      const result = await getLiveTranscriptionToken(opts.meetingId);
      if (stopped) return;
      if (!result.ok) {
        // Nothing to retry against: no credential means no socket, and that
        // won't change mid-meeting. Say so instead of looping on backoff.
        console.warn(`[live-captions] no token (${result.reason})`);
        opts.onState("not-configured");
        return;
      }
      token = result.token;
    } catch (err) {
      if (stopped) return;
      console.warn("[live-captions] token request failed", err);
      opts.onState("not-configured");
      return;
    }

    // Auth goes in the WebSocket subprotocol, not the URL. A browser can't set
    // an Authorization header on a handshake, and ?access_token= is rejected
    // with a 401 — verified against the live API, which refuses the query
    // parameter but accepts the same credential as a subprotocol. The two
    // flavours mirror the header schemes: ["token", apiKey] for a raw API key,
    // ["bearer", jwt] for a temporary token, which is what we have.
    //
    // Keeping it out of the URL is worth having anyway: query strings end up in
    // logs and in the browser's own error messages.
    const socket = new WebSocket(`${DEEPGRAM_WS}?${new URLSearchParams(PARAMS)}`, [
      "bearer",
      token,
    ]);
    ws = socket;

    socket.onopen = () => {
      if (stopped) {
        try {
          socket.close();
        } catch {
          // ignore
        }
        return;
      }
      retries = 0;
      lastMediaAt = Date.now();
      if (!startFeed(socket)) {
        stopped = true;
        opts.onState("unavailable");
        detach();
        return;
      }
      opts.onState("listening");
      keepAliveTimer = setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) return;
        if (Date.now() - lastMediaAt < KEEPALIVE_MS - 1000) return;
        try {
          socket.send(JSON.stringify({ type: "KeepAlive" }));
        } catch {
          // the close handler will pick this up
        }
      }, KEEPALIVE_MS);
    };

    socket.onmessage = (e) => handleMessage(e.data);
    // Errors are always followed by a close, which is where we retry.
    socket.onerror = () => {};
    socket.onclose = () => {
      if (stopped) return;
      scheduleReconnect();
    };
  };

  opts.onState("connecting");
  void connect();

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      // Paint whatever the throttle was still holding, so the last thing said
      // doesn't vanish at the moment the meeting ends.
      if (emitTimer) {
        clearTimeout(emitTimer);
        flushLines();
      }
      // Let Deepgram flush anything it's still holding before we drop the socket.
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "CloseStream" }));
        } catch {
          // ignore
        }
      }
      detach();
    },
  };
}
