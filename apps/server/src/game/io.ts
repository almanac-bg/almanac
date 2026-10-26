import type { ClientToServerEvents, ServerToClientEvents } from '@quiz/shared';
import type { Server, Socket } from 'socket.io';

export interface SocketData {
  userId: number;
  /** Hash of the login session's token (logout disconnects that session's sockets). */
  session: string;
  /** The visitor's network (IPv4 address or IPv6 /64), for limits that guests can't sidestep. */
  network: string;
}

export type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export type IOSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
