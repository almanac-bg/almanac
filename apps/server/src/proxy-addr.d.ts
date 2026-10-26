// proxy-addr ships no types; this is the one call the server makes (the same Express makes for `req.ip`).
declare module 'proxy-addr' {
  import type { IncomingMessage } from 'node:http';

  function proxyaddr(req: IncomingMessage, trust: (addr: string, i: number) => boolean): string;
  export default proxyaddr;
}
