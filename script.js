// Jogo da Cobrinha
// A lógica (estado e regras) fica separada do desenho: isso facilita entender e testar.
// As posições usam coordenadas de GRADE (coluna, linha), e não pixels.

const canvas = document.getElementById("snake");
const ctx = canvas.getContext("2d");
const botaoAcao = document.getElementById("botao-acao");
const formJogador = document.getElementById("form-jogador");
const listaJogadores = document.getElementById("lista-jogadores");
const campoNome = document.getElementById("novo-jogador");
const botaoAdicionar = document.getElementById("botao-adicionar");
const radiosNivel = document.querySelectorAll('input[name="nivel"]');
const elDescricaoNivel = document.getElementById("descricao-nivel");
const elRotuloRanking = document.getElementById("rotulo-ranking");
const corpoRanking = document.getElementById("ranking-corpo");
const elOrigem = document.getElementById("origem-ranking");
const elPontos = document.getElementById("pontos");
const elTempo = document.getElementById("tempo");
const elRecorde = document.getElementById("recorde");
const botaoSom = document.getElementById("botao-som");
const botaoMusica = document.getElementById("botao-musica");

const COLUNAS = 16;
const LINHAS = 16;
const CELULA = canvas.width / COLUNAS; // 512 / 16 = 32px: a grade cabe exatamente no canvas

const VELOCIDADE_INICIAL = 120; // ms entre cada passo
const VELOCIDADE_MINIMA = 60;
const ACELERACAO = 3; // ms a menos por comida

const OBSTACULOS_INICIAIS = 4; // pedras no começo da partida
const COMIDAS_POR_OBSTACULO = 4; // aparece uma pedra nova a cada 4 comidas
const OBSTACULOS_MAXIMOS = 12;
const ZONA_SEGURA = 5; // nenhuma pedra nasce a menos de 5 casas da cabeça

// Níveis. `paredes` lista as bordas em que a cobra bate; nas outras ela atravessa para o lado
// oposto. No Hard são as quatro bordas (para só as laterais, use ["esquerda", "direita"]).
const NIVEIS = {
    easy: {
        rotulo: "Easy",
        descricao: "Sem obstáculos. A cobra atravessa as bordas da tela.",
        obstaculos: false,
        paredes: [],
    },
    average: {
        rotulo: "Average",
        descricao: "Com pedras no caminho. A cobra atravessa as bordas da tela.",
        obstaculos: true,
        paredes: [],
    },
    hard: {
        rotulo: "Hard",
        descricao: "Com pedras e com paredes nas bordas: encostou, perdeu.",
        obstaculos: true,
        paredes: ["cima", "baixo", "esquerda", "direita"],
    },
};
const ORDEM_NIVEIS = ["easy", "average", "hard"];
const NIVEL_PADRAO = "average";

const CHAVE_DADOS = "cobrinha:jogadores";
const CHAVE_SOM = "cobrinha:som";
const CHAVE_MUSICA = "cobrinha:musica";
const TAMANHO_NOME = 16;
const TAMANHO_RANKING = 10;

// Banco compartilhado: só existe na página publicada (window.claude). Fora dela, tudo
// fica no localStorage do navegador e o jogo funciona igual.
const COLECAO = "jogadores"; // um documento por jogador
const ESPERA_BANCO_MS = 10000;

const DIRECOES = {
    cima: { x: 0, y: -1 },
    baixo: { x: 0, y: 1 },
    esquerda: { x: -1, y: 0 },
    direita: { x: 1, y: 0 },
};

const OPOSTA = { cima: "baixo", baixo: "cima", esquerda: "direita", direita: "esquerda" };

const TECLAS = {
    ArrowUp: "cima", w: "cima",
    ArrowDown: "baixo", s: "baixo",
    ArrowLeft: "esquerda", a: "esquerda",
    ArrowRight: "direita", d: "direita",
};

// Texto do botão de ação na tela, conforme a situação do jogo
const ROTULO_ACAO = {
    aguardando: "Começar",
    jogando: "Pausar",
    pausado: "Continuar",
    fim: "Jogar de novo",
    vitoria: "Jogar de novo",
};

const COR = {
    campo: "#14231a",
    campoAlt: "#172a1e",
    corpo: "#3fbf5f",
    cabeca: "#8cf0a3",
    comida: "#ffd23f",
    pedra: "#8a949f",
    pedraMiolo: "#656e78",
    parede: "#e0613d",
    texto: "#e8f5e8",
};

const ESPESSURA_PAREDE = 6;

function nivelValido(chave) {
    return typeof chave === "string" && Object.prototype.hasOwnProperty.call(NIVEIS, chave);
}

// ---------- Estado e regras do jogo (sem nada de desenho) ----------

// situacao: "aguardando" | "jogando" | "pausado" | "fim" | "vitoria"
function novoEstado(nivel = nivelAtual()) {
    const cobra = [
        { x: 8, y: 8 }, // cabeça sempre na posição 0
        { x: 7, y: 8 },
        { x: 6, y: 8 },
    ];
    const estado = {
        nivel: nivel,
        cobra: cobra,
        direcao: "direita",
        fila: [], // direções pedidas pelo jogador, aplicadas uma por passo
        obstaculos: [], // pedras: bater numa delas termina o jogo
        comida: null,
        pontos: 0,
        situacao: "aguardando",
        tempoMs: 0, // tempo jogado, sem contar as pausas
        marca: null, // instante em que o relógio da partida foi (re)ligado
        registrado: false, // o resultado já foi para o ranking?
        resultado: null, // { tipo, posicao } depois que a partida termina
    };
    for (let i = 0; i < OBSTACULOS_INICIAIS; i++) adicionarObstaculo(estado);
    estado.comida = sortearComida(cobra, estado.obstaculos);
    return estado;
}

