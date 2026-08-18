import { useEffect, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { UIMessage } from "ai";
import { LogIn, Plus, Sparkles } from "lucide-react";

import { createThread, getThreadMessages, listThreads, renameThread } from "@/lib/agent.functions";
import { useSession } from "@/hooks/useSession";
import { AgentChat } from "@/components/AgentChat";
import { Button } from "@/components/ui/button";

const HEIGHT = "h-[calc(100vh-9rem)] min-h-[520px]";

/**
 * The live arb agent, embedded in the terminal's right-hand column. It reuses
 * the same persisted threads as the full-page agent view.
 */
export function AgentSidebar() {
  const { session, loading } = useSession();
  const list = useServerFn(listThreads);
  const create = useServerFn(createThread);
  const load = useServerFn(getThreadMessages);
  const rename = useServerFn(renameThread);
  const queryClient = useQueryClient();

  const threads = useQuery({
    queryKey: ["agent-threads"],
    queryFn: () => list(),
    enabled: !!session,
  });

  const newThread = useMutation({
    mutationFn: () => create({ data: {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agent-threads"] }),
  });

  // Always keep one live thread available in the sidebar.
  useEffect(() => {
    if (!session || !threads.isSuccess) return;
    if ((threads.data?.length ?? 0) === 0 && !newThread.isPending) newThread.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, threads.isSuccess, threads.data?.length]);

  const threadId = threads.data?.[0]?.id ?? null;

  const thread = useQuery({
    queryKey: ["agent-thread", threadId],
    queryFn: () => load({ data: { id: threadId! } }),
    enabled: !!threadId,
  });

  const initialMessages = useMemo<UIMessage[]>(() => {
    if (!thread.data) return [];
    try {
      return JSON.parse(thread.data.messagesJson) as UIMessage[];
    } catch {
      return [];
    }
  }, [thread.data]);

  if (loading) {
    return <Shell>Loading agent…</Shell>;
  }

  if (!session) {
    return (
      <Shell>
        <p className="mb-3">
          Sign in to chat with the arb agent. It reads live quotes and whale swaps and can retune
          this bot for you.
        </p>
        <Link to="/auth" search={{ next: "/" }}>
          <Button className="h-8 w-full gap-1.5 text-[11px]">
            <LogIn className="size-3" /> Sign in to the agent
          </Button>
        </Link>
      </Shell>
    );
  }

  if (!threadId || thread.isLoading) {
    return <Shell>Opening conversation…</Shell>;
  }

  return (
    <div className="space-y-2">
      <AgentChat
        key={threadId}
        threadId={threadId}
        initialMessages={initialMessages}
        heightClass={HEIGHT}
        compact
        onFirstMessage={(text) => {
          void rename({ data: { id: threadId, title: text.slice(0, 60) } }).then(() =>
            queryClient.invalidateQueries({ queryKey: ["agent-threads"] }),
          );
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="secondary"
          className="h-7 gap-1.5 text-[10px]"
          disabled={newThread.isPending}
          onClick={() => newThread.mutate()}
        >
          <Plus className="size-3" /> New chat
        </Button>
        <Link to="/agent" className="text-[10px] text-primary hover:underline">
          All conversations
        </Link>
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className={`panel flex flex-col ${HEIGHT}`}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-3">
        <Sparkles className="size-3.5 text-primary" />
        <h2 className="text-sm font-semibold tracking-wide">Arb agent</h2>
      </div>
      <div className="px-3 py-4 text-[11px] leading-relaxed text-muted-foreground">{children}</div>
    </div>
  );
}
