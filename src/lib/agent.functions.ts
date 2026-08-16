import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { UIMessage } from "ai";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface AgentThread {
  id: string;
  title: string;
  updatedAt: string;
}

export const listThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("agent_threads")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map<AgentThread>((t) => ({
      id: t.id,
      title: t.title,
      updatedAt: t.updated_at,
    }));
  });

export const createThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { title?: string } | undefined) =>
    z.object({ title: z.string().max(120).optional() }).parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase
      .from("agent_threads")
      .insert({ user_id: context.userId, title: data.title ?? "New conversation" })
      .select("id, title, updated_at")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Could not create conversation");
    return { id: row.id, title: row.title, updatedAt: row.updated_at } satisfies AgentThread;
  });

export const renameThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; title: string }) =>
    z.object({ id: z.string().uuid(), title: z.string().min(1).max(120) }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("agent_threads")
      .update({ title: data.title })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("agent_threads").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getThreadMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { data: thread, error: threadError } = await context.supabase
      .from("agent_threads")
      .select("id, title")
      .eq("id", data.id)
      .maybeSingle();
    if (threadError) throw new Error(threadError.message);
    if (!thread) return null;

    const { data: rows, error } = await context.supabase
      .from("agent_messages")
      .select("id, client_id, role, parts, created_at")
      .eq("thread_id", data.id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const messages = (rows ?? []).map((row) => ({
      id: row.client_id ?? row.id,
      role: row.role as UIMessage["role"],
      parts: (row.parts ?? []) as UIMessage["parts"],
    })) as UIMessage[];

    return { id: thread.id, title: thread.title, messages };
  });
