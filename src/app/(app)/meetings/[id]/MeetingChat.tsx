"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const SUGGESTIONS = [
  "What were the main decisions?",
  "What are the action items and owners?",
  "What risks or open questions came up?",
];

export function MeetingChat({ meetingId }: { meetingId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  async function ask(text: string) {
    const clean = text.trim();
    if (!clean || busy) return;
    const nextHistory = [...messages, { role: "user" as const, content: clean }];
    setMessages(nextHistory);
    setQuestion("");
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/meetings/${meetingId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: clean,
          history: messages.slice(-8),
        }),
      });
      const result = (await response.json()) as { answer?: string; error?: string };
      if (!response.ok) {
        throw new Error(result.error || "The meeting assistant could not answer.");
      }
      if (!result.answer) throw new Error("The assistant returned an empty answer.");
      setMessages([...nextHistory, { role: "assistant", content: result.answer }]);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The meeting assistant could not answer.",
      );
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(question);
  }

  return (
    <section className="card p-5" aria-label="Ask about this meeting">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-[var(--color-heading)]">
          Ask about this meeting
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Get answers grounded in the transcript and minutes.
        </p>
      </div>

      {messages.length > 0 ? (
        <div
          aria-live="polite"
          className="mb-4 max-h-[28rem] space-y-3 overflow-y-auto pr-1"
        >
          {messages.map((message, index) => (
            <div
              key={`${index}-${message.role}`}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[90%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  message.role === "user"
                    ? "rounded-br-md bg-[var(--color-elevated)] text-[var(--color-heading)]"
                    : "rounded-bl-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)]"
                }`}
              >
                {message.content}
              </div>
            </div>
          ))}
          {busy && (
            <p className="text-sm text-[var(--color-text-muted)]" role="status">
              Thinking about the meeting…
            </p>
          )}
          <div ref={bottomRef} />
        </div>
      ) : (
        <div className="mb-4 flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={busy}
              onClick={() => void ask(suggestion)}
              className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-left text-xs text-[var(--color-text-secondary)] transition hover:bg-[var(--color-elevated)] hover:text-[var(--color-heading)] disabled:opacity-50"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="mb-3 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}

      <form onSubmit={submit} className="flex items-end gap-2">
        <label className="sr-only" htmlFor={`meeting-question-${meetingId}`}>
          Ask a question about the meeting
        </label>
        <textarea
          id={`meeting-question-${meetingId}`}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void ask(question);
            }
          }}
          maxLength={1200}
          rows={2}
          placeholder="Ask anything about the discussion…"
          className="min-h-12 flex-1 resize-y rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)]"
        />
        <button
          type="submit"
          disabled={busy || !question.trim()}
          className="btn-primary shrink-0 px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Asking…" : "Ask"}
        </button>
      </form>
      <p className="mt-2 text-xs text-[var(--color-text-muted)]">
        Answers use this meeting&apos;s transcript and minutes. Unidentified speakers can be named in the Speakers tab. Press Enter to send, Shift+Enter for a new line.
      </p>
    </section>
  );
}
