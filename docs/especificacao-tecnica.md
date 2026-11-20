# Truco Ímpar — technical spec (source of truth)

Product: a website to play **truco paulista online, every player for themselves** (no teams), so it works
with odd numbers of players (3, 5, 7; also 2, 4, 6). The owner will play on phones with friends by sharing
a link on WhatsApp. Top priorities, above any extra feature: **no bugs** and **refined visual identity**.
A smaller flawless game beats a feature-rich one that hangs mid-match.

- Repo (git clone, branch `main`): `/home/user/truco-mpar-`  — the ONLY place to write product code.
- Never touch `/home/user/Golpe-de-Falso-Suporte` (unrelated project).
- Visual identity (chosen): "Mesa Acesa" — guide in `docs/design/identidade.md`, static reference mocks in
  `docs/design/mock/`, reference screenshots in `docs/design/capturas/`.
- Git: never change git config, never rewrite history, never push to any branch other than `main`. Commit and
  push only when your task tells you to and only after every check passes.
- Do NOT run `npm install` for new packages without need; dev deps already installed:
  `typescript@5.9.3`, `playwright@1.63.0` (Chromium pre-installed; never run `playwright install`),
  `peer@1.0.2` (local PeerJS broker for tests), `@types/node`.
- Network: this sandbox reaches the npm registry but NOT CDNs, Google Fonts, `0.peerjs.com` or `github.io`.
  Anything the site needs at runtime must be vendored inside `app/`.
- All user-facing text is Brazilian Portuguese. Code identifiers and comments in English are fine.
- Product name: **Truco Ímpar**.

> **Revision 2 (owner decisions — these override anything written or built from revision 1).**
> 1. The match target is chosen by the host in the lobby: **6, 9 or 12** points (default 12). The engine takes
>    it as `createMatch(players, { dealerIndex?, targetScore? })`, stores it in state and exposes it in the view.
>    Every "12 points" / "11 points" rule is relative to it: the match ends at `score >= targetScore`, and a
>    player whose score is exactly `targetScore - 1` cannot raise. The raise ladder itself is unchanged
>    (1, 3, 6, 9, 12) even when the target is 6 or 9.
> 2. Time per action is **15 seconds** (`turnMs = 15000`), and `disconnectGraceMs = 6000`.
> 3. Raise answers are simultaneous and secret (already specified in 2.2) — confirmed.
> 4. **Provocações (taunts)** are in the first version — see 4.7.
> 5. **Automatic sound effects** for game events are in the first version — see section 5.
> If you are implementing or reviewing code written against revision 1, treat any difference as work to do.

> **Revision 3 (owner decision — usage budget is almost exhausted; this overrides the task prompt wherever
> they conflict).** Applies to any stage that has not yet built the home / lobby / end screens (the final
> "fluxo" stage). Deliver a complete, good-looking, working game with the least possible work:
> 1. **Publish early.** As soon as create room → join by link → play a full match → end screen works end to
>    end in the real UI, add the README and `.github/workflows/deploy.yml`, commit and push (that puts the game
>    online). Then continue with sounds, taunts and the remaining items in further commits.
> 2. **Cut:** PNG icon rendering and the 1200×630 Open Graph image (keep an SVG favicon and plain
>    title / description / og:title / og:description tags; a minimal web manifest is fine); elaborate error
>    screens (one simple screen with a message per error code is enough); the 5-player and host-reload UI
>    tests (already covered at transport level); desktop-specific polish beyond "not broken"; more than one
>    round of screenshot iteration.
> 3. **Keep:** the "Mesa Acesa" look on home, lobby, table and end; target selector 6 / 9 / 12; copy link and
>    share; reconnection on reload; a handful of synthesized sound effects with a mute toggle; taunts; a short
>    "como se joga" text; ONE UI end-to-end test (three players through the real UI to the end screen,
>    including one guest reload) plus the "room not found" case.
> 4. **Work economically:** read only the files you need, do not re-run long test suites more than necessary,
>    no exploratory detours, no refactors of code that already works.

## 1. Stack and layout

Static site, native ES modules, **no bundler, no build step**. `app/` is deployed as-is to GitHub Pages at
`https://gabnanes3.github.io/Truco-mpar-/` — so **every URL in the app must be relative** (no leading `/`).

