type SignalMessage = {
  type: string;
  topic?: string;
  topics?: unknown;
  data?: unknown;
  clients?: number;
};

type SessionState = {
  topics: Set<string>;
};

type SerializedSessionState = {
  topics: string[];
};

type Env = {
  SIGNAL_BROKER: DurableObjectNamespace;
};

function isTopicList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function tryParseMessage(rawMessage: string | ArrayBuffer | ArrayBufferView): SignalMessage | null {
  const text =
    typeof rawMessage === "string"
      ? rawMessage
      : rawMessage instanceof ArrayBuffer
        ? new TextDecoder().decode(rawMessage)
        : new TextDecoder().decode(
            new Uint8Array(rawMessage.buffer, rawMessage.byteOffset, rawMessage.byteLength),
          );

  try {
    const parsed = JSON.parse(text) as SignalMessage;
    if (!parsed || typeof parsed.type !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function toAttachment(state: SessionState): SerializedSessionState {
  return { topics: Array.from(state.topics) };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.headers.get("Upgrade") === "websocket") {
      const brokerId = env.SIGNAL_BROKER.idFromName("global");
      const broker = env.SIGNAL_BROKER.get(brokerId);
      return broker.fetch("https://signal.internal/websocket", request);
    }

    return new Response("Subscript Write signaling worker is running", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};

export class SignalBroker implements DurableObject {
  private sessions = new Map<WebSocket, SessionState>();
  private topics = new Map<string, Set<WebSocket>>();
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;

    for (const ws of state.getWebSockets()) {
      const serialized = ws.deserializeAttachment() as SerializedSessionState | null;
      const state: SessionState = { topics: new Set(serialized?.topics ?? []) };
      this.sessions.set(ws, state);
      for (const topic of state.topics) {
        this.subscribeSocket(ws, topic);
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    this.sessions.set(server, { topics: new Set() });
    server.serializeAttachment({ topics: [] } satisfies SerializedSessionState);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, rawMessage: string | ArrayBuffer | ArrayBufferView) {
    const message = tryParseMessage(rawMessage);
    if (!message) {
      ws.close(1003, "Invalid signaling payload");
      this.disconnect(ws);
      return;
    }

    switch (message.type) {
      case "subscribe": {
        if (!isTopicList(message.topics)) {
          return;
        }

        const session = this.ensureSession(ws);
        for (const topic of message.topics) {
          session.topics.add(topic);
          this.subscribeSocket(ws, topic);
        }
        ws.serializeAttachment(toAttachment(session));
        return;
      }
      case "unsubscribe": {
        if (!isTopicList(message.topics)) {
          return;
        }

        const session = this.ensureSession(ws);
        for (const topic of message.topics) {
          session.topics.delete(topic);
          this.unsubscribeSocket(ws, topic);
        }
        ws.serializeAttachment(toAttachment(session));
        return;
      }
      case "publish": {
        if (typeof message.topic !== "string") {
          return;
        }

        const receivers = this.topics.get(message.topic);
        if (!receivers || receivers.size === 0) {
          return;
        }

        const outbound = JSON.stringify({
          ...message,
          clients: receivers.size,
        });
        for (const receiver of receivers) {
          receiver.send(outbound);
        }
        return;
      }
      case "ping": {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }
      default:
        return;
    }
  }

  webSocketClose(ws: WebSocket) {
    this.disconnect(ws);
  }

  webSocketError(ws: WebSocket) {
    this.disconnect(ws);
  }

  private ensureSession(ws: WebSocket): SessionState {
    const existing = this.sessions.get(ws);
    if (existing) {
      return existing;
    }

    const state = { topics: new Set<string>() };
    this.sessions.set(ws, state);
    return state;
  }

  private subscribeSocket(ws: WebSocket, topic: string) {
    let sockets = this.topics.get(topic);
    if (!sockets) {
      sockets = new Set();
      this.topics.set(topic, sockets);
    }
    sockets.add(ws);
  }

  private unsubscribeSocket(ws: WebSocket, topic: string) {
    const sockets = this.topics.get(topic);
    if (!sockets) {
      return;
    }

    sockets.delete(ws);
    if (sockets.size === 0) {
      this.topics.delete(topic);
    }
  }

  private disconnect(ws: WebSocket) {
    const session = this.sessions.get(ws);
    if (!session) {
      return;
    }

    for (const topic of session.topics) {
      this.unsubscribeSocket(ws, topic);
    }
    this.sessions.delete(ws);
  }
}
