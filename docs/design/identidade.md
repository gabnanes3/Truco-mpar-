# Truco Ímpar — "Mesa Acesa"

Visual identity proposal, direction *boteco à noite*.

| Screen | File | Screenshot |
|---|---|---|
| A — table, 7 players, 360×640 | `mock/mesa.html` | `shots/A-table-7.png` |
| B — raise prompt, 3 players, 360×640 | `mock/pedido.html` | `shots/B-raise.png` |
| C — home, 360×640 | `mock/inicio.html` | `shots/C-home.png` |
| D — lobby, 360×640 | `mock/sala.html` | `shots/D-lobby.png` |
| E — table, 1280×800 (same file as A, responsive) | `mock/mesa.html` | `shots/E-desktop.png` |
| F — match end, 360×640 | `mock/fim.html` | `shots/F-end.png` |
| G — system sheet (extra: logo, palette, full deck, states) | `mock/sistema.html` | `shots/G-sistema.png` |

Tokens live in `mock/css/tokens.css`, components in `mock/css/app.css`. The mocks are plain HTML + CSS + inline
SVG with no script tags. `tools/build.mjs` is only an authoring helper that writes those static files (it avoids
pasting the same SVG sprite into seven files); `tools/shoot.mjs` takes the screenshots, `tools/audit.mjs` checks
overlaps, clipped text and touch targets, `tools/contraste.mjs` measures the contrast table below.

---

## 1. Concept

**One lit table in a dark room.** A boteco at night is a dark street, a dark room, and one pool of warm light
where everybody is leaning in and shouting. The interface is built the same way: the room is a warm near-black
that stays out of the way, and the only bright, saturated surface is the table. Everything you need in one
glance is on it or directly under your thumb.

The identity is made of **four materials, each with one job**, so the screen can be read by material before it
is read by text:

- **Barro** (clay red, lit from above, with a faint granilite speckle) is the table. Only played cards sit on it.
- **Esmalte anil** (cobalt enamel with a thin cream inset line, like a Brazilian street-number plate) is
  *people*: every player is a plate, every room-code character is a plate.
- **Gema** (egg-yolk yellow) is *now*: whose turn it is, how much time is left, what the hand is worth, and the
  one button that matters. If it is yellow, it wants your attention.
- **Giz** (chalk on slate) is *the house keeping the tab*: the round tracker, the ring around the winning card,
  the tally marks of the final score, the panel under the vira.

Loudness is reserved for the moment the game is actually loud. Raise calls are the only place the sign-painter
lettering goes full size, on a **cut-corner enamel sign** that is slammed onto the table at an angle
(`TRUCO!` in screen B, the `SEIS` plate in screen A). Everywhere else the UI is quiet, condensed and flat.

Two small ideas carry the name:

- **The card-accent.** The acute accent of the *Í* is a playing card thrown at an angle: the odd card out. It
  is the logo's only ornament and, alone with the *I*, it is the app icon.
- **The bottle cap.** The hand value sits in a crown cap in the middle of the table. A real crown cap has 21
  teeth, an odd number, and caps are what people actually use to keep score at a bar table. It changes colour
  as the hand heats up: cream 1, yolk 3, orange 6, red 9 and 12.

What it deliberately is not: no green felt, no chips, no gold, no wood grain, no neon, no glass, no illustrated
bar. Nothing on screen suggests money.

---

## 2. Logo

Files (outlined paths, no font needed):

- `mock/img/marca.svg` — primary, stacked, for dark backgrounds
- `mock/img/marca-linha.svg` — one line, for top bars
- `mock/img/marca-mono-creme.svg`, `mock/img/marca-mono-tinta.svg` — one colour
- `mock/img/icone.svg` — app icon / favicon

![Truco Ímpar](mock/img/marca.svg)

Construction: Sansita Black Italic, two staggered lines. "Truco" in `--creme`, "Ímpar" in `--gema`, both with a
dry sign-painter drop shade in `--carmim` offset 3.4 / 4.2 units to the lower right (the shade is a flat copy,
never blurred). The acute accent is replaced by a card (5:7, corner radius 13 %, rotated 24°, one red lozenge)
tucked under the arm of the T.

