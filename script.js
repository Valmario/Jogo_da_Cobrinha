
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
const corpoRanking = document.getElementById("ranking-corpo");
const elOrigem = document.getElementById("origem-ranking");
const elPontos = document.getElementById("pontos");
const elTempo = document.getElementById("tempo");
const elRecorde = document.getElementById("recorde");

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

const CHAVE_DADOS = "cobrinha:jogadores";
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
    texto: "#e8f5e8",
};

// ---------- Estado e regras do jogo (sem nada de desenho) ----------

// situacao: "aguardando" | "jogando" | "pausado" | "fim" | "vitoria"
function novoEstado() {
    const cobra = [
        { x: 8, y: 8 }, // cabeça sempre na posição 0
        { x: 7, y: 8 },
        { x: 6, y: 8 },
    ];
    const estado = {
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

// Distância em casas, contando o atalho pelas bordas (a cobra atravessa a tela).
function distancia(a, b) {
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    return Math.min(dx, COLUNAS - dx) + Math.min(dy, LINHAS - dy);
}

// Confere se todas as casas sem pedra continuam ligadas à origem. Assim uma pedra
// nunca fecha um cantinho do tabuleiro e deixa a comida inalcançável.
function tabuleiroConectado(obstaculos, origem) {
    const chave = (x, y) => y * COLUNAS + x;
    const visitadas = new Set([chave(origem.x, origem.y)]);
    const pilha = [origem];
    while (pilha.length > 0) {
        const p = pilha.pop();
        for (const nome in DIRECOES) {
            const x = (p.x + DIRECOES[nome].x + COLUNAS) % COLUNAS;
            const y = (p.y + DIRECOES[nome].y + LINHAS) % LINHAS;
            if (visitadas.has(chave(x, y)) || ocupada(obstaculos, x, y)) continue;
            visitadas.add(chave(x, y));
            pilha.push({ x: x, y: y });
        }
    }
    return visitadas.size === COLUNAS * LINHAS - obstaculos.length;
}

// Põe uma pedra numa casa livre, longe da cabeça e sem desconectar o tabuleiro.
function adicionarObstaculo(estado) {
    if (estado.obstaculos.length >= OBSTACULOS_MAXIMOS) return;

    const cabeca = estado.cobra[0];
    const candidatas = [];
    for (let y = 0; y < LINHAS; y++) {
        for (let x = 0; x < COLUNAS; x++) {
            if (ocupada(estado.cobra, x, y) || ocupada(estado.obstaculos, x, y)) continue;
            if (estado.comida && estado.comida.x === x && estado.comida.y === y) continue;
            if (distancia({ x: x, y: y }, cabeca) <= ZONA_SEGURA) continue;
            candidatas.push({ x: x, y: y });
        }
    }

    while (candidatas.length > 0) {
        const i = Math.floor(Math.random() * candidatas.length);
        const escolhida = candidatas.splice(i, 1)[0];
        if (tabuleiroConectado(estado.obstaculos.concat([escolhida]), cabeca)) {
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

    const d = DIRECOES[estado.direcao];
    const cabeca = estado.cobra[0];
    const nova = {
        // o resto da divisão faz a cobra reaparecer do outro lado da tela
        x: (cabeca.x + d.x + COLUNAS) % COLUNAS,
        y: (cabeca.y + d.y + LINHAS) % LINHAS,
    };

    if (ocupada(estado.obstaculos, nova.x, nova.y)) {
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

// ---------- Jogadores e ranking ----------

function limparNome(texto) {
    return String(texto).replace(/\s+/g, " ").trim().slice(0, TAMANHO_NOME).trim();
}

function mesmoNome(a, b) {
    return a.toLowerCase() === b.toLowerCase();
}

function acharJogador(lista, nome) {
    return lista.find((j) => mesmoNome(j.nome, nome)) || null;
}

function novoJogador(nome) {
    // melhorPontos e melhorTempoMs descrevem a MELHOR partida: mais pontos e, no empate, menos tempo
    return { nome: nome, melhorPontos: 0, melhorTempoMs: null, partidas: 0 };
}

// Atualiza o jogador com o resultado de uma partida e diz se bateu o próprio recorde.
// tipo: "pontos" (mais pontos), "tempo" (mesmos pontos em menos tempo) ou null.
function registrarResultado(jogador, pontos, tempoMs) {
    let tipo = null;
    if (pontos > jogador.melhorPontos) {
        tipo = "pontos";
    } else if (
        pontos === jogador.melhorPontos &&
        pontos > 0 &&
        jogador.melhorTempoMs !== null &&
        tempoMs < jogador.melhorTempoMs
    ) {
        tipo = "tempo";
    }
    if (tipo !== null || jogador.partidas === 0) {
        jogador.melhorPontos = pontos;
        jogador.melhorTempoMs = tempoMs;
    }
    jogador.partidas++;
    return { tipo: tipo };
}

// Mais pontos primeiro; no empate, menor tempo; se ainda empatar, ordem alfabética.
function ordenarRanking(lista) {
    return lista
        .filter((j) => j.partidas > 0)
        .sort(
            (a, b) =>
                b.melhorPontos - a.melhorPontos ||
                a.melhorTempoMs - b.melhorTempoMs ||
                a.nome.localeCompare(b.nome, "pt")
        );
}

function posicaoNoRanking(lista, nome) {
    return ordenarRanking(lista.slice()).findIndex((j) => mesmoNome(j.nome, nome)) + 1;
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

// Aceita um jogador vindo do localStorage ou do banco compartilhado. Esses dados não são
// confiáveis (qualquer um pode ter escrito neles), então tudo é limpo e limitado.
function normalizarJogador(j) {
    if (!j || typeof j !== "object" || typeof j.nome !== "string") return null;
    const nome = limparNome(j.nome);
    if (!nome) return null;
    const tempo = numeroOuNulo(j.melhorTempoMs);
    return {
        nome: nome,
        melhorPontos: Math.floor(limitar(Number(j.melhorPontos) || 0, 0, COLUNAS * LINHAS)),
        melhorTempoMs: tempo === null ? null : limitar(tempo, 0, 86400000),
        partidas: Math.floor(limitar(Number(j.partidas) || 0, 0, 1000000)),
    };
}

// A melhor partida de a é melhor que a de b? (mais pontos; no empate, menos tempo)
function melhorQue(a, b) {
    if (a.partidas <= 0) return false;
    if (b.partidas <= 0) return true;
    if (a.melhorPontos !== b.melhorPontos) return a.melhorPontos > b.melhorPontos;
    return (a.melhorTempoMs ?? Infinity) < (b.melhorTempoMs ?? Infinity);
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
            return { jogadores: jogadores, atual: atual ? atual.nome : null };
        }
    } catch (e) {
        // dado corrompido ou localStorage bloqueado: começa do zero
    }
    return { jogadores: [], atual: null };
}

function salvarDados() {
    try {
        localStorage.setItem(CHAVE_DADOS, JSON.stringify({ jogadores: dados.jogadores, atual: dados.atual }));
    } catch (e) {
        // sem localStorage, os jogadores valem só até fechar a página
    }
}

function jogadorAtual() {
    return dados.atual ? acharJogador(dados.jogadores, dados.atual) : null;
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

    if (estado.situacao === "aguardando") {
        const j = jogadorAtual();
        if (j) mensagem("Pronto?", j.nome + " · setas ou WASD para começar");
        else mensagem("Quem vai jogar?", "Crie um jogador no campo acima");
    } else if (estado.situacao === "pausado") {
        mensagem("Pausado", "Espaço para continuar");
    } else if (estado.situacao === "fim" || estado.situacao === "vitoria") {
        const linhas = ["Pontos: " + estado.pontos + " · Tempo: " + formatarTempo(estado.tempoMs)];
        if (estado.resultado) {
            const partes = [];
            if (estado.resultado.tipo === "pontos") partes.push("Novo recorde pessoal!");
            if (estado.resultado.tipo === "tempo") partes.push("Mesmo recorde em menos tempo!");
            partes.push(estado.resultado.posicao + "º no ranking");
            linhas.push(partes.join(" · "));
        }
        if (remoto.somenteLeitura) linhas.push("Não salvo no ranking compartilhado");
        linhas.push("Espaço para jogar de novo");
        mensagem(estado.situacao === "vitoria" ? "Você venceu!" : "Game Over", ...linhas);
    }

    botaoAcao.textContent = ROTULO_ACAO[estado.situacao];
    atualizarControlesJogador();
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
    elRecorde.textContent = Math.max(j ? j.melhorPontos : 0, estado.pontos);
}

// Trocar de jogador no meio da partida bagunçaria o ranking, então fica travado.
function atualizarControlesJogador() {
    const travado = estado.situacao === "jogando" || estado.situacao === "pausado";
    listaJogadores.disabled = travado;
    campoNome.disabled = travado;
    botaoAdicionar.disabled = travado;
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
    const lista = ordenarRanking(dados.jogadores.slice()).slice(0, TAMANHO_RANKING);

    if (lista.length === 0) {
        const linha = document.createElement("tr");
        const celula = document.createElement("td");
        celula.colSpan = 4;
        celula.className = "vazio";
        celula.textContent = "Ninguém jogou ainda. Termine uma partida para entrar no ranking.";
        linha.appendChild(celula);
        corpoRanking.appendChild(linha);
        return;
    }

    lista.forEach((j, i) => {
        const linha = document.createElement("tr");
        if (dados.atual && mesmoNome(j.nome, dados.atual)) linha.className = "atual";
        [i + 1, j.nome, j.melhorPontos, formatarTempo(j.melhorTempoMs)].forEach((valor) => {
            const celula = document.createElement("td");
            celula.textContent = String(valor);
            linha.appendChild(celula);
        });
        corpoRanking.appendChild(linha);
    });
}

// ---------- Controle do jogo ----------

let estado;
let dados = carregarDados();
let temporizador = null;
const remoto = { db: null, somenteLeitura: false, fila: {} };

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

// Grava o jogador no banco, uma escrita de cada vez por documento.
function enviarJogador(j) {
    if (!remoto.db || remoto.somenteLeitura) return Promise.resolve();
    const id = idDoc(j.nome);
    const corpo = {
        nome: j.nome,
        melhorPontos: j.melhorPontos,
        melhorTempoMs: j.melhorTempoMs,
        partidas: j.partidas,
    };
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

// Jogadores que já existiam só neste navegador sobem para o banco, se forem melhores.
function migrarLocais(locais, remotos) {
    locais.forEach((l) => {
        if (l.partidas <= 0) return;
        const r = acharJogador(remotos, l.nome);
        if (!r || melhorQue(l, r)) enviarJogador(l);
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

    const locaisIniciais = dados.jogadores.map((j) => Object.assign({}, j));
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

// Quando a partida acaba, o resultado entra no ranking do jogador atual.
function finalizar() {
    if (estado.registrado) return;
    estado.registrado = true;
    pararRelogio(estado);
    const j = jogadorAtual();
    if (!j) return;
    const r = registrarResultado(j, estado.pontos, estado.tempoMs);
    salvarDados();
    estado.resultado = { tipo: r.tipo, posicao: posicaoNoRanking(dados.jogadores, j.nome) };
    desenharRanking();
    enviarJogador(j); // no banco compartilhado, quando houver
}

function passo() {
    avancar(estado);
    if (estado.situacao === "fim" || estado.situacao === "vitoria") finalizar();
    desenhar();
    atualizarPlacar();
    agendar();
}

function reiniciar() {
    clearTimeout(temporizador);
    estado = novoEstado();
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

// ---------- Entradas: teclado, toque, jogadores e aba escondida ----------

document.addEventListener("keydown", (evento) => {
    // digitando o nome (ou escolhendo na lista): as teclas não são do jogo
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

botaoAcao.addEventListener("pointerdown", (evento) => {
    evento.preventDefault();
    acaoPrincipal();
});

// Pausa sozinho se o jogador trocar de aba ou de janela.
document.addEventListener("visibilitychange", () => {
    if (document.hidden && estado.situacao === "jogando") alternarPausa();
});

desenharJogadores();
reiniciar();
conectarBanco();
