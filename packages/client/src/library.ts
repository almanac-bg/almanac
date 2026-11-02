/**
 * The realtime library, a file of its own: fetched when someone signs in or plays as a guest (while that request is on
 * its way), not only after — on a slow line it sat on the path to the first connection. Apart from the connection
 * itself (realtime.ts), so the sign-in page can start this download without carrying the game's realtime code.
 */
let library: Promise<typeof import('socket.io-client')> | null = null;
export function loadRealtime() {
  library ??= import('socket.io-client').catch((err: unknown) => {
    library = null; // to be asked for again
    throw err;
  });
  return library;
}