function ocupada(lista, x, y) {
    return lista.some((p) => p.x === x && p.y === y);
}

// Casa vizinha de p na direção `nome`. Atravessa a borda para o lado oposto, a menos que
// essa borda seja uma parede: nesse caso devolve null.
function vizinhoDe(p, nome, paredes) {
    const d = DIRECOES[nome];
    const x = p.x + d.x;
    const y = p.y + d.y;
    if (x < 0 && paredes.includes("esquerda")) return null;
    if (x >= COLUNAS && paredes.includes("direita")) return null;
    if (y < 0 && paredes.includes("cima")) return null;
    if (y >= LINHAS && paredes.includes("baixo")) return null;
    return { x: (x + COLUNAS) % COLUNAS, y: (y + LINHAS) % LINHAS };
}

// Distância em casas. Onde a borda é livre, conta o atalho pelo outro lado da tela.
function distancia(a, b, paredes = []) {
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    const paredeX = paredes.includes("esquerda") || paredes.includes("direita");
    const paredeY = paredes.includes("cima") || paredes.includes("baixo");
    return (paredeX ? dx : Math.min(dx, COLUNAS - dx)) + (paredeY ? dy : Math.min(dy, LINHAS - dy));
}

// Confere se todas as casas sem pedra continuam ligadas à origem. Assim uma pedra
// nunca fecha um cantinho do tabuleiro e deixa a comida inalcançável.
function tabuleiroConectado(obstaculos, origem, paredes = []) {
    const chave = (x, y) => y * COLUNAS + x;
    const visitadas = new Set([chave(origem.x, origem.y)]);
    const pilha = [origem];
    while (pilha.length > 0) {
        const p = pilha.pop();
        for (const nome in DIRECOES) {
            const v = vizinhoDe(p, nome, paredes);
            if (v === null || visitadas.has(chave(v.x, v.y)) || ocupada(obstaculos, v.x, v.y)) continue;
            visitadas.add(chave(v.x, v.y));
            pilha.push(v);
        }
    }
    return visitadas.size === COLUNAS * LINHAS - obstaculos.length;
}

// Põe uma pedra numa casa livre, longe da cabeça e sem desconectar o tabuleiro.
// No nível Easy não há pedras.
function adicionarObstaculo(estado) {
    const nivel = NIVEIS[estado.nivel];
    if (!nivel.obstaculos || estado.obstaculos.length >= OBSTACULOS_MAXIMOS) return;

    const cabeca = estado.cobra[0];
    const candidatas = [];
    for (let y = 0; y < LINHAS; y++) {
        for (let x = 0; x < COLUNAS; x++) {
            if (ocupada(estado.cobra, x, y) || ocupada(estado.obstaculos, x, y)) continue;
            if (estado.comida && estado.comida.x === x && estado.comida.y === y) continue;
            if (distancia({ x: x, y: y }, cabeca, nivel.paredes) <= ZONA_SEGURA) continue;
            candidatas.push({ x: x, y: y });
        }
    }

    while (candidatas.length > 0) {
        const i = Math.floor(Math.random() * candidatas.length);
        const escolhida = candidatas.splice(i, 1)[0];
        if (tabuleiroConectado(estado.obstaculos.concat([escolhida]), cabeca, nivel.paredes)) {
            estado.obstaculos.push(escolhida);
            return;
        }
    }
}

// Sorteia só entre as células livres: a comida nunca nasce em cima da cobra nem de uma pedra.
function sortearComida(cobra, obstaculos = []) {
    const livres = [];
    for (let y = 0; y < LINHAS; y++) {
        for (let x = 0; x < COLUNAS; x++) {
            if (!ocupada(cobra, x, y) && !ocupada(obstaculos, x, y)) livres.push({ x: x, y: y });
        }
    }
    if (livres.length === 0) return null; // não sobrou nenhuma casa livre
    return livres[Math.floor(Math.random() * livres.length)];
}

// Guarda a direção pedida. Cada pedido é conferido contra o anterior, então apertar
// duas teclas rápido (ex.: cima e depois esquerda indo para a direita) não faz a
// cobra dar a volta sobre si mesma.
function pedirDirecao(estado, nova) {
    const ultima = estado.fila.length ? estado.fila[estado.fila.length - 1] : estado.direcao;
    if (nova === ultima || nova === OPOSTA[ultima]) return;
    if (estado.fila.length < 2) estado.fila.push(nova);
}

function avancar(estado) {
    if (estado.situacao !== "jogando") return;

    if (estado.fila.length > 0) estado.direcao = estado.fila.shift();

    const cabeca = estado.cobra[0];
    // null = bateu numa parede; senão a borda livre leva a cobra para o lado oposto da tela
    const nova = vizinhoDe(cabeca, estado.direcao, NIVEIS[estado.nivel].paredes);
    if (nova === null || ocupada(estado.obstaculos, nova.x, nova.y)) {
        estado.situacao = "fim";
        return;
    }

    const comeu = estado.comida !== null && nova.x === estado.comida.x && nova.y === estado.comida.y;

    // Se não comer, a ponta do rabo sai do lugar neste mesmo passo, então a cabeça pode entrar ali.
    const corpo = comeu ? estado.cobra : estado.cobra.slice(0, -1);
    if (corpo.some((p) => p.x === nova.x && p.y === nova.y)) {
        estado.situacao = "fim";
        return;
    }

    estado.cobra.unshift(nova);

    if (comeu) {
        estado.pontos++;
        if (estado.pontos % COMIDAS_POR_OBSTACULO === 0) adicionarObstaculo(estado);
        estado.comida = sortearComida(estado.cobra, estado.obstaculos);
        if (estado.comida === null) estado.situacao = "vitoria";
    } else {
        estado.cobra.pop();
    }
}

function intervaloAtual() {
    return Math.max(VELOCIDADE_MINIMA, VELOCIDADE_INICIAL - estado.pontos * ACELERACAO);
}

