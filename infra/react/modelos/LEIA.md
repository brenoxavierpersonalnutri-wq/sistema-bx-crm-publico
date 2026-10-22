# Modelos de edição (seletor "Modelo de edição" do Estúdio React)

Cada `<id>.json` nesta pasta é um modelo que aparece no seletor da tela (rota `GET /react/v1/modelos`). O pedido da
montagem leva `"modelo": "<id>"`; sem campo, vale `nativo`. `planejados.json` lista modelos que ainda não existem:
aparecem desligados no seletor, com o motivo, até o `<id>.json` deles ser criado aqui.

Campos (todos opcionais, o que faltar vem do `nativo`):

| campo | o que faz |
|---|---|
| `id`, `nome`, `descricao`, `ordem` | identificação e ordem no seletor (`id` = nome do arquivo, `[a-z0-9_-]`) |
| `legenda.fonte` | nome da família; o arquivo .ttf (licença livre) tem que estar em `../fontes/` |
| `legenda.negrito`, `legenda.tamanho` | peso e tamanho em px num quadro de 1080x1920 |
| `legenda.cor`, `legenda.cor_contorno` | RRGGBB |
| `legenda.contorno`, `legenda.sombra` | espessura em px (0 = sem) |
| `legenda.maiusculas` | tudo em maiúsculas |
| `legenda.karaoke` | palavra da vez colorida (amarelo) |
| `legenda.destacar_chaves` | palavras-chave da IA em verde e maiores |
| `legenda.min_palavras`, `legenda.max_palavras`, `legenda.max_letras` | tamanho de cada frase na tela |
| `legenda.y` | altura do centro da legenda (px); `null` = a emenda das metades no dividido e 1380 na tela cheia |
| `legenda.mostrar` | `false` = sem legenda (o modelo manda, mesmo com a opção ligada) |
| `titulo.fonte`, `titulo.tamanho`, `titulo.maiusculas` | o título da IA |
| `titulo.estilo` | `caixa` = no topo o vídeo todo, letra preta em caixa branca · `gancho` = branco com sombra, centralizado em `titulo.y`, do quadro zero até o fim do 1º bloco, entre `duracao_min` e `duracao_max` s |
| `titulo.y`, `titulo.duracao_min`, `titulo.duracao_max`, `titulo.sombra` | posição e tempo do gancho |
| `corte.silencio_longo`, `corte.folga_antes`, `corte.folga_depois` | pausa (s) acima da qual a fala é cortada nos comentários, e a folga que fica antes/depois da fala |
| `zoom.punch_in_seg` | punch-in na câmera dele a cada N s dentro de um take único (alterna normal e zoom de 1,2x) |

`eduestevesfitness.json` saiu de `FITNESS/inteligencia/modelo-edicao-eduestevesfitness.md` (Bianca, 21/10/2026), só
com o que o estudo marca como automático com ffmpeg: corte de pausa acima de 0,4 s, título de gancho de 2 linhas no
quadro zero a ~40% da altura por 3 a 5 s (caixa alta pesada, branca, sombra), sem legenda palavra por palavra,
punch-in a cada 3 a 4 s, −14 LUFS (o padrão de todos) e final seco (nenhum modelo põe cartela). B-roll casado com a
fala, linhas de ângulo, memes e tier list ficam de fora: o estudo diz que pedem humano.