```
app/
  index.html
  manifest.webmanifest
  assets/            logo, favicon, og image, fonts (woff2), sounds
  css/
  js/
    engine/          pure game logic: no DOM, no network, no timers, no Date/Math.random
    net/             transport abstraction, protocol, host room, guest client, storage
    ui/              screens and components
  vendor/peerjs.min.js   PeerJS 1.5.4 (UMD, defines global `Peer`). Already vendored.
tests/
  engine/*.test.js   node:test unit tests + simulation
  net/*.test.js      node:test, in-memory transport + fake clock
  e2e/*.test.js      node:test driving Playwright Chromium + local PeerServer + tools/serve.js
tools/serve.js       static server for app/ (exports startStaticServer(port, host))
```

Commands (all must pass before work is considered done):
`npm run typecheck` (tsc, `checkJs` + `strict`; write JSDoc types), `npm test`, `npm run test:e2e`.

Code quality: small modules, JSDoc typedefs for every exported shape, no dead code, no TODOs left behind,
no `any` escapes unless unavoidable. Comments only where the *why* is not obvious.

## 2. Game rules (individual truco paulista) — follow exactly

- 2 to 7 players. A match needs at least 2.
- 40-card deck. Rank strength ascending: `4 5 6 7 Q J K A 2 3`. Suits: ouros, espadas, copas, paus.
- Card id = rank + suit letter: suits `o` (ouros), `e` (espadas), `c` (copas), `p` (paus). E.g. `4o`, `Qp`, `3c`.
- Each hand a card is turned up (**vira**). The **manilha** rank is the rank right after the vira's rank in the
  order above (after `3` comes `4`). The four manilhas beat every other card and rank among themselves by
  suit: paus > copas > espadas > ouros. Non-manilha cards of the same rank are EQUAL (suit irrelevant).
- Each active player gets 3 cards. A hand has up to 3 rounds; in each round every player still in the hand
  plays one card, in seat order (increasing seat index, wrapping), starting from the round leader.
- Dealer rotates every hand to the next active seat. The leader of round 1 is the next active seat after the
  dealer. The winner of a round leads the next round. If a round ties, the player who led the tied round
  leads again (if that player is no longer in the hand: the next player in seat order who is).
- A round is won by the strongest card among the plays that still count. If the strongest strength is shared
  by two or more counting plays, the round is a **tie** and nobody wins it.
- A hand is worth 1 point at the start. Only the hand winner scores, and scores the hand's current value.
  First player to reach the match target (**6, 9 or 12** points, chosen by the host; default 12) wins the match.

### 2.1 Who wins the hand

"Players in the hand" (alive) = dealt in, did not run, not removed. Let `eff[i]` be the winner of completed
round `i` **if that player is still alive**, otherwise `null` (a tie, or a round won by someone who has since
left the hand, both count as "no winner"). Evaluate after every completed round AND after any player leaves
the hand:

1. Exactly one player alive → that player wins the hand (at the current value).
2. Some alive player appears twice in `eff` → wins.
3. With 2+ rounds completed:
   - `eff[0]` null and `eff[1]` non-null → `eff[1]` wins.
   - `eff[0]` non-null and `eff[1]` null → `eff[0]` wins.
4. With 3 rounds completed and no winner yet:
   - `eff[0]` and `eff[1]` both non-null (two different players): `eff[0]` wins (covers round 3 tied and
     round 3 won by a third player — three different winners → first-round winner).
   - `eff[0]` and `eff[1]` both null: `eff[2]` wins if non-null; if null too → **nobody scores**.
5. Otherwise the hand continues.

### 2.2 Truco

- Ladder of hand values: 1 → 3 (truco) → 6 (seis) → 9 (nove) → 12 (doze).
- A player may raise only when ALL hold: it is their turn to play a card (so before playing it); the hand
  value is below 12; they are not the player who made the last accepted raise in this hand; their score is
  not exactly `targetScore - 1`.
- When a raise is called, every OTHER alive player must answer **accept** or **run**. Answers are
  simultaneous and secret: nobody (not even the caller) learns an individual answer until all are in; only
  "who has already answered" is public. There is no counter-raise as an answer.
- Resolution when all answers are in:
  - Nobody accepted → the caller wins the hand at the value BEFORE the raise. Hand ends.
  - At least one accepted → the hand value becomes the proposed value, the caller becomes "last raiser",
    every runner leaves the hand, and play resumes with the caller still to play their card.
