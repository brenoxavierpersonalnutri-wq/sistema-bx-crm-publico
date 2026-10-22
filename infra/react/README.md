# headturbo-react: Estúdio React do CRM (/conteudo/react)

O Breno sobe o vídeo que vai reagir, o estúdio toca esse vídeo e grava a câmera dele ao mesmo tempo. "Pausar e
comentar" congela o original e marca o momento; "Voltar o vídeo" retoma. "Finalizar" manda a gravação e a linha do
tempo para este serviço na VPS, que monta o Reels sozinho. Nada de edge function do Lovable: o código vem do repo
(`publicar.sh`) e roda como serviço systemd.

```
navegador (CRM logado) --JWT--> https://SEU_VPS/react/*  (Caddy)
                                   -> headturbo-react 172.18.0.1:7892 (systemd, DynamicUser, nice, 1 montagem por vez)
                                        -> Supabase: /auth/v1/user + RPC conteudo_meu_acesso + conteudo_reacts (com o JWT do usuário)
                                        -> montagem.py (ffmpeg) + legendas.py (faster-whisper local) + sincronia.py (numpy)
<video> do CRM --assinatura HMAC (6 h)--> /react/v1/arquivo/<id>/final.mp4
```

## A montagem (montagem.py)

1. normaliza as duas mídias uma vez (30 fps constantes, H.264 GOP curto, PCM 48 kHz): resolve o WebM do Chrome sem
   índice/duração, o vídeo de taxa variável do iPhone, rotação e 4K/HEVC;
2. silêncio: `volumedetect` + `silencedetect` (limiar = volume médio - 14 dB, entre -50 e -28 dB) no áudio dele. Nos
   comentários corta o respiro do começo e do fim (folga de 0,12 s antes e 0,22 s depois da fala) e encurta silêncio
   interno maior que 0,7 s; comentário mudo sai. Trecho tocando nunca é cortado;
3. cada pedaço vira um clipe 1080x1920/30: original em cima (preenche o painel como object-fit: cover, corta o excesso pelo centro, nunca faixa preta), ele embaixo
   (preenche, corte um pouco acima do centro). Nos comentários o original fica congelado no quadro da pausa. Opção
   "cheia_longos": comentário com 5 s ou mais de fala vai com ele em tela cheia e o original num quadrinho;
4. áudio: nos trechos tocando o original abaixa sozinho quando ele fala (`sidechaincompress`) e a voz dele passa por um
   portão leve (o som do original que vaza no microfone não volta); nos comentários só a voz dele;
5. legenda: a voz dele (só ela) vai para o Whisper local (`legendas.py`, faster-whisper 1.2.1, CPU int8, PT-BR, tempo
   por palavra, VAD). O estilo vem do **modelo de edição** (`modelos/<id>.json`, seletor na tela). Padrão = **Nativo**:
   DM Sans Bold (OFL, em `fontes/`) branca com contorno e sombra leves, sem cor por palavra nem karaokê, frases de 2 a 5
   palavras (palavra sozinha só quando a fala é isolada) no centro-baixo (y 1420, acima da interface do Reels). O
   "Clássico" é o da primeira versão (Archivo Black em maiúsculas, palavra da vez amarela). Sem Whisper, monta sem legenda e avisa;
6. volume: voz e original são nivelados ANTES da mistura (ganho fixo: voz -16 LUFS, original -19 LUFS, medidos uma vez
   cada), o volume escolhido por trecho entra por cima, e no fim um ganho fixo leva o vídeo a -14 LUFS (medido numa
   1ª passada) com limitador de pico em -1,5 dB. Era `loudnorm` dinâmico: ele subia os trechos baixos e desfazia o
   volume por trecho (30 % saía só 4,7 dB abaixo; agora sai 10,5 dB, medido no arnês);
7. junta, MP4 H.264 High 4.1 + AAC 160k 48 kHz, faststart, BT.709. Confere 1080x1920, H.264, AAC e a duração planejada
   antes de dar "pronto".

