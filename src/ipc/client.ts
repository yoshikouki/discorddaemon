import { SOCKET_PATH } from "../paths";
import {
  ConnectionRefusedError,
  type IpcRequest,
  type IpcResponse,
} from "./protocol";

const IPC_TIMEOUT_MS = 30_000; // 30s default, covers slow Discord API calls

/** Try to match a response line to the expected request ID. */
function tryParseResponse<T>(
  line: string,
  expectedId: string
): { matched: true; result?: T; error?: string } | { matched: false } {
  if (!line.trim()) {
    return { matched: false };
  }
  try {
    const response: IpcResponse = JSON.parse(line);
    if (response.id !== expectedId) {
      return { matched: false };
    }
    if (response.error) {
      return { matched: true, error: response.error };
    }
    return { matched: true, result: response.result as T };
  } catch {
    return { matched: false };
  }
}

/**
 * Low-level IPC call: sends a request to the daemon over a Unix socket
 * and returns the parsed response. Throws ConnectionRefusedError if the
 * socket cannot be reached, or Error if the daemon returns an error.
 */
export function ipcCall<T>(
  socketPath: string,
  request: IpcRequest,
  timeoutMs = IPC_TIMEOUT_MS
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let buffer = "";
    let settled = false;

    const settle = () => {
      settled = true;
    };

    const timeout = setTimeout(() => {
      if (!settled) {
        settle();
        reject(new Error(`IPC timeout after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    Bun.connect({
      unix: socketPath,
      socket: {
        open(socket) {
          socket.write(`${JSON.stringify(request)}\n`);
        },
        data(_socket, data) {
          if (settled) {
            return;
          }
          buffer += data.toString();
          const parts = buffer.split("\n");
          buffer = parts.pop() ?? "";

          for (const line of parts) {
            const parsed = tryParseResponse<T>(line, request.id);
            if (!parsed.matched) {
              continue;
            }
            settle();
            clearTimeout(timeout);
            if (parsed.error) {
              reject(new Error(parsed.error));
            } else {
              resolve(parsed.result as T);
            }
            _socket.end();
            return;
          }
        },
        error(_socket, error) {
          if (!settled) {
            settle();
            clearTimeout(timeout);
            reject(new ConnectionRefusedError(error.message));
          }
        },
        close() {
          if (!settled) {
            settle();
            clearTimeout(timeout);
            reject(new ConnectionRefusedError("Socket closed before response"));
          }
        },
      },
    }).catch((err: unknown) => {
      if (!settled) {
        settle();
        clearTimeout(timeout);
        const msg = err instanceof Error ? err.message : String(err);
        reject(new ConnectionRefusedError(msg));
      }
    });
  });
}

/**
 * High-level IPC client that wraps ipcCall with the default socket path.
 */
export class IpcClient {
  private readonly socketPath: string;

  constructor(socketPath?: string) {
    this.socketPath = socketPath ?? SOCKET_PATH;
  }

  call<T>(method: string, params: unknown): Promise<T> {
    const id = crypto.randomUUID();
    const request: IpcRequest = { id, method, params };
    return ipcCall<T>(this.socketPath, request);
  }
}
