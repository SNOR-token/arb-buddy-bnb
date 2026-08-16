import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { UIMessage } from "ai";

import { getThreadMessages, renameThread } from "@/lib/agent.functions";
import { AgentChat } from "@/components/AgentChat";

export const Route = createFileRoute("/agent/$threadId")({
  component: ThreadPage,
});

function ThreadPage() {
  const { threadId } = useParams({ from: "/agent/$threadId" });
  const load = useServerFn(getThreadMessages);
  const rename = useServerFn(renameThread);
  const queryClient = useQueryClient();

  const thread = useQuery({
    queryKey: ["agent-thread", threadId],
    queryFn: () => load({ data: { id: threadId } }),
  });

  if (thread.isLoading) {
    return (
      <div className="panel px-4 py-10 text-center text-xs text-muted-foreground">
        Loading conversation…
      </div>
    );
  }

  if (!thread.data) {
    return (
      <div className="panel px-4 py-10 text-center text-xs text-muted-foreground">
        This conversation was not found.
      </div>
    );
  }

  const initialMessages = JSON.parse(thread.data.messagesJson) as UIMessage[];

  return (
    <AgentChat
      key={threadId}
      threadId={threadId}
      initialMessages={initialMessages}
      onFirstMessage={(text) => {
        void rename({ data: { id: threadId, title: text.slice(0, 60) } }).then(() =>
          queryClient.invalidateQueries({ queryKey: ["agent-threads"] }),
        );
      }}
    />
  );
}