// ---------- Relógio da partida (as pausas não contam) ----------

function agora() {
    return performance.now();
}

function retomarRelogio(e) {
    if (e.marca === null) e.marca = agora();
}

function pararRelogio(e) {
    if (e.marca !== null) {
        e.tempoMs += agora() - e.marca;
        e.marca = null;
    }
}

function tempoDe(e) {
    return e.tempoMs + (e.marca !== null ? agora() - e.marca : 0);
}

// 4300 -> "0:04,3" (minutos:segundos,décimos)
function formatarTempo(ms) {
    const decimos = Math.floor(ms / 100);
    const minutos = Math.floor(decimos / 600);
    const segundos = (decimos % 600) / 10;
    return minutos + ":" + (segundos < 10 ? "0" : "") + segundos.toFixed(1).replace(".", ",");
}

// ---------- Jogadores e ranking (um ranking por nível) ----------

function limparNome(texto) {
    return String(texto).replace(/\s+/g, " ").trim().slice(0, TAMANHO_NOME).trim();
}

function mesmoNome(a, b) {
    return a.toLowerCase() === b.toLowerCase();
}

function acharJogador(lista, nome) {
    return lista.find((j) => mesmoNome(j.nome, nome)) || null;
}

// Estatística de um nível: a MELHOR partida (mais pontos e, no empate, menos tempo).
function novoStats() {
    return { melhorPontos: 0, melhorTempoMs: null, partidas: 0 };
}

function novoJogador(nome) {
    const niveis = {};
    ORDEM_NIVEIS.forEach((k) => (niveis[k] = novoStats()));
    return { nome: nome, niveis: niveis };
}

// Atualiza o nível do jogador com o resultado de uma partida e diz se bateu o próprio recorde.
// tipo: "pontos" (mais pontos), "tempo" (mesmos pontos em menos tempo) ou null.
function registrarResultado(jogador, nivel, pontos, tempoMs) {
    const s = jogador.niveis[nivel];
    let tipo = null;
    if (pontos > s.melhorPontos) {
        tipo = "pontos";
    } else if (pontos === s.melhorPontos && pontos > 0 && s.melhorTempoMs !== null && tempoMs < s.melhorTempoMs) {
        tipo = "tempo";
    }
    if (tipo !== null || s.partidas === 0) {
        s.melhorPontos = pontos;
        s.melhorTempoMs = tempoMs;
    }
    s.partidas++;
    return { tipo: tipo };
}

// Ranking de um nível: mais pontos primeiro; no empate, menor tempo; depois, ordem alfabética.
function ordenarRanking(lista, nivel) {
    return lista
        .filter((j) => j.niveis[nivel].partidas > 0)
        .sort(
            (a, b) =>
                b.niveis[nivel].melhorPontos - a.niveis[nivel].melhorPontos ||
                a.niveis[nivel].melhorTempoMs - b.niveis[nivel].melhorTempoMs ||
                a.nome.localeCompare(b.nome, "pt")
        );
}

function posicaoNoRanking(lista, nome, nivel) {
    return ordenarRanking(lista.slice(), nivel).findIndex((j) => mesmoNome(j.nome, nome)) + 1;
}

// ---------- Dados guardados no navegador ----------

function numeroOuNulo(valor) {
    if (valor === null || valor === undefined) return null;
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
}

function limitar(n, minimo, maximo) {
    return Math.min(maximo, Math.max(minimo, n));
}

function normalizarStats(s) {
    if (!s || typeof s !== "object") return novoStats();
    const tempo = numeroOuNulo(s.melhorTempoMs);
    return {
        melhorPontos: Math.floor(limitar(Number(s.melhorPontos) || 0, 0, COLUNAS * LINHAS)),
        melhorTempoMs: tempo === null ? null : limitar(tempo, 0, 86400000),
        partidas: Math.floor(limitar(Number(s.partidas) || 0, 0, 1000000)),
    };
}

// Aceita um jogador vindo do localStorage ou do banco compartilhado. Esses dados não são
// confiáveis (qualquer um pode ter escrito neles), então tudo é limpo e limitado.
// Formato antigo (antes dos níveis): os campos soltos valem para o nível Average, que era o
// único jogo que existia e já tinha pedras.
function normalizarJogador(j) {
    if (!j || typeof j !== "object" || typeof j.nome !== "string") return null;
    const nome = limparNome(j.nome);
    if (!nome) return null;
    const origem = j.niveis && typeof j.niveis === "object" ? j.niveis : { average: j };
    const niveis = {};
    ORDEM_NIVEIS.forEach((k) => (niveis[k] = normalizarStats(origem[k])));
    return { nome: nome, niveis: niveis };
}

// A melhor partida de a é melhor que a de b? (a e b são estatísticas de um nível)
function melhorQue(a, b) {
    if (a.partidas <= 0) return false;
    if (b.partidas <= 0) return true;
    if (a.melhorPontos !== b.melhorPontos) return a.melhorPontos > b.melhorPontos;
    return (a.melhorTempoMs ?? Infinity) < (b.melhorTempoMs ?? Infinity);
}

// Junta dois registros do mesmo jogador ficando, em cada nível, com a melhor partida.
// Assim uma cópia desatualizada nunca apaga um recorde.
function mesclarJogador(a, b) {
    const niveis = {};
    ORDEM_NIVEIS.forEach((k) => {
        const sa = a.niveis[k];
        const sb = b.niveis[k];
        const melhor = melhorQue(sb, sa) ? sb : sa;
        niveis[k] = {
            melhorPontos: melhor.melhorPontos,
            melhorTempoMs: melhor.melhorTempoMs,
            partidas: Math.max(sa.partidas, sb.partidas),
        };
    });
    return { nome: a.nome, niveis: niveis };
}

