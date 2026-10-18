import type { ClientToServerEvents, ServerToClientEvents } from '@quiz/shared';
import type { Server, Socket } from 'socket.io';

export interface SocketData {
  userId: number;
}

export type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export type IOSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
