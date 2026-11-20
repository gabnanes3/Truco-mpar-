// An in-process network for tests (and for demos without a broker): rooms and connections that behave like
// the real thing where it hurts. Delivery is asynchronous on the injected clock, every message is copied
// through JSON, `close()` loses what is still in flight, links can die silently and a host can vanish.

/** @typedef {import('./env.js').Clock} Clock */
/** @typedef {import('./transport.js').Transport} Transport */
/** @typedef {import('./transport.js').Connection} Connection */
/** @typedef {import('./transport.js').ListenHandlers} ListenHandlers */

/**
 * One message put on the wire.
 * @typedef {Object} SentMessage
 * @property {string} from label of the sending device
 * @property {string} to label of the receiving device
 * @property {unknown} message the JSON copy that travels
 */
/**
 * @typedef {Object} Link
 * @property {boolean} open
 * @property {string} code
 * @property {string} guest label of the guest device
 * @property {string} host label of the host device
 * @property {Connection} guestEnd
 * @property {Connection} hostEnd
 */
/**
 * @typedef {Object} Room
 * @property {string} owner label of the hosting device
 * @property {ListenHandlers} handlers
 */

export class MemoryNetwork {
  /**
   * @param {{ clock: Clock, latencyMs?: number }} options
   */
  constructor(options) {
    this.clock = options.clock;
    this.latencyMs = options.latencyMs ?? 1;
    /** False simulates a device with no network: nothing can be opened. */
    this.reachable = true;
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
    /** @type {Set<Link>} */
    this.links = new Set();
    /** @type {WeakSet<Connection>} ends closed by their own side: they are never called back */
    this.silenced = new WeakSet();
    /** @type {SentMessage[]} every message ever sent, in order */
    this.log = [];
    /** @type {((sent: SentMessage) => void) | null} called synchronously for every message sent */
    this.onSend = null;
  }

  /**
   * @param {string} label names the device in the log and in the test controls
   * @returns {Transport}
   */
  transport(label) {
    return {
      listen: (code, handlers) => {
        let closed = false;
        this.later(() => {
          if (closed) return;
          if (!this.reachable) handlers.onClose('unreachable');
          else if (this.rooms.has(code)) handlers.onClose('code-taken');
          else {
            this.rooms.set(code, { owner: label, handlers });
            handlers.onOpen();
          }
        });
        return {
          close: () => {
            closed = true;
            if (this.rooms.get(code)?.handlers === handlers) this.rooms.delete(code);
          },
        };
      },
      connect: (code, handlers) => {
        let cancelled = false;
        this.later(() => {
          if (cancelled) return;
          const room = this.rooms.get(code);
          if (!this.reachable) handlers.onFail('unreachable');
          else if (room === undefined) handlers.onFail('not-found');
          else {
            const link = this.createLink(code, label, room.owner);
            room.handlers.onConnection(link.hostEnd);
            handlers.onOpen(link.guestEnd);
          }
        });
        return {
          cancel: () => {
            cancelled = true;
          },
        };
      },
    };
  }

  // ------------------------------------------------------------------------------------ test controls

  /**
   * Kills every connection of a guest device.
   * @param {string} label
   * @param {{ silent?: boolean }} [options] silent: neither side is told, only a heartbeat can notice
   */
  dropGuest(label, options = {}) {
    for (const link of [...this.links]) {
      if (link.guest === label) this.cut(link, options.silent === true ? [] : [link.guestEnd, link.hostEnd]);
    }
  }

  /**
   * The host device vanishes (tab closed, phone died): the room stops existing and its connections die. The
   * host side is never told anything.
   * @param {string} code
   * @param {{ silent?: boolean }} [options] silent: the guests are not told either
   */
  killRoom(code, options = {}) {
    this.rooms.delete(code);
    for (const link of [...this.links]) {
      if (link.code === code) this.cut(link, options.silent === true ? [] : [link.guestEnd]);
    }
  }

  /**
   * @param {string} [code]
   * @returns {number} how many connections are open (to that room)
   */
  openLinks(code) {
    return [...this.links].filter((link) => code === undefined || link.code === code).length;
  }

  // ----------------------------------------------------------------------------------------- internals

  /** @param {() => void} task */
  later(task) {
    this.clock.setTimeout(task, this.latencyMs);
  }

  /**
   * @param {string} code
   * @param {string} guest
   * @param {string} host
   * @returns {Link}
   */
  createLink(code, guest, host) {
    /** @type {Link} */
    const link = { open: true, code, guest, host, guestEnd: this.endpoint(), hostEnd: this.endpoint() };
    this.wire(link, link.guestEnd, link.hostEnd, guest, host);
    this.wire(link, link.hostEnd, link.guestEnd, host, guest);
    this.links.add(link);
    return link;
  }

  /** @returns {Connection} */
  endpoint() {
    return { send: () => {}, close: () => {}, onMessage: null, onClose: null };
  }

  /**
   * @param {Link} link
   * @param {Connection} near
   * @param {Connection} far
   * @param {string} from
   * @param {string} to
   */
  wire(link, near, far, from, to) {
    near.send = (message) => {
      if (!link.open) return;
      /** @type {SentMessage} */
      const sent = { from, to, message: JSON.parse(JSON.stringify(message)) };
      this.log.push(sent);
      if (this.onSend !== null) this.onSend(sent);
      this.later(() => {
        if (link.open && far.onMessage !== null) far.onMessage(sent.message);
      });
    };
    near.close = () => {
      this.silenced.add(near);
      this.cut(link, [far]);
    };
  }

  /**
   * @param {Link} link
   * @param {Connection[]} told the ends that learn about it (asynchronously)
   */
  cut(link, told) {
    if (!link.open) return;
    link.open = false;
    this.links.delete(link);
    for (const end of told) {
      this.later(() => {
        if (end.onClose !== null && !this.silenced.has(end)) end.onClose();
      });
    }
  }
}