- A player who leaves the hand (ran or was removed): scores nothing in this hand, their remaining cards are
  discarded, and the card they already played in the CURRENT (unfinished) round stops counting (voided).
  Their cards in completed rounds stay as history, but see `eff` above.
- After runners leave, re-evaluate 2.1 (the hand may end immediately). If the current round becomes complete
  because of a departure, finish it normally.

### 2.3 Removing a player from the match (kick or voluntary leave)

Removal is permanent for the match. The seat stays in the players list flagged `removed` (indices stable).
- Removed while alive in the current hand → leaves the hand as in 2.2.
- Pending raise: removed player was the caller → the raise is cancelled (value unchanged, last raiser
  unchanged, all answers discarded, nobody runs) and play resumes; removed player was a responder → counts as
  having run; resolve if that completes the answers.
- If it was the removed player's turn → the turn passes to the next alive player who has not played this round.
- Fewer than 2 non-removed players left in the match → match over; the remaining player wins (reason
  "abandon"), regardless of score.
- Removed players are skipped by dealer rotation and never dealt in again.

### 2.4 Timeouts

Default action when a player's time runs out: on their turn → play their weakest card (lowest strength under
the current manilha; among equal strengths pick deterministically, e.g. lowest suit order); answering a
raise → run.

## 3. Engine (`app/js/engine/`) — pure and deterministic

- State is a plain JSON-serializable object (the host persists it to localStorage). No functions, Maps,
  Sets, undefined-valued holes, or class instances inside state.
- No access to time or randomness: shuffled decks come in through the `deal` action.
- Never mutate inputs: `apply(state, action)` returns a new state (structural copy is fine).
- Invalid actions never throw and never change state: they return `{ ok: false, error: <stable code> }`.

Contract (names may be refined only with good reason; document every shape as JSDoc typedefs in
`app/js/engine/types.js`):

```js
// cards.js
RANKS, SUITS, fullDeck(), rankOf(id), suitOf(id), isCard(id),
manilhaRank(viraId), strength(cardId, manilhaRank) /* higher wins, equal = tie */,
isManilha(cardId, manilhaRank), weakestCard(cardIds, manilhaRank)

// game.js
DEFAULT_TARGET = 12; TARGET_OPTIONS = [6, 9, 12]; LADDER = [1, 3, 6, 9, 12]; MIN_PLAYERS = 2; MAX_PLAYERS = 7
createMatch(players /* [{id, name}] */, opts /* { dealerIndex?: number, targetScore?: 6 | 9 | 12 } */) → state   // phase 'deal'
apply(state, action) → { ok: true, state, events } | { ok: false, error, state /* same ref */ }
   actions: { type: 'deal', deck }                    // phase 'deal' only; deck = 40 distinct valid ids
            { type: 'play', playerId, card }
            { type: 'truco', playerId }               // raise to the next ladder value
            { type: 'respond', playerId, accept }
            { type: 'remove', playerId }
canRaise(state, playerId) → boolean
pendingPlayers(state) → string[]          // players who must act now ([] in 'deal' and 'over')
defaultAction(state, playerId) → action | null   // the timeout action for that player, null if none pending
viewFor(state, viewerId /* string | null for spectators */) → view
checkInvariants(state) → string[]         // human-readable violations; [] when healthy
```