function copiaNiveis(niveis) {
    const copia = {};
    ORDEM_NIVEIS.forEach((k) => {
        copia[k] = {
            melhorPontos: niveis[k].melhorPontos,
            melhorTempoMs: niveis[k].melhorTempoMs,
            partidas: niveis[k].partidas,
        };
    });
    return copia;
}

// Nome do jogador -> id de documento: o banco só aceita letras minúsculas, números e
// alguns símbolos, então o resto vira ~código~ ("Valmário Lopes" -> "valm~e1~rio~20~lopes").
function idDoc(nome) {
    return Array.from(nome.toLowerCase())
        .map((c) => (/[a-z0-9]/.test(c) ? c : "~" + c.codePointAt(0).toString(16) + "~"))
        .join("");
}

// Junta a lista do banco com a local: para o mesmo nome vale o banco; jogadores que só
// existem aqui (por exemplo, criados e ainda sem partida) continuam na lista.
function mesclar(remotos, locais) {
    const lista = remotos.slice();
    locais.forEach((l) => {
        if (!acharJogador(lista, l.nome)) lista.push(l);
    });
    return lista;
}

function carregarDados() {
    try {
        const bruto = JSON.parse(localStorage.getItem(CHAVE_DADOS));
        if (bruto && Array.isArray(bruto.jogadores)) {
            const jogadores = [];
            bruto.jogadores.forEach((cru) => {
                const j = normalizarJogador(cru);
                if (j && !acharJogador(jogadores, j.nome)) jogadores.push(j);
            });
            const atual = typeof bruto.atual === "string" ? acharJogador(jogadores, bruto.atual) : null;
            return {
                jogadores: jogadores,
                atual: atual ? atual.nome : null,
                nivel: nivelValido(bruto.nivel) ? bruto.nivel : NIVEL_PADRAO,
            };
        }
    } catch (e) {
        // dado corrompido ou localStorage bloqueado: começa do zero
    }
    return { jogadores: [], atual: null, nivel: NIVEL_PADRAO };
}

function salvarDados() {
    try {
        localStorage.setItem(
            CHAVE_DADOS,
            JSON.stringify({ jogadores: dados.jogadores, atual: dados.atual, nivel: dados.nivel })
        );
    } catch (e) {
        // sem localStorage, os jogadores valem só até fechar a página
    }
}

function jogadorAtual() {
    return dados.atual ? acharJogador(dados.jogadores, dados.atual) : null;
}

function nivelAtual() {
    return nivelValido(dados.nivel) ? dados.nivel : NIVEL_PADRAO;
}

function selecionarJogador(nome) {
    const j = acharJogador(dados.jogadores, nome);
    if (!j) return;
    dados.atual = j.nome;
    salvarDados();
    desenharJogadores();
    reiniciar();
}

// Nome novo cria o jogador; nome que já existe só continua com ele.
function adicionarJogador(nome) {
    let j = acharJogador(dados.jogadores, nome);
    if (!j) {
        j = novoJogador(nome);
        dados.jogadores.push(j);
    }
    selecionarJogador(j.nome);
}

function selecionarNivel(chave) {
    if (!nivelValido(chave)) return;
    dados.nivel = chave;
    salvarDados();
    reiniciar();
}

// ---------- Desenho ----------

function desenhar() {
    for (let y = 0; y < LINHAS; y++) {
        for (let x = 0; x < COLUNAS; x++) {
            ctx.fillStyle = (x + y) % 2 === 0 ? COR.campo : COR.campoAlt;
            ctx.fillRect(x * CELULA, y * CELULA, CELULA, CELULA);
        }
    }

    if (estado.comida) {
        ctx.fillStyle = COR.comida;
        ctx.beginPath();
        ctx.arc(
            estado.comida.x * CELULA + CELULA / 2,
            estado.comida.y * CELULA + CELULA / 2,
            CELULA * 0.35,
            0,
            Math.PI * 2
        );
        ctx.fill();
    }

    estado.obstaculos.forEach((p) => {
        ctx.fillStyle = COR.pedra;
        ctx.fillRect(p.x * CELULA + 1, p.y * CELULA + 1, CELULA - 2, CELULA - 2);
        ctx.fillStyle = COR.pedraMiolo;
        ctx.fillRect(p.x * CELULA + 6, p.y * CELULA + 6, CELULA - 12, CELULA - 12);
    });

    estado.cobra.forEach((p, i) => {
        ctx.fillStyle = i === 0 ? COR.cabeca : COR.corpo;
        ctx.fillRect(p.x * CELULA + 1, p.y * CELULA + 1, CELULA - 2, CELULA - 2);
    });

    desenharParedes(NIVEIS[estado.nivel].paredes);

    const rotulo = NIVEIS[estado.nivel].rotulo;
    if (estado.situacao === "aguardando") {
        const j = jogadorAtual();
        if (j) mensagem("Pronto?", j.nome + " · " + rotulo, "Setas ou WASD para começar");
        else mensagem("Quem vai jogar?", "Crie um jogador no campo acima");
    } else if (estado.situacao === "pausado") {
        mensagem("Pausado", "Espaço para continuar");
    } else if (estado.situacao === "fim" || estado.situacao === "vitoria") {
        const linhas = [rotulo + " · Pontos: " + estado.pontos + " · Tempo: " + formatarTempo(estado.tempoMs)];
        if (estado.resultado) {
            const partes = [];
            if (estado.resultado.tipo === "pontos") partes.push("Novo recorde pessoal!");
            if (estado.resultado.tipo === "tempo") partes.push("Mesmo recorde em menos tempo!");
            partes.push(estado.resultado.posicao + "º no ranking " + rotulo);
            linhas.push(partes.join(" · "));
        }
        if (remoto.somenteLeitura) linhas.push("Não salvo no ranking compartilhado");
        linhas.push("Espaço para jogar de novo");
        mensagem(estado.situacao === "vitoria" ? "Você venceu!" : "Game Over", ...linhas);
    }

    botaoAcao.textContent = ROTULO_ACAO[estado.situacao];
    atualizarControlesJogador();
    atualizarMusica();
}

