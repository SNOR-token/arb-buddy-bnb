import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { Bot, Send, Settings2, Sparkles, User, Wrench } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { writeSettings, type BotSettings } from "@/hooks/useBotSettings";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const TOOL_LABELS: Record<string, string> = {
  "tool-get_market_snapshot": "Reading live quotes & opportunities",
  "tool-get_whale_swaps": "Scanning recent whale swaps",
  "tool-list_universe": "Listing tracked tokens & venues",
  "tool-update_bot_settings": "Adjusting bot settings",
};

interface Props {
  threadId: string;
  initialMessages: UIMessage[];
  onFirstMessage?: (text: string) => void;
}

export function AgentChat({ threadId, initialMessages, onFirstMessage }: Props) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const applied = useRef<Set<string>>(new Set());

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { threadId },
        headers: async () => {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
      }),
    [threadId],
  );

  const { messages, sendMessage, status } = useChat({
    id: threadId,
    messages: initialMessages,
    transport,
    onError: (error) =>
      toast.error("Agent error", { description: error.message.slice(0, 160) }),
  });

  const busy = status === "submitted" || status === "streaming";

  // Apply settings changes the agent requests through its tool.
  useEffect(() => {
    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type !== "tool-update_bot_settings") continue;
        const p = part as unknown as {
          toolCallId: string;
          state: string;
          output?: { applied?: Partial<BotSettings>; reason?: string };
        };
        if (p.state !== "output-available" || applied.current.has(p.toolCallId)) continue;
        applied.current.add(p.toolCallId);
        const patch = p.output?.applied;
        if (patch && Object.keys(patch).length > 0) {
          writeSettings(patch);
          toast.success("Bot settings updated by agent", {
            description: Object.entries(patch)
              .map(([k, v]) => `${k}: ${String(v)}`)
              .join(" · "),
          });
        }
      }
    }
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [threadId, status]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  const submit = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    if (messages.length === 0) onFirstMessage?.(text);
    await sendMessage({ text });
  };

  return (
    <div className="panel flex h-[calc(100vh-11rem)] flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Sparkles className="size-3.5 text-primary" />
        <h2 className="text-sm font-semibold tracking-wide">Arb agent</h2>
        <span className="text-[11px] text-muted-foreground">
          live quotes · whale swaps · bot control
        </span>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="space-y-2 text-xs text-muted-foreground">
            <p>Ask the agent to read the market or retune the bot. For example:</p>
            <ul className="list-disc space-y-1 pl-4 text-[11px]">
              <li>“Which pair has the best net spread right now?”</li>
              <li>“Any whale swaps in the last 200 blocks worth chasing?”</li>
              <li>“Set my min profit to 2 USDT and loan size to 20,000.”</li>
              <li>“Explain the risk of turning on auto-fire.”</li>
            </ul>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={cn("flex gap-2.5", message.role === "user" && "justify-end")}
          >
            {message.role === "assistant" && (
              <Bot className="mt-0.5 size-4 shrink-0 text-primary" />
            )}
            <div
              className={cn(
                "max-w-[85%] space-y-2 rounded-md px-3 py-2 text-xs leading-relaxed",
                message.role === "user"
                  ? "bg-primary/15 text-foreground"
                  : "border border-border bg-surface-2",
              )}
            >
              {message.parts.map((part, i) => {
                if (part.type === "text") {
                  return (
                    <div
                      key={i}
                      className="prose prose-invert prose-sm max-w-none text-xs [&_*]:text-xs"
                    >
                      <ReactMarkdown>{part.text}</ReactMarkdown>
                    </div>
                  );
                }
                if (part.type === "reasoning" && part.text) {
                  return (
                    <details key={i} className="text-[11px] text-muted-foreground">
                      <summary className="cursor-pointer">thinking</summary>
                      <p className="mt-1 whitespace-pre-wrap">{part.text}</p>
                    </details>
                  );
                }
                if (part.type.startsWith("tool-")) {
                  const label = TOOL_LABELS[part.type] ?? part.type.replace("tool-", "");
                  const Icon = part.type === "tool-update_bot_settings" ? Settings2 : Wrench;
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                    >
                      <Icon className="size-3 text-primary" />
                      {label}
                    </div>
                  );
                }
                return null;
              })}
            </div>
            {message.role === "user" && <User className="mt-0.5 size-4 shrink-0" />}
          </div>
        ))}

        {status === "submitted" && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Bot className="size-4 text-primary" />
            <span className="live-dot">agent is thinking…</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            rows={2}
            placeholder="Ask about spreads, whale swaps, or tell the agent to retune the bot…"
            className="min-h-[2.5rem] resize-none text-xs"
          />
          <Button
            onClick={() => void submit()}
            disabled={busy || !input.trim()}
            className="h-9 gap-1.5 text-xs"
          >
            <Send className="size-3" />
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