Rules: minimum width 96 px stacked, 120 px one-line. Clear space equal to the height of the card-accent on all
sides. The shade is dropped below 140 px wide and in one-colour use. Never re-typeset it, never straighten the
card, never put it on cream with the yellow line (use the ink mono version).

The icon, complete:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img"><title>Truco Ímpar</title>
  <rect width="512" height="512" rx="116" fill="#1b3f92"/>
  <rect x="26" y="26" width="460" height="460" rx="92" fill="none" stroke="#f7efdd" stroke-opacity=".5" stroke-width="6"/>
  <path d="M219.76 186.40L316.96 186.40L270.52 424L174.04 424" fill="#0d1e49" transform="translate(10 12)"/>
  <g transform="translate(10 12)"><g transform="translate(322 112) rotate(24)"><rect x="-42" y="-58.8" width="84" height="117.6" rx="10.92" fill="#0d1e49"/></g></g>
  <path d="M219.76 186.40L316.96 186.40L270.52 424L174.04 424" fill="#f7efdd"/>
  <g transform="translate(322 112) rotate(24)"><rect x="-42" y="-58.8" width="84" height="117.6" rx="10.92" fill="#f4b41f"/><path d="M0 -21L16.8 0 0 21 -16.8 0z" fill="#1c1718"/></g>
</svg>
```

---

## 3. Colour

```css
:root {
  /* O salão: escuro quente, nunca preto puro */
  --breu: #130e0c;        /* room background */
  --breu-2: #1f1714;      /* slate panels, fields */
  --breu-3: #30241e;      /* tracks, dividers */
  --breu-4: #4d3b31;      /* hairlines, inactive outlines (decorative only) */

  /* A mesa: barro sob a lâmpada */
  --barro-luz: #a8492b;   /* lit centre (lightest surface that carries cream text) */
  --barro: #8c3a23;       /* mid tone */
  --barro-2: #642a19;     /* table edge */
  --barro-3: #3a170e;     /* thickness of the table top */

  /* Esmalte */
  --anil: #1b3f92;        /* player plates, structure */
  --anil-2: #132c69;      /* numerals on cream */
  --anil-3: #0d1e49;      /* enamel thickness */
  --anil-luz: #a9c1f5;    /* secondary text on anil */
  --gema: #f4b41f;        /* now / action / value */
  --gema-2: #b27a06;      /* thickness of yolk buttons */
  --laranja: #ec7a1c;     /* value 6 */
  --pimenta: #ec5436;     /* urgency on dark (last 10 s) */
  --carmim: #bf2a17;      /* red suits on cream, the TRUCO sign, value 9 and 12 */
  --carmim-2: #7d170b;

  /* Papel e giz */
  --creme: #f7efdd;       /* card stock, text on enamel */
  --giz: #ece5d6;         /* text on dark */
  --giz-2: #b8ae9f;       /* secondary text */
  --giz-3: #8f8477;       /* tertiary text, field outlines */
  --tinta: #1c1718;       /* black suits, text on cream and on yolk */
}
```

Roles are strict: anil is never an action, gema is never decoration, carmim never appears on the table
surface (it would disappear into the clay) and is kept for cards and for the raise sign.

### Measured contrast (WCAG 2.x, `node tools/contraste.mjs`)

| Pair | Foreground | Background | Ratio |
|---|---|---|---|
| Primary text in the room | `#ece5d6` | `#130e0c` | 15.28:1 |
| Secondary text in the room | `#b8ae9f` | `#130e0c` | 8.75:1 |
| Tertiary text, hints, empty seats | `#8f8477` | `#130e0c` | 5.23:1 |
| Text on slate | `#ece5d6` | `#1f1714` | 14.06:1 |
| Secondary on slate | `#b8ae9f` | `#1f1714` | 8.06:1 |
| Tertiary on slate | `#8f8477` | `#1f1714` | 4.82:1 |
| Yolk in the room ("Sua vez!", timer) | `#f4b41f` | `#130e0c` | 10.40:1 |
| Yolk on slate (winner row, round in play) | `#f4b41f` | `#1f1714` | 9.57:1 |
| Pimenta in the room (last 10 s) | `#ec5436` | `#130e0c` | 5.37:1 |
| Pimenta on slate | `#ec5436` | `#1f1714` | 4.94:1 |
| Name on a plate | `#f7efdd` | `#1b3f92` | 8.44:1 |
| Tag on a plate | `#a9c1f5` | `#1b3f92` | 5.35:1 |
| Yolk tag on a plate ("pediu truco") | `#f4b41f` | `#1b3f92` | 5.24:1 |
| Score numeral (anil on cream) | `#132c69` | `#f7efdd` | 11.52:1 |
| Disconnected plate, base / dark stripe | `#f7efdd` | `#24407d` / `#162c5e` | 8.72:1 / 11.79:1 |
| Plate of a player who ran | `#b8ae9f` | `#2b2320` | 7.03:1 |
| Score of a player who ran | `#130e0c` | `#8f8477` | 5.23:1 |
| Text on yolk (buttons, value 3, raise plate) | `#1c1718` | `#f4b41f` | 9.61:1 |
| Value 6 | `#1c1718` | `#ec7a1c` | 6.22:1 |
| TRUCO sign, value 9 and 12 | `#f7efdd` | `#bf2a17` | 5.15:1 |
| Black suits, value 1 | `#1c1718` | `#f7efdd` | 15.48:1 |
| Red suits | `#bf2a17` | `#f7efdd` | 5.15:1 |
| Chalk text on the table, worst case (lit centre) | `#f7efdd` | `#a8492b` | 5.02:1 |
| Chalk text on the table, mid tone / edge | `#f7efdd` | `#8c3a23` / `#642a19` | 6.68:1 / 9.72:1 |
| Vira and manilha labels on the centre slate | `#f7efdd` | `#4c2418` (62 % breu over the lit centre) | 11.66:1 |
| Field and chalk-button outline (non-text, needs 3:1) | `#8f8477` | `#130e0c` | 5.23:1 |
| My dashed card slot (non-text) | `#f4b41f` | `#5e2c1c` | 6.15:1 |