Phases: `'deal'` (match start and between hands; the previous hand's result stays available for display),
`'play'`, `'truco'` (waiting for answers), `'over'`.

Deal mapping (fixed, so tests can craft decks): let `order` = active seats starting at the leader (seat after
the dealer). `order[k]` receives `deck[3k], deck[3k+1], deck[3k+2]`; the vira is `deck[3 * order.length]`.

`viewFor` is the ONLY thing that may leave the host. It must contain no other player's hidden cards and no
individual raise answers before resolution. It should carry everything the UI needs without re-deriving
rules: target score, players (id, name, score, removed), dealer, hand number, vira, manilha rank, hand value, next ladder
value, last raiser, whose turn, leader, completed rounds (plays with `voided` flags, winner or null), current
round plays, alive / ran lists, card counts per player, the viewer's own cards, whether the viewer can raise,
pending raise info (caller, proposed value, who still has to answer, whether the viewer must answer, the
viewer's own answer), last hand result (winner or null, value scored, reason:
`'rounds' | 'allRan' | 'lastStanding' | 'allTied'`), match result (winner, reason `'score' | 'abandon'`).

Events returned by `apply` are public facts for animation and log, e.g. `handDealt`, `cardPlayed`,
`roundEnded`, `trucoCalled`, `trucoAnswered` (who, not what), `trucoResolved` (accepted[], ran[], value),
`trucoCancelled`, `playerLeftHand`, `playerRemoved`, `handEnded`, `matchEnded`. Events never contain hidden
information.

### Engine tests (`tests/engine/`)

Unit tests for: rank order; manilha for every vira including vira `3` → manilha `4`; manilha suit order;
equal non-manilha ranks tie; each branch of 2.1 (including runner-won rounds becoming `null`); round leader
after win / after tie / after tied leader left; full ladder 1→3→6→9→12; same player cannot raise twice in a
row; cannot raise at `targetScore - 1` points (for targets 6, 9 and 12); cannot raise at value 12; invalid
`targetScore` rejected; raise only on own turn; secret answers not in any
view before resolution; all run → caller scores previous value; runner's current-round card voided;
departure completing a round; last player standing; every 2.3 case; dealer rotation skipping removed seats;
match end at ≥ target for each of 6, 9, 12; deal validation (bad deck); every invalid action returns an error and leaves state
untouched (deep-equal + same reference); state survives `JSON.parse(JSON.stringify(state))` at any point;
`apply` does not mutate its input (deep-freeze the input in tests).

Simulation test: thousands of complete matches with seeded random valid actions (plays, raises, answers,
occasional removals) for 2, 3, 4, 5, 6, 7 players and targets 6, 9, 12. After every step assert `checkInvariants` is empty, and
that: all 40 cards are accounted for with no duplicates during a hand; exactly the players in
`pendingPlayers` can act and each has at least one valid action; scores never decrease; views for every
player contain none of the other players' hidden cards; `defaultAction` is always valid for pending players;
every match terminates within a generous step bound. Also a "timeouts only" run where every action is
`defaultAction` must terminate (hands where nobody scores must not loop forever: with default actions a
match must still finish — verify, and if a pathological all-tie loop is possible in theory, bound the test by
steps rather than weakening the rules).

## 4. Net / session (`app/js/net/`)

Star topology: the room creator's browser is the **host** and single source of truth. Guests send intents
and receive per-player views. The host is also a player.

### 4.1 Transport abstraction

Define a small interface so the session logic is testable in Node with no browser:
- host side: open a room by code, receive connections, close;
- guest side: connect to a room by code;
- connection: `send(json)`, message / close callbacks, `close()`.

Implementations: `MemoryNetwork` (tests: deliver async, can drop connections, can make the host vanish and
come back) and `PeerTransport` (PeerJS).

PeerJS notes: global `Peer` from `vendor/peerjs.min.js`. Host peer id = `trucoimpar-v1-<CODE>`. Use
`serialization: 'json'`, `reliable: true`. Keep PeerJS's DEFAULT `config` in production (it ships Google STUN
plus PeerJS's public TURN servers) — do not replace it; extra STUN servers may be appended. Broker host /
port / path / secure / iceServers must be overridable through `globalThis.__TRUCO_CONFIG__` (tests point it
at a local `peer` server and use `iceServers: []`). `close` events are unreliable on some browsers when the
remote vanishes → rely on the heartbeat. If the broker socket drops (`disconnected`) call `peer.reconnect()`;
if the peer is destroyed, recreate it. When re-opening a room id right after a reload the broker may answer
`unavailable-id` for a while → retry with backoff for up to ~60 s. On CREATE (not resume), `unavailable-id`
means a code collision → pick another code.

Room code: 6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, generated with `crypto.getRandomValues`. Codes are
case-insensitive on input; strip spaces.

### 4.2 Identity and security

- Each device keeps `{ playerId, secret, name }` in localStorage. `playerId` is public; `secret` is sent only
  to the host in `hello` and never broadcast. The host binds seat ↔ secret on first join; a later `hello` for
  an existing playerId with a different secret is rejected. (Prevents taking someone's seat to see their cards.)
- The host validates every incoming message shape and every intent against the engine; invalid input is
  ignored (optionally answered with an error), never crashes the host, never mutates state.
- Guests receive only `viewFor(state, theirId)`; spectators receive `viewFor(state, null)`.
- A second connection for the same identity (second tab, reconnect race) replaces the older one.
- Basic flood protection is enough (e.g. ignore oversized messages / absurd rates); no need for more.

### 4.3 Room lifecycle

Phases: `lobby` → `match` → `ended` → (host: "nova partida") → `lobby` …
- Lobby: up to 7 players in join order; the host can start with ≥ 2. The host chooses the match target
  (6, 9 or 12; default 12) in the lobby; everyone sees it; it is kept for the next match until changed. The host can remove a player. Duplicate
  names are auto-disambiguated by the host (`Ana`, `Ana 2`). Names: trimmed, 1–14 chars, control chars removed.
- Joining after the match started (or when 7 seats are taken) → spectator (cap 8 spectators; beyond → `full`).
- `ended` → host presses "nova partida" → back to `lobby` with everyone present; spectators are promoted to
  players in join order while seats remain; removed/kicked players are not carried over.
- Leaving voluntarily: lobby → seat freed; match → engine `remove`. Kicked identities cannot rejoin that room.
- First dealer of each match: random seat. Deck shuffle: unbiased Fisher–Yates over `crypto.getRandomValues`.
- Randomness, clock and timers are injected into the host (fake clock + seeded RNG in tests).

### 4.4 Timers (host-driven; wall-clock deadlines, re-evaluated when the host tab wakes up)

Defaults, all overridable via `globalThis.__TRUCO_CONFIG__`:
`turnMs = 15000` (play a card, or answer a raise — one shared deadline for all pending answers),
`handPauseMs = 4500` (showing the hand result before the host auto-deals the next hand),
`disconnectGraceMs = 6000`, `heartbeatMs = 4000`, `heartbeatTimeoutMs = 12000`.
- When the deadline passes the host applies `defaultAction` for each still-pending player.
- A pending player who is disconnected gets `min(normal deadline, disconnectedAt + disconnectGraceMs)`;
  reconnecting restores the normal deadline.
- Messages carry the remaining milliseconds (not absolute host time) so client clocks don't need to agree.

### 4.5 Sync protocol

Every host→client `state` message carries the full snapshot for that client plus the public events produced
since the previous message, and a room-wide `seq` that increases by 1 per broadcast. Clients always render
from the snapshot; they animate events only when `seq` is contiguous. Reconnecting = receive a fresh snapshot.

Snapshot given to the UI (same shape for host-local and remote clients):
room `{ code, phase, settings: { targetScore }, members: [{ id, name, role: 'player'|'spectator', connected, isHost }] }`,
`you { id, role, isHost }`, `game` (engine view or null), `timer { remainingMs, totalMs, players: [ids] } | null`,
`events`, `seq`, plus client-side `connection: 'connecting'|'online'|'reconnecting'|'host-away'|'closed'` and a
terminal `error` code when applicable (`not-found`, `full`, `kicked`, `bad-version`, `host-closed`, …).

A single `GameClient` interface is what the UI consumes: subscribe to snapshots, send intents
(`play`, `truco`, `respond`, `taunt`, `leave`), and for the host also `start`, `kick`, `newMatch`,
`setTargetScore` (lobby only). Implemented by
`GuestClient` (remote) and by the host's local client (no network hop), so UI code is identical for both.

### 4.6 Reconnection and persistence (mandatory — phones lock, switch networks, reload)

- Guest: on connection loss, retry forever with backoff (1 s → max 8 s) while the page is open; retry
  immediately on `visibilitychange` → visible and on `online`. After a reload, URL code + stored identity →
  rejoin the same seat with the same cards automatically.
- Heartbeat both ways; no traffic for `heartbeatTimeoutMs` → guest shows `host-away` and keeps retrying; host
  marks the member disconnected (seat is kept).
- Host: persist a snapshot of the whole room (engine state, members with secrets, phase, deadlines, seq) to
  localStorage after every change. On load, URL code + matching stored host snapshot → resume the same room
  with the same code; guests reconnect by themselves. Snapshots older than 12 h are discarded.
- If the host is gone for good, guests see a clear message — never a frozen screen.
- Storage access is wrapped in try/catch (private mode / quota); the app must work (without persistence)
  when storage is unavailable.

### 4.7 Provocações (taunts)

A fixed list of short phrases lives in one shared module (id → pt-BR text), e.g. "Pede mais, ladrão!",
"Tá com medo?", "Essa eu levo.", "Truco é pra quem tem.", "Corre, que é melhor.", "Boa!" (the UI owner may
refine the list; keep 6–8). Any seated player may send `taunt { id }` during `match` and `ended` phases.
The host validates the id, applies a per-player rate limit (at most one every 3 s; extras are dropped
silently) and broadcasts a public event `taunt { playerId, tauntId }` to everyone immediately. Taunts are not
part of engine state and are not persisted. Spectators cannot taunt. Only ids travel on the wire — never
free text.

### Net tests (`tests/net/`, MemoryNetwork + fake clock + seeded RNG)

Full matches to completion with 3, 5 and 7 clients choosing random valid intents; lobby rules; start
permissions; duplicate names; spectators and promotion on new match; full room; kick in lobby and mid-match;
voluntary leave; guest drop + rejoin same seat/cards (mid-turn, mid-raise); wrong secret rejected; second tab
replaces first; host snapshot → brand new HostRoom resumes mid-hand and mid-raise and guests reconnect;
host sets target score in lobby only (guests cannot; invalid values rejected) and the match honours it;
taunts (valid id broadcast to all, invalid id ignored, rate limit, spectators blocked, not persisted);
turn timeout plays weakest card; raise timeout runs; disconnected-player grace; auto-deal after
`handPauseMs`; malformed / malicious messages (wrong turn, card not in hand, acting for another player,
garbage payloads, huge payloads) leave state untouched; **scan every message ever sent to each guest and
assert it never contains another player's hidden card or a secret**; seq contiguity; storage unavailable.

## 5. UI (`app/js/ui/`, `app/css/`, `app/index.html`)

Screens: home (name; create room / join by code; arriving with `?sala=CODE` pre-selects join), lobby (code,
copy link, share via Web Share API with WhatsApp fallback, roster, match target selector 6 / 9 / 12 for the
host and shown read-only to guests, start button for host only), table (with a taunt picker), match
end (final ranking, "nova partida" for host), plus: raise prompt, hand result, connection banner, how-to-play,
sound toggle, leave confirmation, friendly error screens (room not found, full, kicked, host gone, broker down).

- After creating a room the URL becomes `?sala=CODE` (replaceState) so a reload resumes.
- Portrait phone first: own cards big and easy to tap at the bottom, table in the middle, opponents around.
  **7 players must fit and stay legible at 360×640.** Must also look right on desktop.
- State readable at a glance: whose turn, time left (15 s countdown), hand value, match target, vira and manilha, who won each round, who
  ran, everyone's score, who dealt, who is disconnected.
- Cards drawn in SVG/CSS (own design, own back), clear highlight for the hand's manilhas, suits
  distinguishable without relying on colour alone.
- Short purposeful animations (deal, play, collect round, raise call, win); honour `prefers-reduced-motion`.
- Haptics on your turn (where supported).
- **Automatic sound effects** for game events: deal, card played, round won, each raise call (truco / seis /
  nove / doze, escalating), accept / run, your turn, time running out (last 5 s), hand won / lost, match
  end, taunt received. Synthesize them with the Web Audio API (no audio files to download) with a coherent,
  pleasant sound design — not beeps. Create/resume the AudioContext on the first user gesture; never throw
  when audio is unavailable or blocked; mute toggle persisted; sounds are short and never overlap into noise.
- Taunts: a compact picker on the table; a received taunt appears as a speech bubble on the sender's seat for
  ~3 s (and plays a sound); sending is disabled while rate-limited.
- Accessibility: contrast ≥ WCAG AA for text, touch targets ≥ 44 px, focus states, `aria-live` for key events,
  buttons are real `<button>`s.
- No layout jumps, no text overflow with 14-char names, no horizontal scroll, safe-area insets respected,
  `100dvh` handled, double-tap zoom / pull-to-refresh do not disrupt play.
- Guard against double submits (tapping a card twice, tapping truco then a card): UI disables input while an
  intent is in flight and re-enables from the next snapshot.
- Favicon, title, Open Graph tags + preview image, web manifest (installable), theme-color.

## 6. Delivery

`.github/workflows/` runs typecheck + unit + e2e, then deploys `app/` to GitHub Pages (only if tests pass).
README (Portuguese): link, individual-mode rules, how to run locally, how to test, known limitations
(host device is the server; some mobile networks may fail to connect peer-to-peer; public PeerJS broker).