// Faixa colorida ao longo de cada borda que é parede.
function desenharParedes(paredes) {
    if (paredes.length === 0) return;
    ctx.fillStyle = COR.parede;
    if (paredes.includes("cima")) ctx.fillRect(0, 0, canvas.width, ESPESSURA_PAREDE);
    if (paredes.includes("baixo")) ctx.fillRect(0, canvas.height - ESPESSURA_PAREDE, canvas.width, ESPESSURA_PAREDE);
    if (paredes.includes("esquerda")) ctx.fillRect(0, 0, ESPESSURA_PAREDE, canvas.height);
    if (paredes.includes("direita")) ctx.fillRect(canvas.width - ESPESSURA_PAREDE, 0, ESPESSURA_PAREDE, canvas.height);
}

function mensagem(titulo, ...linhas) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = COR.texto;
    ctx.textAlign = "center";
    const topo = canvas.height / 2 - 14 - linhas.length * 12;
    ctx.font = "bold 36px 'Courier New', monospace";
    ctx.fillText(titulo, canvas.width / 2, topo);
    ctx.font = "16px 'Courier New', monospace";
    linhas.forEach((linha, i) => ctx.fillText(linha, canvas.width / 2, topo + 32 + i * 26));
}

function atualizarPlacar() {
    const j = jogadorAtual();
    elPontos.textContent = estado.pontos;
    elTempo.textContent = formatarTempo(tempoDe(estado));
    elRecorde.textContent = Math.max(j ? j.niveis[estado.nivel].melhorPontos : 0, estado.pontos);
}

// Trocar de jogador ou de nível no meio da partida bagunçaria o ranking, então fica travado.
function atualizarControlesJogador() {
    const travado = estado.situacao === "jogando" || estado.situacao === "pausado";
    listaJogadores.disabled = travado;
    campoNome.disabled = travado;
    botaoAdicionar.disabled = travado;
    radiosNivel.forEach((r) => (r.disabled = travado));
}

function desenharNivel() {
    const chave = nivelAtual();
    radiosNivel.forEach((r) => (r.checked = r.value === chave));
    elDescricaoNivel.textContent = NIVEIS[chave].descricao;
    elRotuloRanking.textContent = NIVEIS[chave].rotulo;
}

function desenharJogadores() {
    listaJogadores.replaceChildren();
    const vazio = document.createElement("option");
    vazio.value = "";
    vazio.disabled = true;
    vazio.textContent = "Escolher…";
    listaJogadores.appendChild(vazio);
    dados.jogadores
        .slice()
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt"))
        .forEach((j) => {
            const opcao = document.createElement("option");
            opcao.value = j.nome;
            opcao.textContent = j.nome; // textContent: nome digitado nunca vira HTML
            listaJogadores.appendChild(opcao);
        });
    listaJogadores.value = dados.atual || "";
}

function desenharRanking() {
    corpoRanking.replaceChildren();
    const nivel = nivelAtual();
    const lista = ordenarRanking(dados.jogadores.slice(), nivel).slice(0, TAMANHO_RANKING);

    if (lista.length === 0) {
        const linha = document.createElement("tr");
        const celula = document.createElement("td");
        celula.colSpan = 4;
        celula.className = "vazio";
        celula.textContent = "Ninguém jogou o " + NIVEIS[nivel].rotulo + " ainda. Termine uma partida para entrar no ranking.";
        linha.appendChild(celula);
        corpoRanking.appendChild(linha);
        return;
    }

    lista.forEach((j, i) => {
        const s = j.niveis[nivel];
        const linha = document.createElement("tr");
        if (dados.atual && mesmoNome(j.nome, dados.atual)) linha.className = "atual";
        [i + 1, j.nome, s.melhorPontos, formatarTempo(s.melhorTempoMs)].forEach((valor) => {
            const celula = document.createElement("td");
            celula.textContent = String(valor);
            linha.appendChild(celula);
        });
        corpoRanking.appendChild(linha);
    });
}

// ---------- Som (gerado pelo navegador, sem arquivos de áudio) ----------

// Notas: [frequência em Hz, início em s, duração em s]
const SONS = {
    comer: { onda: "square", volume: 0.08, notas: [[880, 0, 0.07], [1320, 0.07, 0.12]] },
    fim: { onda: "sawtooth", volume: 0.09, notas: [[330, 0, 0.16], [247, 0.16, 0.16], [165, 0.32, 0.4]] },
    vitoria: { onda: "triangle", volume: 0.1, notas: [[523, 0, 0.12], [659, 0.12, 0.12], [784, 0.24, 0.12], [1047, 0.36, 0.3]] },
};

// Sons em arquivo (opcional): coloque comer.mp3, gameover.mp3 e vitoria.mp3 na pasta sons/ e eles
// passam a valer. Arquivo que não existe (ou não carrega) é ignorado e o som gerado acima é usado.
const ARQUIVOS_SOM = { comer: "sons/comer.mp3", fim: "sons/gameover.mp3", vitoria: "sons/vitoria.mp3" };
const arquivosProntos = {};

function carregarArquivosSom() {
    if (typeof Audio !== "function") return;
    Object.keys(ARQUIVOS_SOM).forEach((nome) => {
        try {
            const a = new Audio(ARQUIVOS_SOM[nome]);
            a.preload = "auto";
            a.addEventListener("canplaythrough", () => (arquivosProntos[nome] = a), { once: true });
            a.addEventListener("error", () => delete arquivosProntos[nome]);
        } catch (e) {
            // sem arquivo: usa o som gerado
        }
    });
}