Every text pair is at or above AA (4.5:1). The lit centre of the table is capped at `--barro-luz` precisely so
cream text never drops below 5:1 on it.

---

## 4. Typography

Two families, both by Omnibus-Type, both SIL Open Font License 1.1, vendored as latin-subset `.woff2` in
`mock/fonts/` (licence texts alongside). No network at runtime.

| Family | Package | Version | Licence | Files used |
|---|---|---|---|---|
| Sansita | `@fontsource/sansita` | 5.3.0 | OFL-1.1 | `sansita-latin-900-italic.woff2` (24 kB), `sansita-latin-800-normal.woff2` (23 kB) |
| Archivo (variable, wght 100–900, wdth 62–125) | `@fontsource-variable/archivo` | 5.3.0 | OFL-1.1 | `archivo-latin-wdth-normal.woff2` (90 kB) |

**Sansita Black Italic** is the *letreiro*: it has the swing of the casual a sign painter does on a bar wall.
It is used for the logo, raise calls, the timer call ("Sua vez!"), screen titles and primary button labels,
always with a dry offset shade when it is big. **Sansita ExtraBold** (upright) is the numeral face: card ranks,
scores, the timer, the hand value. Its figures are tabular by default, so the countdown does not jitter.

**Archivo** does everything else. The width axis is the reason it was chosen: seven names have to fit in 88 px
plates, so names are set at 72 % width and still stay open and legible; body text stays at 92–100 %.

