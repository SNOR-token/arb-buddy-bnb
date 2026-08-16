import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/agent/")({
  component: () => (
    <div className="panel px-4 py-10 text-center text-xs text-muted-foreground">
      Start a new conversation or pick one from the list to chat with the arb agent.
    </div>
  ),
});