function tocarArquivo(nome) {
    const base = arquivosProntos[nome];
    if (!base) return false;
    try {
        const a = base.cloneNode(); // clone: dois "dings" seguidos não se cortam
        a.volume = 0.6;
        const p = a.play();
        if (p && p.catch) p.catch(() => {});
        return true;
    } catch (e) {
        return false;
    }
}

let audio = null;
let somLigado = true;
try {
    somLigado = localStorage.getItem(CHAVE_SOM) !== "desligado";
} catch (e) {
    // sem localStorage: o som começa ligado
}

// O navegador só libera o áudio depois de um toque ou tecla do jogador, por isso o contexto
// é criado (e retomado) a partir das entradas e não na abertura da página.
function prepararAudio() {
    try {
        if (!audio) {
            const Contexto = window.AudioContext || window.webkitAudioContext;
            if (!Contexto) return null;
            audio = new Contexto();
        }
        if (audio.state === "suspended") audio.resume();
        return audio;
    } catch (e) {
        return null; // sem áudio: o jogo continua normal, só que mudo
    }
}

function tocar(nome) {
    if (!somLigado) return;
    if (tocarArquivo(nome)) return;
    const ac = prepararAudio();
    if (!ac) return;
    try {
        const som = SONS[nome];
        const t0 = ac.currentTime;
        som.notas.forEach(([freq, inicio, duracao]) => {
            const osc = ac.createOscillator();
            const ganho = ac.createGain();
            osc.type = som.onda;
            osc.frequency.value = freq;
            ganho.gain.setValueAtTime(som.volume, t0 + inicio);
            ganho.gain.exponentialRampToValueAtTime(0.0001, t0 + inicio + duracao); // some sem estalo
            osc.connect(ganho);
            ganho.connect(ac.destination);
            osc.start(t0 + inicio);
            osc.stop(t0 + inicio + duracao + 0.02);
        });
    } catch (e) {
        // falha de áudio nunca atrapalha o jogo
    }
}

function desenharSom() {
    botaoSom.textContent = somLigado ? "🔊 Som ligado" : "🔇 Som desligado";
    botaoSom.setAttribute("aria-pressed", String(somLigado));
}

function alternarSom() {
    somLigado = !somLigado;
    try {
        localStorage.setItem(CHAVE_SOM, somLigado ? "ligado" : "desligado");
    } catch (e) {
        // vale só até fechar a página
    }
    desenharSom();
    atualizarMusica(); // "Som desligado" cala também a música
    if (somLigado) tocar("comer"); // confirma que está funcionando
}

// ---------- Música de fundo (também gerada pelo navegador) ----------

// Laço de 32 passos em Lá menor. 0 = pausa. Cada passo dura PASSO_MUSICA segundos.
const PASSO_MUSICA = 0.2;
const MELODIA = [
    440, 0, 523, 0, 659, 0, 523, 0, 587, 0, 523, 0, 440, 0, 392, 0,
    440, 0, 523, 0, 659, 0, 784, 0, 659, 0, 587, 0, 523, 587, 523, 440,
];
const BAIXO = [110, 87.3, 98, 110, 110, 87.3, 98, 82.4]; // uma nota a cada 4 passos
const VOLUME_MUSICA = 0.035; // bem mais baixo que os efeitos, para não cobrir o "ding"
const ANTECEDENCIA = 0.4; // quantos segundos à frente as notas são agendadas

let musicaLigada = true;
try {
    musicaLigada = localStorage.getItem(CHAVE_MUSICA) !== "desligada";
} catch (e) {
    // sem localStorage: a música começa ligada
}

const musica = { tocando: false, passo: 0, proximo: 0, temporizador: null, saida: null };

function nota(ac, destino, onda, freq, inicio, duracao) {
    const osc = ac.createOscillator();
    const ganho = ac.createGain();
    osc.type = onda;
    osc.frequency.value = freq;
    ganho.gain.setValueAtTime(0.0001, inicio);
    ganho.gain.exponentialRampToValueAtTime(1, inicio + 0.01);
    ganho.gain.exponentialRampToValueAtTime(0.0001, inicio + duracao);
    osc.connect(ganho);
    ganho.connect(destino);
    osc.start(inicio);
    osc.stop(inicio + duracao + 0.02);
}

// Agenda as próximas notas um pouco à frente e se chama de novo: o relógio do áudio é preciso,
// o setTimeout não, então o setTimeout só "enche a fila" e o áudio faz o tempo.
function agendarMusica() {
    if (!musica.tocando) return;
    try {
        const ac = audio;
        while (musica.proximo < ac.currentTime + ANTECEDENCIA) {
            const i = musica.passo % MELODIA.length;
            if (MELODIA[i]) nota(ac, musica.saida, "square", MELODIA[i], musica.proximo, PASSO_MUSICA * 0.9);
            if (i % 4 === 0) nota(ac, musica.saida, "triangle", BAIXO[i / 4], musica.proximo, PASSO_MUSICA * 3.6);
            musica.passo++;
            musica.proximo += PASSO_MUSICA;
        }
    } catch (e) {
        pararMusica(); // falha de áudio nunca atrapalha o jogo
        return;
    }
    musica.temporizador = setTimeout(agendarMusica, 100);
}

function iniciarMusica() {
    if (musica.tocando) return;
    const ac = prepararAudio();
    if (!ac) return;
    try {
        musica.saida = ac.createGain();
        musica.saida.gain.value = VOLUME_MUSICA;
        musica.saida.connect(ac.destination);
        musica.tocando = true;
        musica.proximo = ac.currentTime + 0.05;
        agendarMusica();
    } catch (e) {
        musica.tocando = false;
    }
}