| Token / use | Font | Size / line | Width | Notes |
|---|---|---|---|---|
| Grito (TRUCO!) | Sansita 900 italic | 58 / 0.9 | — | shade 3px 4px `--tinta` |
| Title (wordmark, "Bruninho levou!") | Sansita 900 italic | 34–37 / 1 | — | shade 2px 3px `--carmim` |
| Raise plate (SEIS) | Sansita 900 italic | 35 / 0.9 | — | shade 1.5px 2px `--creme` |
| Section title, button label | Sansita 900 italic | 19–21 / 1 | — | |
| Timer call | Sansita 900 italic | 18 / 0.9 | — | `--gema` |
| Timer numerals | Sansita 800 | 34 / 0.8 | — | |
| Hand value | Sansita 800 | 27 / 0.95 | — | |
| Card rank | Sansita 800 | 52 % of card width (46 % in hand) | — | 23 px on a 44 px card |
| Score | Sansita 800 | 15 / 18 | — | |
| Body | Archivo 500 | 16 / 1.4 | 100 % | |
| Support | Archivo 500 | 13–13.5 / 1.4 | 92 % | |
| List name | Archivo 600 | 15 / 1 | 88–92 % | |
| Plate name | Archivo 700 | 12.5 / 1.05 | 72 % | 14 characters fit in 88 px |
| Tag | Archivo 700 | 10 / 1 | 76 % | smallest running text |
| Label (rótulo) | Archivo 700 caps | 10.5 / 1 | 82 % | tracking +0.08em |
| Micro-labels ("VALE" on the cap, "VIRA" on the slate) | Archivo 800 caps | 8.5–9.5 / 1 | 80–82 % | only ever beside a large numeral or a card |

Mixing rule: Sansita never runs longer than three words and never goes below 12 px; Archivo never shouts.

---

## 5. Cards

All drawn in CSS + inline SVG (`.carta` in `app.css`, suit symbols in the sprite). One variable, `--w`, sizes
everything: 44 px on the phone table, 56 px on the desktop table, 84 px in hand (104 px on desktop).

**Fronts**

- Proportion 1 : 1.41, corner radius 10 % of the width, stock `--creme`, a hairline printed margin at 5.5 %
  inset in the suit colour at 16 % opacity.
- **One diagonal, two marks**: rank top-left, suit bottom-right at half the card's width. Nothing else. In
  truco nobody counts pips, so every card is drawn like an ace, which is what keeps `K♠` readable at 44 px
  next to six other things.
- Ranks `4 5 6 7 Q J K A 2 3` are set in Sansita ExtraBold. Q, J and K have no court figures: the letter is
  the figure. This is a deliberate trade of ornament for legibility.
- Two inks only: `--tinta` for espadas and paus, `--carmim` for ouros and copas.

**Manilhas** (three cues, none of them colour alone)

1. a thick yolk frame, 5 % of the width, inside the card edge;
2. a folded yolk corner top-right with a four-point star;
3. in the hand, a yolk band along the bottom with the card's nickname: `pica-fumo` (ouros), `espadilha`
   (espadas), `copas`, `zap` (paus). The strongest also says so: `zap · a maior`.

The rank that is the manilha is also spelled out under the vira ("manilha **Q**") on a small slate in the
middle of the table, so the rule and the cards that obey it look alike.

**Winning card**: lifted 3 px, tilted 2°, circled by a hand-drawn chalk ring, with "ganhando" written under
it. The ring is the house pointing at the card, so it reads even when the winning card is not a manilha.

**Back**: cream border, anil field, a small ladrilho hidráulico lattice of cream rings with yolk centres.
Point-symmetric, so it never reveals orientation. It appears as the stock under the vira.

**On the table**: cards rest at 0° (the vira at 3°, the winner at −2°). Each player's card lands in a slot
beside their plate; players who have not played yet show a faint empty slot, players who ran show none.

---

## 6. Suits

Custom 24-unit drawings, built from the same circles and points as the tile pattern, tuned to stay apart at
11 px:

| Suit | Shape | What separates it without colour |
|---|---|---|
| Ouros ♦ | lozenge with concave sides and a **pierced centre** | the only hollow suit, four sharp points |
| Espadas ♠ | one point up, round shoulders, flared foot | single spike, solid |
| Copas ♥ | two shoulders, one point down | the notch on top, no foot |
| Paus ♣ | three separate balls on a flared foot | three lobes, no point |

Red and black keep their traditional meaning, but the top silhouette (hole, spike, notch, three lobes) is
enough on its own, which matters for the two red suits and the two black ones.