## Tela de edição (escolhas do Breno vencem a IA)

Depois da gravação (antes ou depois da primeira montagem) o CRM abre a edição em tela cheia, no jeito dos editores de
celular (22/10/2026): prévia 9:16 CONTÍNUA que toca o vídeo inteiro como a montagem vai fazer (o mesmo plano do
`planejar()`: gancho da IA abrindo, removidos, cortes da IA, silêncio cortado nos comentários, layout/congelado/volume
de cada bloco, sem parar entre blocos; `src/lib/conteudo/react/plano.ts`), linha do tempo com a agulha fixa no centro
(faixas: original com miniaturas, câmera com o layout, áudio com a onda da voz, texto), pinça para zoom, alças de
aparar, e a barra de ferramentas Dividir · Layout · Volume · Mudo · Congelar · Apagar · Juntar · Texto · Modelo ·
Cortes IA · Ajustes. Ao abrir, o toque de menos de 0,5 s sem escolha some no vizinho e trechos que continuam um ao
outro com a mesma escolha viram um bloco só. Não entra na prévia: legenda, zoom de ênfase e o encurtamento do original
para caber na duração máxima. Por trecho ou intervalo: layout
(dividido · só ele · só o original · original com ele no canto), congelar o original, pausa nova num ponto qualquer do
original tocando ("por 2/3/5 s" ou "enquanto eu falo", pelas falas medidas na VPS; depois continua de onde parou ou
pula o que tocou), som do original (0-100 % e mudo, por trecho e geral), remover/restaurar, manter o que a IA tirou,
restaurar corte da IA e desligar gancho/título da IA. "Montar com estas escolhas" manda `trechos` (com as escolhas) +
`edicao` no pedido. Na montagem:

- trecho removido não entra (nem como gancho); `removido: false` = fica: a IA não tira nem encurta para caber na duração;
- trecho congelado/pausa escolhido por ele não tem silêncio cortado (sai como a prévia mostrou);
- a IA não é chamada de novo: o plano da 1ª montagem (`ia_plano.json`, vale para a mesma gravação) é remapeado para os
  trechos novos (o que é por palavra vale como está; remover/notas passam pelo meio de cada trecho);
- `edicao_base.json` (trechos, falas, o que a IA cortou/tirou) e as prévias leves (`previa_original.mp4`,
  `previa_reacao.mp4`, 640 px) ficam na pasta para a tela reabrir o projeto sem os arquivos do celular;
- as escolhas ficam em `edicao.json` (VPS) e na coluna `edicao` (migration `20261205100000`, opcional).

## Vídeo original pelo link (baixar_link.py)

"Colar link do Instagram": a VPS baixa o Reels/post com `yt-dlp` (pinado no venv, `YTDLP_VERSAO` no `instalar.sh`),
**sem login e sem cookie de ninguém**, deixa em MP4 H.264 + AAC (copia se já for, converte se não) e o arquivo vira
`original.bin`, igual ao upload; o CRM traz o MP4 para o player de gravar. Só domínios conhecidos (Instagram reel/p/tv;
TikTok e YouTube Shorts por tentativa: o YouTube pede login para IP de datacenter e falha com aviso). Privado, apagado,
bloqueio ou limite viram erro legível com a sugestão de baixar no celular e usar "Escolher vídeo". Até 10 min, 500 MB,
4 min de download, um por vez. O link e o @ do autor ficam em `link.json` (e nas colunas `origem_url`/`origem_autor`)
para o crédito na legenda do post.

## Edição com IA (edicao_ia.py + ia_ponte.py) — ligada por padrão

Com `ia: true` no pedido, antes de renderizar a gravação inteira passa no Whisper e o **Claude da assinatura do Breno**
decide a edição (sem chave de API, sem custo por chamada: consome a cota). Os 5 itens:

1. **cortar o que é fraco**: repetição, erro e recomeço, "é... então...", comentário que não agrega (a faixa vai do fim
   da palavra anterior ao começo da próxima: nunca come palavra vizinha; fala por cima do vídeo tocando não é cortada);
2. **gancho**: 2 a 4 s do melhor comentário abrem o vídeo, antes do começo normal;
3. **zoom** de 1,2x na câmera dele nos momentos de ênfase (até 6, um por comentário);
4. **título** curto (até ~6 palavras) fixo no topo, letra preta em caixa branca; **palavras-chave** (1 ou 2 por frase)
   verdes e maiores na legenda;
5. **duração alvo** (`duracao_max`, padrão 90 s): original tocando até 3 s, comentários de nota até 3, original até 1,5 s
   e só então os comentários bons; o comentário do gancho fica; o corte do tocando nunca parte uma fala dele.

O prompt leva a transcrição numerada e um resumo da doutrina de conteúdo do Breno (`contexto-head.md`, tirado das
memórias do Head na VPS). A resposta vem em JSON pelo `--json-schema` e passa por `edicao_ia.validar_resposta` antes de
virar corte: índice fora da faixa, faixa atravessando comentário e excesso são descartados. **Uma chamada por vídeo.**
Se falhar (ajudante parado, login vencido, 120 s, JSON ruim), a montagem segue sem IA e o aviso aparece na tela.

Como o serviço é DynamicUser, quem chama o Claude é o ajudante `headturbo-react-ia` (usuário turbo, um pedido por vez,
socket `/run/headturbo-react-ia/ia.sock` só para o grupo `headturbo-ia`):
`claude -p --output-format json --model sonnet --tools "" --setting-sources "" --strict-mcp-config --no-session-persistence`
numa pasta vazia (`~/.cache/headturbo-react-ia`), fora do kit: sem ferramentas, hooks, MCP nem CLAUDE.md. Nunca faz login.

Uso por vídeo: `resultado.ia.uso` (tokens de entrada e saída, segundos) aparece na tela e cada chamada vira uma linha em
`/var/lib/headturbo-react/custos-ia.jsonl` (só números). OpenRouter: reserva desligada (`REACT_IA_OPENROUTER=1` + a
credencial `openrouter.key` num drop-in). Diagnóstico: `sudo bash infra/react/instalar.sh --testar-ia`.

## Modo "já gravei no celular separado" (beta, sincronia.py)

O som do original vaza no microfone dele. Características = derivada da energia em 12 faixas (200-3800 Hz) a cada
10 ms; janelas de 3 s da gravação dele procuram o melhor ponto do original (correlação por FFT). Janelas seguidas com o
mesmo deslocamento viram trecho "tocando" (precisa de uma janela com semelhança >= 0,45; a voz dele parecida com o
original dá até ~0,37); deslocamento igual em dois trechos = ele não pausou entre eles. A pausa sem avançar/voltar o
vídeo dura exatamente a diferença dos deslocamentos, e é encaixada onde os dois lados concordam. Medido no arnês:
bordas a 0,01-0,16 s, ponto do original a menos de 0,02 s. Limites: original com trechos longos de silêncio perto da
pausa, ou ele avançando/voltando o vídeo no outro aparelho, deixam a borda menos precisa (a prévia mostra).

## Rotas (prefixo `/react` no Caddy)

