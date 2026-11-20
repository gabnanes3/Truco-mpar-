# Truco Ímpar

**Sem dupla, sem dó.** Truco paulista online em que cada um joga por si: funciona com 3, 5 ou 7 pessoas
(e também com 2, 4 ou 6). Sem cadastro e sem instalar nada: alguém abre a mesa, manda o link no grupo e
a turma entra pelo celular.

**Jogar agora: <https://gabnanes3.github.io/Truco-mpar-/>**

## Como funciona

1. Escreva seu nome e toque em **Abrir uma mesa**.
2. Mande o link da mesa (botão **Mandar no zap** ou **Copiar link**) pra turma. Quem recebe só escreve o
   nome e entra. Também dá pra entrar digitando o código de 6 letras.
3. Quem abriu a mesa escolhe se a partida vai até **6, 9 ou 12 pontos** e toca em **Começar**.
4. Quem chegar depois que a partida começou assiste, e entra na próxima.

Se o celular bloquear a tela, trocar de rede ou a página recarregar, é só voltar pelo mesmo link: sua
cadeira e suas cartas continuam lá.

## Regras do truco individual

- De 2 a 7 jogadores, **todos contra todos**. Só quem leva a mão pontua. Ganha a partida quem chegar
  primeiro aos pontos combinados (6, 9 ou 12).
- Baralho de 40 cartas. Da mais fraca pra mais forte: `4 5 6 7 Q J K A 2 3`.
- Em cada mão vira uma carta no meio da mesa (a **vira**). A **manilha** é a carta seguinte à vira nessa
  ordem (depois do `3` vem o `4`) e ganha de todas as outras. Entre as manilhas manda o naipe:
  ouros < espadas < copas < paus (o zap).
- Fora as manilhas, o naipe não desempata: cartas de mesmo valor **empatam** e a rodada "mela".
- Cada um recebe 3 cartas. A mão tem até 3 rodadas; em cada uma todos jogam uma carta, em ordem, e a mais
  forte leva a rodada. Quem ganha a rodada abre a próxima.
- Leva a mão quem ganhar 2 rodadas. Nos empates:
  - melou a 1ª: leva quem ganhar a 2ª;
  - melou a 2ª: leva quem ganhou a 1ª;
  - três rodadas com três ganhadores diferentes (ou a 3ª melada): leva quem ganhou a 1ª;
  - melaram as três: ninguém pontua.
- **Truco:** na sua vez, antes de jogar a carta, você pode pedir truco. A mão passa a valer 3; os pedidos
  seguintes sobem pra 6, 9 e 12. Quem fez o último pedido aceito não pode pedir de novo em seguida, e quem
  está a um ponto de ganhar a partida não pode pedir.
- Quando alguém pede, **todos os outros respondem ao mesmo tempo e em segredo**: aceitar ou correr. As
  respostas só aparecem quando todo mundo respondeu.
  - Ninguém aceitou: quem pediu leva a mão pelo valor que ela tinha antes do pedido.
  - Alguém aceitou: a mão passa a valer o novo valor, quem correu sai da mão e o jogo segue.
- **Relógio:** são 15 segundos por jogada. Se o tempo acabar, o jogo joga sua carta mais fraca; se era uma
  resposta de truco, você corre.
- Quem sai da partida no meio não volta pra ela (só assiste). Se sobrar um só, ele leva a partida.

Tem também **provocações** prontas pra mandar pra mesa e efeitos sonoros (dá pra desligar no botão de som).

## Rodar no seu computador

Precisa de [Node.js](https://nodejs.org/) 20 ou mais novo.

```bash
npm install
npm start
```

Abra <http://127.0.0.1:5173/>. Pra testar com vários jogadores no mesmo computador, abra o link da mesa em
janelas anônimas ou em navegadores diferentes (cada janela normal do mesmo navegador conta como o mesmo
jogador).

O site é estático: a pasta `app/` é publicada como está, sem etapa de build.

## Testes

```bash
npm run typecheck                      # tipos (TypeScript checando o JavaScript)
npm test                               # regras do jogo e camada de rede, em Node
npx playwright install chromium        # só na primeira vez
npm run test:e2e                       # partidas inteiras em navegadores de verdade
```

Os testes de ponta a ponta sobem um servidor local e um broker PeerJS local: não dependem da internet.

## Estrutura

```
app/               o site publicado
  js/engine/       regras do jogo (puro, sem tela nem rede)
  js/net/          sala, protocolo, reconexão e transporte (PeerJS / WebRTC)
  js/ui/           telas e componentes
  css/, assets/    identidade visual "Mesa Acesa"
tests/             testes do motor, da rede e de ponta a ponta
docs/              especificação técnica e guia de identidade
```

## Limitações conhecidas

- **O aparelho de quem abriu a mesa é o servidor.** Se essa pessoa fechar a página, a partida para até ela
  voltar pelo mesmo link (a mesa fica guardada no aparelho dela por até 12 horas). Se ela sair de vez, a
  mesa fecha pra todo mundo.
- **A conexão é direta entre os aparelhos (WebRTC).** Algumas redes móveis e redes corporativas bloqueiam
  esse tipo de conexão; nesse caso a pessoa não consegue entrar na mesa. Trocar de rede (Wi-Fi em vez de
  4G, ou o contrário) costuma resolver.
- **Para os jogadores se encontrarem, o jogo usa o serviço público e gratuito do PeerJS.** Se ele estiver
  fora do ar ou lento, não dá pra abrir nem achar mesas até ele voltar. Mesas já abertas continuam.
- Sem contas nem histórico: o placar vale só enquanto a mesa está aberta.
- Os sons só começam depois do primeiro toque na tela (regra dos navegadores).

## Créditos

Fontes [Sansita](https://github.com/Omnibus-Type/Sansita) e [Archivo](https://github.com/Omnibus-Type/Archivo)
(Omnibus-Type, licença SIL OFL 1.1). Conexão entre os jogadores com [PeerJS](https://peerjs.com/).