Interface icons follow the same hand: 24-unit grid, 2–2.3 px round strokes, filled only when the object is
solid (deck, padlock). No emoji anywhere.

---

## 7. Layout principles

- **Phone, seven players**: opponents sit three down each side as plates on the table edge, in seat order
  around the table; each one's card lands directly inboard of their plate. The centre column carries, top to
  bottom, the hand value, the vira on its slate, and the slot where my card will land. Positions are
  percentages of the table height, so a taller phone opens the ring instead of leaving a gap (checked at
  390×844 and 412×915).
- **My area is always in the same place and in the dark**: my plate, the timer, my cards (84×118 px, each a
  full-size touch target), and the raise plate beside them under the right thumb. The timer always lives here
  when I have to act, whether it is my turn (A) or my answer (B).
- **A plate says everything about a player in two lines**: name; then score (cream chip) plus one state tag.
  States change the plate itself, not only its text: ran = switched-off grey with the name struck through;
  disconnected = hatched with a dashed inset line and a no-signal icon; turn = yolk ring.
- **Desktop** keeps the same DOM: the table becomes a full round table, the top two seats move above it, and
  two slate panels appear (score with chalk tallies and the raise ladder on the left, the hand's play-by-play
  on the right).
- Touch targets are at least 44 px; the smallest in the mocks is the 44×44 menu button (`tools/audit.mjs`
  checks every button and field, and also reports overlaps between plates, cards and centre pieces: none).
- Known limit: the seven-player table needs 382 px of height, so a 320×568 phone scrolls by 72 px. Names are
  capped at 14 characters (the length of "Maria Fernanda"), which is what fits an 88 px plate.

---

## 8. Motion

Little, short, with weight. Only `transform` and `opacity` animate; nothing blurs, nothing glows, nothing loops
except the last ten seconds of the clock.

| What | Duration | Easing | Description |
|---|---|---|---|
| Card hits the table (`bater`) | 220 ms `--t-carta` | `cubic-bezier(0.2, 1.4, 0.4, 1)` `--e-bater` | arrives from the player's side at 118 % and −6°, overshoots, settles in its slot |
| Raise sign (`gritar`) | 420 ms `--t-grito-dur` | `--e-bater` | scales 0.6 → 1.06 → 1 while swinging −11° → −3°; the veil over the table fades in 160 ms linear; one 30 ms haptic tick where available |
| Hand value changes | 260 ms | `cubic-bezier(0.2, 0.7, 0.2, 1)` `--e-padrao` | the cap flips on its vertical axis and comes back in the next colour |
| Chalk ring on the new winner | 300 ms | linear | drawn with `stroke-dashoffset`, like a hand circling it |
| Round won | 360 ms | `cubic-bezier(0.4, 0, 0.9, 0.4)` `--e-sair` | the round's cards slide to the winner's plate and fade; a check appears in the tracker |
| Timer bar | continuous | linear | width only; at 10 s it turns `--pimenta` and the numerals blink at 1 Hz in two steps |
| Tally marks (match end) | 60 ms per stroke, staggered | linear | the score is chalked up stroke by stroke, winner first |
| Button press | 120 ms `--t-rapido` | `--e-padrao` | moves down 3 px while its hard shadow collapses from 4 px to 1 px |

`prefers-reduced-motion: reduce` removes every animation and transition (it is in `app.css`); state changes
become instant, the clock keeps its numerals and colour change, and nothing blinks.

The static mocks ship the keyframes for the three that define the feel (`bater`, `gritar`, and the `pulsar`
blink of the last ten seconds) plus the button press; the other rows are the specification for the build. The
screenshots were taken with reduced motion on, so they show resting states.

Performance budget: one soft shadow under the table, a small soft shadow per card (6 px blur on the table,
14 px for the two or three cards in hand), hard zero-blur offsets for everything else, no `backdrop-filter`,
no animated `box-shadow` or `filter`.

---

## 9. Voice and microcopy (pt-BR)

