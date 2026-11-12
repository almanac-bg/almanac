// Talking to the server: JSON in, JSON out, and errors a player can read.

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export async function api<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  if (body === undefined && method !== "GET") body = {};
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError("offline", "Няма връзка със сървъра. Провери интернета си и опитай пак.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(data?.error ?? "server", data?.message ?? "Нещо се обърка при нас. Опитай пак.", res.status);
  }
  return data as T;
}