function pararMusica() {
    if (!musica.tocando) return;
    musica.tocando = false;
    clearTimeout(musica.temporizador);
    try {
        const saida = musica.saida;
        saida.gain.setValueAtTime(saida.gain.value, audio.currentTime);
        saida.gain.linearRampToValueAtTime(0.0001, audio.currentTime + 0.08); // corta as notas já agendadas
        setTimeout(() => saida.disconnect(), 200);
    } catch (e) {
        // nada a fazer
    }
    musica.saida = null;
}

// Toca só enquanto a partida está rolando: pausa, Game Over e tela inicial ficam em silêncio.
function atualizarMusica() {
    if (musicaLigada && somLigado && estado.situacao === "jogando") iniciarMusica();
    else pararMusica();
}

function desenharMusica() {
    botaoMusica.textContent = musicaLigada ? "🎵 Música ligada" : "🎵 Música desligada";
    botaoMusica.setAttribute("aria-pressed", String(musicaLigada));
}

function alternarMusica() {
    musicaLigada = !musicaLigada;
    try {
        localStorage.setItem(CHAVE_MUSICA, musicaLigada ? "ligada" : "desligada");
    } catch (e) {
        // vale só até fechar a página
    }
    desenharMusica();
    atualizarMusica();
}

// ---------- Controle do jogo ----------

let estado;
let dados = carregarDados();
let temporizador = null;
const remoto = { db: null, somenteLeitura: false, fila: {}, conhecidos: [] };

// ---------- Ranking compartilhado (banco da página publicada) ----------

const TEXTO_ORIGEM = {
    local: "Ranking salvo só neste navegador.",
    conectando: "Conectando ao ranking compartilhado…",
    demora: "O ranking compartilhado ainda não respondeu. Enquanto isso, mostra o que está neste navegador.",
    compartilhado: "Ranking compartilhado: todos que abrem esta página veem as mesmas pontuações.",
    leitura: "Você só pode ver o ranking compartilhado. Para pontuar nele, peça acesso de colaborador ao dono da página.",
    falha: "Não foi possível usar o ranking compartilhado. Mostrando o que está neste navegador.",
    falhaescrita: "Não foi possível salvar este resultado no ranking compartilhado.",
};

function definirOrigem(origem) {
    elOrigem.textContent = TEXTO_ORIGEM[origem];
    elOrigem.dataset.estado = origem;
}

function atualizarTelaJogadores() {
    desenharJogadores();
    desenharRanking();
}

// Grava o jogador no banco, uma escrita de cada vez por documento. Antes de gravar, junta com
// a última cópia conhecida do banco, para nunca apagar um recorde de outro nível ou aparelho.
function enviarJogador(j) {
    if (!remoto.db || remoto.somenteLeitura) return Promise.resolve();
    const id = idDoc(j.nome);
    const conhecido = acharJogador(remoto.conhecidos, j.nome);
    const unido = conhecido ? mesclarJogador(j, conhecido) : j;
    const corpo = { nome: j.nome, niveis: copiaNiveis(unido.niveis) };
    const anterior = remoto.fila[id] || Promise.resolve();
    const atual = anterior.then(async () => {
        if (!remoto.db || remoto.somenteLeitura) return;
        try {
            await remoto.db.collection(COLECAO).doc(id).set(corpo);
        } catch (e) {
            if (e && e.code === "invalid_argument") {
                // quem só visualiza a página não pode gravar no banco compartilhado
                remoto.somenteLeitura = true;
                definirOrigem("leitura");
                desenhar(); // a tela de fim de partida passa a avisar que o resultado não foi salvo
            } else {
                definirOrigem("falhaescrita");
            }
        }
    });
    remoto.fila[id] = atual;
    return atual;
}

// Jogadores que já existiam só neste navegador sobem para o banco, se tiverem algum nível melhor.
function migrarLocais(locais, remotos) {
    locais.forEach((l) => {
        if (!ORDEM_NIVEIS.some((k) => l.niveis[k].partidas > 0)) return;
        const r = acharJogador(remotos, l.nome);
        if (!r || ORDEM_NIVEIS.some((k) => melhorQue(l.niveis[k], r.niveis[k]))) enviarJogador(l);
    });
}

async function conectarBanco() {
    if (!window.claude || typeof window.claude.use !== "function") {
        definirOrigem("local");
        return;
    }
    definirOrigem("conectando");
    let db = null;
    try {
        db = await window.claude.use("db");
    } catch (e) {
        db = null;
    }
    if (!db) {
        definirOrigem("local");
        return;
    }
    remoto.db = db;

    const locaisIniciais = dados.jogadores.map((j) => ({ nome: j.nome, niveis: copiaNiveis(j.niveis) }));
    let confirmado = false;
    const espera = setTimeout(() => {
        if (!confirmado) definirOrigem("demora");
    }, ESPERA_BANCO_MS);

    const falhar = () => {
        clearTimeout(espera);
        remoto.db = null;
        definirOrigem("falha");
    };

    try {
        db.collection(COLECAO).onSnapshot((snap) => {
            const remotos = [];
            snap.docs.forEach((d) => {
                const j = normalizarJogador(d.data());
                if (j && !acharJogador(remotos, j.nome)) remotos.push(j);
            });
            remoto.conhecidos = remotos;
            dados.jogadores = mesclar(remotos, dados.jogadores);
            salvarDados(); // o localStorage guarda uma cópia para quando o banco não responder
            atualizarTelaJogadores();
            if (!snap.metadata.fromCache) {
                if (!confirmado) {
                    confirmado = true;
                    clearTimeout(espera);
                    migrarLocais(locaisIniciais, remotos);
                }
                if (remoto.db && !remoto.somenteLeitura) definirOrigem("compartilhado");
            }
        }, falhar);
    } catch (e) {
        falhar();
    }
}

// setTimeout (e não setInterval) deixa o intervalo mudar conforme a cobra come.
function agendar() {
    clearTimeout(temporizador);
    if (estado.situacao === "jogando") {
        temporizador = setTimeout(passo, intervaloAtual());
    }
}