The voice is the friend at the table who knows the game: spoken Portuguese ("pra", "tá"), short, a little
provocative, never rude to a person and never technical. The system speaks in lower case; only the players
shout. No vocabulary of money: no "aposta", "ficha", "prêmio", "pagar pra ver".

**Buttons**

| Where | Label | Sub-label |
|---|---|---|
| Home | Abrir uma mesa | |
| Home | Entrar | |
| Lobby | Copiar link | |
| Lobby | Mandar no zap | *(zap is both WhatsApp and the strongest card)* |
| Lobby | Começar com 5 | partida até 12 pontos |
| Table | pedir **SEIS** | vale 6 |
| Raise prompt | Aceitar | a mão vale 3 |
| Raise prompt | Correr | fora desta mão |
| Match end | Nova partida | mesma mesa, mesmos 7 |
| Match end | Sair da mesa | |

**Raise calls**

- `TRUCO!` · `SEIS!` · `NOVE!` · `DOZE!` (always capitals, always on the cut-corner sign)
- "Duda pediu **TRUCO!** A mão sobe de 1 pra 3. Vai encarar?"
- Accepted: "A mesa topou: vale 3."
- Someone ran: "Zé Pequeno correu."
- Everybody ran: "Ninguém encarou. Duda leva a mão."
- Waiting on others: "Bruninho já respondeu. A resposta dele é segredo."

**Turn and state**

- "Sua vez!" · "Responda!" · "Toque na carta pra jogar"
- Plate tags: `deu` (dealt) · `correu` · `caiu` (disconnected) · `respondeu` · `pediu truco` · `1ª ✓`
- Under the leading card: "ganhando"
- Centre of the table: "vale 3" · "truco do Bruninho" · "vira" · "manilha Q"

**Hand and match results**

- "Duda levou a 1ª rodada."
- "Seu Antônio bateu a espadilha e está ganhando."
- "Você levou a mão no zap: +3."
- "Melou: a rodada empatou."
- "Bruninho levou!" · "12 pontos em 14 mãos. Pediu truco 6 vezes e quase ninguém encarou."
- A player on zero: "passou em branco"

**Lobby**

- "5 na mesa: número ímpar, pode começar. Aqui não tem dupla. Com 3, 5 ou 7 é cada um por si."
- "Duas cadeiras vagas · esperando…"

**Errors and edge cases** (say what happened, then what to do; never blame)

- Wrong code: "Não achei essa mesa. Confere o código com quem te chamou."
- Table full: "Essa mesa já tem 7. Abre outra e chama a turma."
- Empty name: "Fala seu nome pra mesa saber quem é."
- Link copied: "Link copiado. Agora é só colar no grupo."
- Too few players: "Sozinho não dá truco. Precisa de pelo menos 3."
- I lost connection: "Caiu a conexão. Segura aí que sua cadeira tá guardada."
- Someone else dropped: "Maria Fernanda caiu. A cadeira dela fica guardada."
- Time ran out: "Acabou o tempo." *(what the game then does is a rules decision; the line that follows should state it plainly, for example "A vez passou.")*

---

## 10. Do and don't

**Do**

- Keep the room dark and the table the only large area of colour.
- Use anil for people, gema for now, chalk for the house's notes, the cut-corner sign for raises.
- Let each player's state change the plate's material as well as its text.
- Set names in Archivo at 72 % width before you ever truncate them.
- Use hard, short, zero-blur shadows: things here are enamel plates and card stock.
- Keep the card diagonal (rank top-left, suit bottom-right) at every size.

**Don't**

- Don't put a second yolk element on screen that is not an action, a clock or a value.
- Don't use Sansita italic for sentences, labels or anything under 12 px.
- Don't add court-card illustrations, pips, wood grain, felt, chips, coins or beer.
- Don't put text straight onto the lit centre of the table at less than cream-on-`--barro-luz`.
- Don't tile the ladrilho pattern as a background: it is a 22 px band or a card back, nothing more.
- Don't blur, glow or pulse. If something needs attention it gets the yolk, the chalk ring, or the sign.
- Don't use emoji as icons, and don't recolour the suits.