| Rota | Quem | O que faz |
|---|---|---|
| `GET /saude` | aberto | `{ok, fila, montando, whisper, assinatura, anon, ia}` |
| `HEAD /v1/up/<id>/<original\|reacao>` | JWT + Conteúdo + projeto | `X-Recebido` (retomar) |
| `PUT /v1/up/<id>/<arq>` | idem | `X-Offset`, pedaço <= 64 MB (o CRM manda 8 MB); arquivo até 2 GB |
| `POST /v1/fim/<id>/<arq>` | idem | fecha e mede (ffprobe); recusa o que não é vídeo e gravação sem som |
| `POST /v1/montar/<id>` | idem | pedido (modo, layout, legenda, cortar_silencio, ia, duracao_max, trechos) -> fila |
| `GET /v1/estado/<id>` | idem | estado, etapa, progresso, resultado e os endereços assinados |
| `GET /v1/edicao/<id>` | idem | tela de edição: `{base, salva, falas, previas, montando, link}` |
| `PUT /v1/edicao/<id>` | idem | salva `{trechos, edicao}` em `edicao.json` |
| `POST /v1/link/<id>` / `GET /v1/link/<id>` | idem | baixa o original pelo link / andamento e o endereço assinado |
| `GET /v1/modelos` | aberto | modelos de edição do seletor (só nomes e descrições) |
| `GET /v1/arquivo/<id>/<final.mp4\|capa.jpg\|original.mp4\|previa_*.mp4>?t=` | assinatura HMAC (6 h) | com Range; `&baixar=1` = anexo |
| `DELETE /v1/projeto/<id>` | idem | cancela e apaga os arquivos |

"Projeto" = a pessoa enxerga a linha em `conteudo_reacts` com o próprio JWT (RLS). Migration:
`supabase/migrations/20261125100000_conteudo_reacts.sql` (teste: `bash supabase/tests/conteudo-reacts/rodar.sh`) e
`20261201100000_conteudo_reacts_edicao_ia.sql` (opcional: guarda a escolha da IA e o uso por vídeo) e
`20261205100000_conteudo_reacts_edicao_link.sql` (opcional: edição, modelo, link de origem; teste:
`bash supabase/tests/conteudo-reacts/rodar-edicao.sh`).

## Limites para não derrubar lives e WhatsApp

Uma montagem por vez; cada ffmpeg/Whisper com `nice 19` + `ionice idle` e 2 threads; a unidade tem `CPUQuota=200%`
(2 das 4 vCPU), `CPUWeight=10`, `IOWeight=10`, `MemoryMax=3G`. Na disputa com o LiveKit, o OpenWA e o wa-proxy (peso
100) a montagem leva ~10% e espera. Arquivos ficam em `/var/lib/headturbo-react/<id>`; a faxina apaga projeto sem
mexida há 15 dias e upload pela metade com mais de 2 dias. Upload é recusado com menos de 8 GB livres.

## Instalar / atualizar (no Mac)

```bash
bash infra/react/publicar.sh --seco     # confere tudo; não grava nada na VPS além do espelho do repo
bash infra/react/publicar.sh            # instala/atualiza (venv, modelo, código, unidade, ufw, Caddy) e reinicia se mudou
bash infra/react/publicar.sh --arnes    # + roda o arnês (vídeos sintéticos) no venv do serviço
```

Na VPS, à mão: `sudo bash /opt/headturbo-react/src/infra/react/instalar.sh` (`--modelo turbo` troca o Whisper small
pelo large-v3-turbo: melhor, ~3x mais lento). Logs: `journalctl -u headturbo-react -n 50`. Desligar:
`systemctl disable --now headturbo-react` (a rota do Caddy passa a dar 502; zernio e n8n não são afetados). Voltar o
Caddy: o instalador deixa `Caddyfile.bak-<data>` em `/opt/head-turbo`.

Sem chave nenhuma: a anon key é pública (copiada do headturbo-zernio ou do bundle do site) e o `url.secret` nasce na VPS.

## Testes

```bash
python3 -m unittest discover -s infra/react/test -p 'test_*.py'   # funções puras + serviço com Supabase falso
python3 infra/react/test/arnes.py --saida /tmp/arnes-react --frames /tmp/frames   # ponta a ponta (ffmpeg; Whisper se houver)
python3 infra/react/test/arnes.py --saida /tmp/arnes-react --so-edicao            # só a tela de edição (layouts, pausa, volume, IA)
bunx vitest run src/test/estudioReact.test.tsx src/test/edicaoReact.test.tsx   # front
```
