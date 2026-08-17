import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { api, type ChatMessage, type SessionEvent } from "../../api";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Badge } from "../../components/ui/badge";
import { messageOf } from "../domainViews";

interface LaunchForm {
  taskId: string;
  repositoryPath: string;
}

const STATUS_VARIANT: Record<string, "outline" | "secondary" | "destructive" | "default"> = {
  RUNNING: "default",
  COMPLETED: "secondary",
  FAILED: "destructive",
  ABORTED: "destructive",
};

export function ChatPane() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launch, setLaunch] = useState<LaunchForm>({ taskId: "", repositoryPath: "" });
  const streamRef = useRef<EventSource | null>(null);
  const lastEventIdRef = useRef(0);
  const hasThread = Boolean(sessionId || chatId);

  useEffect(() => {
    if (!chatId) return;
    let active = true;
    api
      .getAgentChatMessages(chatId)
      .then((res) => {
        if (!active) return;
        setMessages(
          res.messages.map((m) => ({
            id: m.id,
            sessionId: chatId,
            direction: m.direction,
            text: m.text,
            timestamp: m.timestamp,
          })),
        );
      })
      .catch((err) => {
        if (active) setError(messageOf(err));
      });

    const source = new EventSource(`/api/agent-chats/${chatId}/stream`);
    streamRef.current = source;
    source.onopen = () => setReconnecting(false);
    source.onmessage = (message) => {
      try {
        const payload = JSON.parse((message as MessageEvent).data as string) as {
          id: number;
          chatId: string;
          direction: "user" | "agent";
          text: string;
        };
        lastEventIdRef.current = payload.id;
        setMessages((prev) => [
          ...prev,
          {
            id: payload.id,
            sessionId: chatId,
            direction: payload.direction,
            text: payload.text,
            timestamp: new Date().toISOString(),
          },
        ]);
      } catch {
        // ignore malformed frames
      }
    };
    source.onerror = () => setReconnecting(true);
    return () => {
      active = false;
      source.close();
      streamRef.current = null;
    };
  }, [chatId]);

  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    api
      .getSessionMessages(sessionId)
      .then(async (res) => {
        if (!active) return;
        setMessages(res.messages);
        const session = await api.getSession(sessionId);
        setStatus(session.session.status);
      })
      .catch((err) => {
        if (active) setError(messageOf(err));
      });

    const source = new EventSource(`/api/sessions/${sessionId}/stream`);
    streamRef.current = source;
    source.onopen = () => setReconnecting(false);
    source.onmessage = (message) => {
      let payload: SessionEvent;
      try {
        payload = JSON.parse((message as MessageEvent).data as string) as SessionEvent;
      } catch {
        return;
      }
      lastEventIdRef.current = payload.id;
      if (payload.type === "user_message" || payload.type === "agent_message") {
        setMessages((prev) => [
          ...prev,
          {
            id: payload.id,
            sessionId,
            direction: payload.type === "agent_message" ? "agent" : "user",
            text: (payload.data?.text as string) ?? "",
            timestamp: new Date().toISOString(),
          },
        ]);
      } else {
        setEvents((prev) => [...prev, payload]);
      }
      if (["session_completed", "session_failed", "session_aborted"].includes(payload.type)) {
        setStatus(
          payload.type === "session_completed"
            ? "COMPLETED"
            : payload.type === "session_aborted"
              ? "ABORTED"
              : "FAILED",
        );
        source.close();
        streamRef.current = null;
      }
    };
    source.onerror = () => {
      setReconnecting(true);
    };
    return () => {
      active = false;
      source.close();
      streamRef.current = null;
    };
  }, [sessionId]);

  async function startRun() {
    if (!launch.taskId.trim() || !launch.repositoryPath.trim()) return;
    setError(null);
    setEvents([]);
    setMessages([]);
    setStatus(null);
    try {
      const started = await api.startSession({
        taskId: launch.taskId.trim(),
        repositoryPath: launch.repositoryPath.trim(),
      });
      setSessionId(started.sessionId);
      toast.success("Agent run started");
    } catch (err) {
      setError(messageOf(err));
      toast.error(messageOf(err));
    }
  }

  async function startChat() {
    setError(null);
    setEvents([]);
    setMessages([]);
    setStatus(null);
    setSessionId(null);
    try {
      const { chat } = await api.createAgentChat({});
      setChatId(chat.id);
      toast.success("New chat started");
    } catch (err) {
      setError(messageOf(err));
      toast.error(messageOf(err));
    }
  }

  async function send() {
    const text = composer.trim();
    if (!text || sending || !hasThread) return;
    setSending(true);
    setComposer("");
    try {
      if (chatId) {
        await api.sendAgentChatMessage(chatId, text);
      } else if (sessionId) {
        await api.sendSessionMessage(sessionId, text);
      }
    } catch (err) {
      setError(messageOf(err));
      toast.error(messageOf(err));
      setComposer(text);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-medium">Agent chat</span>
        <div className="flex items-center gap-2">
          {status && <Badge variant={STATUS_VARIANT[status] ?? "secondary"}>{status}</Badge>}
          <Button variant="outline" size="sm" onClick={() => void startChat()}>
            New chat
          </Button>
        </div>
      </div>

      {!hasThread ? (
        <div className="space-y-2 p-3">
          <p className="text-xs text-muted-foreground">
            Start a task run to stream the agent thought process and chat with it live.
          </p>
          <label className="block">
            <span className="text-xs font-medium">Task id</span>
            <Input
              value={launch.taskId}
              onChange={(e) => setLaunch((prev) => ({ ...prev, taskId: e.target.value }))}
              placeholder="task id"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Repository path</span>
            <Input
              value={launch.repositoryPath}
              onChange={(e) => setLaunch((prev) => ({ ...prev, repositoryPath: e.target.value }))}
              placeholder="/path/to/repo"
            />
          </label>
          <Button
            className="w-full"
            onClick={() => void startRun()}
            disabled={!launch.taskId.trim() || !launch.repositoryPath.trim()}
          >
            Start run
          </Button>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-auto p-3">
            {reconnecting && (
              <p className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Reconnecting…
              </p>
            )}
            <div className="space-y-2">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs",
                    message.direction === "user"
                      ? "ml-auto bg-primary text-primary-foreground"
                      : "bg-muted",
                  )}
                >
                  {message.text}
                </div>
              ))}
            </div>
            {events.length > 0 && (
              <div className="mt-3 border-t border-border pt-2">
                <p className="mb-1 text-xs font-medium text-muted-foreground">Transcript</p>
                <ul className="space-y-1">
                  {events.map((event) => (
                    <li key={event.id} className="text-xs text-muted-foreground">
                      <span className="text-muted-foreground/70">[{event.type}]</span>{" "}
                      {event.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="border-t border-border p-2">
            <div className="flex items-end gap-2">
              <Textarea
                rows={1}
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="Message the agent…"
                aria-label="Chat message"
                disabled={
                  !!sessionId &&
                  (status === "COMPLETED" || status === "FAILED" || status === "ABORTED")
                }
              />
              <Button
                size="icon"
                onClick={() => void send()}
                disabled={!composer.trim() || sending || (!!sessionId && status !== "RUNNING")}
                aria-label="Send message"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {error && (
            <p className="border-t border-border px-3 py-1 text-xs text-destructive">{error}</p>
          )}
        </>
      )}
    </div>
  );
}
