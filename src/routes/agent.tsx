import { createFileRoute, Outlet, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { LogOut, MessageSquare, Plus, Terminal, Trash2 } from "lucide-react";

import { createThread, deleteThread, listThreads } from "@/lib/agent.functions";
import { useSession } from "@/hooks/useSession";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/agent")({
  head: () => ({
    meta: [
      { title: "Arb AI Agent — BNB Arb Terminal" },
      {
        name: "description",
        content:
          "Chat with a live AI agent that reads BNB Chain DEX quotes, whale swaps and arbitrage spreads, and retunes your flashloan bot on request.",
      },
      { property: "og:title", content: "Arb AI Agent — BNB Arb Terminal" },
      {
        property: "og:description",
        content:
          "A live AI co-pilot for BNB Chain arbitrage: reads quotes and whale swaps, then adjusts your bot settings.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AgentLayout,
});

function AgentLayout() {
  const { session, loading } = useSession();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { threadId?: string };
  const queryClient = useQueryClient();

  const list = useServerFn(listThreads);
  const create = useServerFn(createThread);
  const remove = useServerFn(deleteThread);

  useEffect(() => {
    if (!loading && !session) {
      void navigate({ to: "/auth", search: { next: "/agent" }, replace: true });
    }
  }, [loading, session, navigate]);

  const threads = useQuery({
    queryKey: ["agent-threads"],
    queryFn: () => list(),
    enabled: !!session,
  });

  const newThread = useMutation({
    mutationFn: () => create({ data: {} }),
    onSuccess: async (thread) => {
      await queryClient.invalidateQueries({ queryKey: ["agent-threads"] });
      void navigate({ to: "/agent/$threadId", params: { threadId: thread.id } });
    },
    onError: (error) => toast.error("Could not start a conversation", { description: error.message }),
  });

  const removeThread = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: async (_data, id) => {
      await queryClient.invalidateQueries({ queryKey: ["agent-threads"] });
      if (params.threadId === id) void navigate({ to: "/agent" });
    },
  });

  if (loading || !session) {
    return <p className="px-6 py-10 text-xs text-muted-foreground">Loading…</p>;
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-10 pt-5 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Arb AI Agent</h1>
          <p className="text-[11px] text-muted-foreground">
            Reads live quotes and whale swaps · retunes the bot on request
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/">
            <Button variant="secondary" className="h-8 gap-1.5 text-[11px]">
              <Terminal className="size-3" /> Terminal
            </Button>
          </Link>
          <Button
            variant="ghost"
            className="h-8 gap-1.5 text-[11px]"
            onClick={() => void supabase.auth.signOut()}
          >
            <LogOut className="size-3" /> Sign out
          </Button>
        </div>
      </header>

      <div className="mt-5 grid gap-4 lg:grid-cols-4">
        <aside className="panel lg:col-span-1">
          <div className="border-b border-border px-3 py-3">
            <Button
              onClick={() => newThread.mutate()}
              disabled={newThread.isPending}
              className="h-8 w-full gap-1.5 text-[11px]"
            >
              <Plus className="size-3" /> New conversation
            </Button>
          </div>
          <ul className="max-h-[60vh] divide-y divide-border/60 overflow-y-auto">
            {(threads.data ?? []).map((thread) => (
              <li
                key={thread.id}
                className={cn(
                  "flex items-center gap-1 px-2 py-1.5",
                  params.threadId === thread.id && "bg-primary/10",
                )}
              >
                <Link
                  to="/agent/$threadId"
                  params={{ threadId: thread.id }}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-[11px] hover:text-primary"
                >
                  <MessageSquare className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{thread.title}</span>
                </Link>
                <button
                  type="button"
                  aria-label={`Delete ${thread.title}`}
                  onClick={() => removeThread.mutate(thread.id)}
                  className="rounded p-1 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3" />
                </button>
              </li>
            ))}
            {threads.data?.length === 0 && (
              <li className="px-3 py-4 text-[11px] text-muted-foreground">
                No conversations yet.
              </li>
            )}
          </ul>
        </aside>

        <div className="lg:col-span-3">
          <Outlet />
        </div>
      </div>
    </main>
  );
}
