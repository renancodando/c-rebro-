const TEMPO_LIMITE = 9000;
let ultimoNcbi = 0;

async function aguardarNcbi() {
    const agora = Date.now();
    const espera = Math.max(0, 380 - (agora - ultimoNcbi));
    if (espera) await new Promise(resolve => setTimeout(resolve, espera));
    ultimoNcbi = Date.now();
}

async function requisicao(url, opcoes = {}, limite = TEMPO_LIMITE) {
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), limite);
    try {
        const resposta = await fetch(url, { ...opcoes, signal: controlador.signal });
        if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
        return resposta;
    } finally {
        clearTimeout(temporizador);
    }
}

export async function testarSiibra() {
    const resposta = await requisicao("https://siibra-api-stable.apps.hbp.eu/v3_0/atlases?size=1");
    return Boolean((await resposta.json())?.items);
}

export async function testarNeuroMorpho() {
    const resposta = await requisicao("https://neuromorpho.org/api/health");
    return (await resposta.text()).length > 0;
}

export async function testarPubMed() {
    await aguardarNcbi();
    const resposta = await requisicao("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=brain&retmode=json&retmax=1&tool=BibliotecaDoCerebro");
    return Boolean((await resposta.json())?.esearchresult);
}

export async function testarCrossref() {
    const resposta = await requisicao("https://api.crossref.org/works?query.title=brain&rows=1");
    return Boolean((await resposta.json())?.message);
}

export async function buscarPubMed(termo, quantidade = 7) {
    await aguardarNcbi();
    const parametros = new URLSearchParams({ db: "pubmed", term: termo, retmode: "json", retmax: String(quantidade), tool: "BibliotecaDoCerebro" });
    const busca = await requisicao(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${parametros}`);
    const dadosBusca = await busca.json();
    const ids = dadosBusca?.esearchresult?.idlist || [];
    if (!ids.length) return [];
    await aguardarNcbi();
    const resumo = await requisicao(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(",")}&retmode=json&tool=BibliotecaDoCerebro`);
    const dadosResumo = await resumo.json();
    return ids.map(id => {
        const item = dadosResumo?.result?.[id] || {};
        const autores = (item.authors || []).slice(0, 3).map(a => a.name).filter(Boolean).join(", ");
        return {
            fonte: "PubMed",
            titulo: item.title || `Registro ${id}`,
            detalhe: [autores, item.fulljournalname, item.pubdate].filter(Boolean).join(" · "),
            id,
            url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`
        };
    });
}

export async function buscarCrossref(termo, quantidade = 7) {
    const parametros = new URLSearchParams({ "query.bibliographic": termo, rows: String(quantidade), select: "DOI,title,author,published-print,published-online,container-title,URL,type" });
    const resposta = await requisicao(`https://api.crossref.org/works?${parametros}`);
    const dados = await resposta.json();
    return (dados?.message?.items || []).map(item => {
        const autores = (item.author || []).slice(0, 3).map(a => [a.given, a.family].filter(Boolean).join(" ")).join(", ");
        return {
            fonte: "Crossref",
            titulo: item.title?.[0] || item.DOI || "Publicação",
            detalhe: [autores, item["container-title"]?.[0], item.type].filter(Boolean).join(" · "),
            id: item.DOI || "",
            url: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : "")
        };
    });
}

export async function pesquisarLiteratura(termo) {
    const resultados = await Promise.allSettled([buscarPubMed(termo), buscarCrossref(termo)]);
    const unicos = new Map();
    resultados.flatMap(resultado => resultado.status === "fulfilled" ? resultado.value : []).forEach(item => {
        const chave = item.id || item.titulo;
        if (!unicos.has(chave)) unicos.set(chave, item);
    });
    return [...unicos.values()];
}

const traducoesRegiao = [
    [/hipocampo/i, "hippocampus"],
    [/amígdala/i, "amygdala"],
    [/cerebelo/i, "cerebellum"],
    [/tálamo/i, "thalamus"],
    [/córtex|cortex/i, "cerebral cortex"],
    [/estriado/i, "striatum"],
    [/caudado/i, "caudate nucleus"],
    [/putâmen|putamen/i, "putamen"]
];

function regiaoNeuroMorpho(nome = "") {
    const encontrada = traducoesRegiao.find(([padrao]) => padrao.test(nome));
    return encontrada?.[1] || "cerebral cortex";
}

function extrairNeuronios(dados) {
    return dados?._embedded?.neuronResources || dados?.neuronResources || dados?.content || [];
}

export async function buscarNeuronioReal(nomeRegiao = "") {
    const regiao = regiaoNeuroMorpho(nomeRegiao);
    const tentativas = [
        { q: "species:human", fq: `brain_region:${regiao}` },
        { q: `brain_region:${regiao}` },
        { q: "species:human" }
    ];

    for (const tentativa of tentativas) {
        const url = new URL("https://neuromorpho.org/api/neuron/select");
        url.searchParams.set("q", tentativa.q);
        if (tentativa.fq) url.searchParams.append("fq", tentativa.fq);
        url.searchParams.set("size", "4");
        url.searchParams.set("page", "0");
        try {
            const resposta = await requisicao(url.toString(), {}, 13000);
            const dados = await resposta.json();
            const neuronios = extrairNeuronios(dados);
            if (neuronios.length) return neuronios[0];
        } catch {}
    }
    return null;
}

export async function carregarSwcNeuronio(neuronio) {
    if (!neuronio?.archive || !neuronio?.neuron_name) throw new Error("Reconstrução sem archive/neuron_name.");
    const arquivo = `${encodeURIComponent(neuronio.neuron_name)}.CNG.swc`;
    const url = `https://neuromorpho.org/dableFiles/${encodeURIComponent(String(neuronio.archive).toLowerCase())}/CNG%20version/${arquivo}`;
    const resposta = await requisicao(url, { headers: { Accept: "text/plain,*/*" } }, 18000);
    return { texto: await resposta.text(), url };
}

export function interpretarSwc(texto) {
    const pontos = new Map();
    const linhas = [];
    String(texto).split(/\r?\n/).forEach(linha => {
        const limpa = linha.trim();
        if (!limpa || limpa.startsWith("#")) return;
        const partes = limpa.split(/\s+/);
        if (partes.length < 7) return;
        const [id,tipo,x,y,z,raio,pai] = partes.map(Number);
        if (![id,tipo,x,y,z,raio,pai].every(Number.isFinite)) return;
        const ponto = { id, tipo, x, y, z, raio, pai };
        pontos.set(id, ponto);
        linhas.push(ponto);
    });
    return { pontos, linhas };
}

export async function obterNeuronioComSwc(nomeRegiao) {
    const neuronio = await buscarNeuronioReal(nomeRegiao);
    if (!neuronio) return { neuronio: null, swc: null, erro: "Nenhuma reconstrução compatível retornada." };
    try {
        const arquivo = await carregarSwcNeuronio(neuronio);
        return { neuronio, swc: interpretarSwc(arquivo.texto), url: arquivo.url, erro: null };
    } catch (erro) {
        return { neuronio, swc: null, erro: erro?.message || "Falha ao baixar SWC." };
    }
}

export const testesApis = {
    siibra: testarSiibra,
    neuromorpho: testarNeuroMorpho,
    pubmed: testarPubMed,
    crossref: testarCrossref
};