// Quando a partida acaba, o resultado entra no ranking do nível jogado, para o jogador atual.
function finalizar() {
    if (estado.registrado) return;
    estado.registrado = true;
    pararRelogio(estado);
    const j = jogadorAtual();
    if (!j) return;
    const r = registrarResultado(j, estado.nivel, estado.pontos, estado.tempoMs);
    salvarDados();
    estado.resultado = { tipo: r.tipo, posicao: posicaoNoRanking(dados.jogadores, j.nome, estado.nivel) };
    desenharRanking();
    enviarJogador(j); // no banco compartilhado, quando houver
}

function passo() {
    const pontosAntes = estado.pontos;
    avancar(estado);
    if (estado.situacao === "fim") tocar("fim");
    else if (estado.situacao === "vitoria") tocar("vitoria");
    else if (estado.pontos > pontosAntes) tocar("comer");
    if (estado.situacao === "fim" || estado.situacao === "vitoria") finalizar();
    desenhar();
    atualizarPlacar();
    agendar();
}

function reiniciar() {
    clearTimeout(temporizador);
    estado = novoEstado();
    desenharNivel();
    desenhar();
    atualizarPlacar();
    desenharRanking();
}

// Só começa com um jogador escolhido; sem ele, leva o foco para o campo de nome.
function iniciar() {
    if (!jogadorAtual()) {
        desenhar();
        campoNome.focus();
        return false;
    }
    estado.situacao = "jogando";
    retomarRelogio(estado);
    desenhar();
    agendar();
    return true;
}

function alternarPausa() {
    if (estado.situacao === "jogando") {
        estado.situacao = "pausado";
        pararRelogio(estado);
    } else if (estado.situacao === "pausado") {
        estado.situacao = "jogando";
        retomarRelogio(estado);
    } else {
        return;
    }
    desenhar();
    agendar();
}

// Espaço (ou toque simples): começa, pausa/continua ou joga de novo, conforme a situação.
function acaoPrincipal() {
    if (estado.situacao === "aguardando") {
        iniciar();
    } else if (estado.situacao === "jogando" || estado.situacao === "pausado") {
        alternarPausa();
    } else {
        reiniciar();
        iniciar();
    }
}

function moverPara(direcao) {
    if (estado.situacao === "aguardando" && !iniciar()) return;
    pedirDirecao(estado, direcao);
}

// ---------- Entradas: teclado, toque, jogadores, nível e aba escondida ----------

document.addEventListener("keydown", (evento) => {
    prepararAudio(); // a primeira tecla libera o som no navegador
    // digitando o nome (ou escolhendo jogador ou nível): as teclas não são do jogo
    const alvo = evento.target && evento.target.tagName;
    if (alvo === "INPUT" || alvo === "SELECT" || alvo === "TEXTAREA") return;

    const tecla = evento.key.length === 1 ? evento.key.toLowerCase() : evento.key;

    if (TECLAS[tecla]) {
        evento.preventDefault(); // evita que a página role com as setas
        moverPara(TECLAS[tecla]);
    } else if ((tecla === " " || tecla === "p") && !evento.repeat) {
        evento.preventDefault();
        acaoPrincipal();
    }
});

formJogador.addEventListener("submit", (evento) => {
    evento.preventDefault();
    const nome = limparNome(campoNome.value);
    if (!nome) {
        campoNome.focus();
        return;
    }
    adicionarJogador(nome);
    campoNome.value = "";
    campoNome.blur(); // devolve as teclas para o jogo
});

listaJogadores.addEventListener("change", () => {
    if (!listaJogadores.value) return;
    selecionarJogador(listaJogadores.value);
    listaJogadores.blur();
});

radiosNivel.forEach((radio) => {
    radio.addEventListener("change", () => {
        if (radio.checked) selecionarNivel(radio.value);
    });
    // Depois de clicar (ou tocar), devolve as setas ao jogo: com o foco no rádio elas mudariam o
    // nível em vez de mover a cobra. Vale também ao clicar no nível que já estava marcado.
    // Pelo teclado (detail 0) o foco fica, para dar para navegar entre os níveis com as setas.
    radio.addEventListener("click", (evento) => {
        if (evento.detail > 0) radio.blur();
    });
});

let toqueInicial = null;

canvas.addEventListener(
    "touchstart",
    (evento) => {
        const t = evento.touches[0];
        toqueInicial = { x: t.clientX, y: t.clientY };
    },
    { passive: true }
);

canvas.addEventListener("touchend", (evento) => {
    if (!toqueInicial) return;
    const t = evento.changedTouches[0];
    const dx = t.clientX - toqueInicial.x;
    const dy = t.clientY - toqueInicial.y;
    toqueInicial = null;

    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) {
        acaoPrincipal(); // toque simples
    } else if (Math.abs(dx) > Math.abs(dy)) {
        moverPara(dx > 0 ? "direita" : "esquerda");
    } else {
        moverPara(dy > 0 ? "baixo" : "cima");
    }
});

// Botões na tela. Usa pointerdown (e não click) para responder no instante do toque.
document.querySelectorAll("[data-direcao]").forEach((botao) => {
    botao.addEventListener("pointerdown", (evento) => {
        evento.preventDefault();
        moverPara(botao.dataset.direcao);
    });
});

botaoSom.addEventListener("click", alternarSom);
botaoMusica.addEventListener("click", alternarMusica);

botaoAcao.addEventListener("pointerdown", (evento) => {
    evento.preventDefault();
    acaoPrincipal();
});

// Pausa sozinho se o jogador trocar de aba ou de janela.
document.addEventListener("visibilitychange", () => {
    if (document.hidden && estado.situacao === "jogando") alternarPausa();
});

carregarArquivosSom();
desenharSom();
desenharMusica();
desenharJogadores();
reiniciar();
conectarBanco();
