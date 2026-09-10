const TEMPO_LIMITE = 10000;
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
        const resposta = await fetch(url, {
            ...opcoes,
            signal: controlador.signal,
            headers: {
                Accept: "application/json, text/plain, */*",
                ...(opcoes.headers || {})
            }
        });
        if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
        return resposta;
    } finally {
        clearTimeout(temporizador);
    }
}

function texto(valor) {
    return String(valor ?? "").trim();
}

function primeiro(...valores) {
    return valores.map(texto).find(Boolean) || "";
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

export async function testarEuropePmc() {
    const resposta = await requisicao("https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=brain&format=json&pageSize=1");
    return Boolean((await resposta.json())?.resultList);
}

export async function testarNeuroVault() {
    const resposta = await requisicao("https://neurovault.org/api/atlases/");
    const dados = await resposta.json();
    return Array.isArray(dados) || Boolean(dados?.results);
}

export async function testarDandi() {
    const resposta = await requisicao("https://api.dandiarchive.org/api/dandisets/?page_size=1");
    const dados = await resposta.json();
    return Boolean(dados?.results || Array.isArray(dados));
}

export async function testarOpenNeuro() {
    const query = `query { dataset(id: "ds000224") { id name } }`;
    const resposta = await requisicao("https://openneuro.org/crn/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
    }, 13000);
    const dados = await resposta.json();
    return Boolean(dados?.data?.dataset?.id);
}

export async function testarAllen() {
    const url = "https://api.brain-map.org/api/v2/data/Organism/1.json";
    const resposta = await requisicao(url, {}, 12000);
    return Boolean((await resposta.json())?.success);
}

export async function buscarPubMed(termo, quantidade = 8) {
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
            tipo: "artigo",
            fonte: "PubMed",
            titulo: item.title || `Registro ${id}`,
            detalhe: [autores, item.fulljournalname, item.pubdate].filter(Boolean).join(" · "),
            id,
            url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`
        };
    });
}

export async function buscarCrossref(termo, quantidade = 8) {
    const parametros = new URLSearchParams({ "query.bibliographic": termo, rows: String(quantidade), select: "DOI,title,author,published-print,published-online,container-title,URL,type,is-referenced-by-count" });
    const resposta = await requisicao(`https://api.crossref.org/works?${parametros}`);
    const dados = await resposta.json();
    return (dados?.message?.items || []).map(item => {
        const autores = (item.author || []).slice(0, 3).map(a => [a.given, a.family].filter(Boolean).join(" ")).join(", ");
        return {
            tipo: "artigo",
            fonte: "Crossref",
            titulo: item.title?.[0] || item.DOI || "Publicação",
            detalhe: [autores, item["container-title"]?.[0], item.type, item["is-referenced-by-count"] != null ? `${item["is-referenced-by-count"]} citações` : ""].filter(Boolean).join(" · "),
            id: item.DOI || "",
            url: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : "")
        };
    });
}

export async function buscarEuropePmc(termo, quantidade = 8) {
    const parametros = new URLSearchParams({ query: termo, format: "json", pageSize: String(quantidade), resultType: "core" });
    const resposta = await requisicao(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?${parametros}`);
    const dados = await resposta.json();
    return (dados?.resultList?.result || []).map(item => ({
        tipo: "artigo",
        fonte: "Europe PMC",
        titulo: item.title || item.id || "Publicação",
        detalhe: [item.authorString, item.journalTitle, item.pubYear, item.isOpenAccess === "Y" ? "open access" : ""].filter(Boolean).join(" · "),
        id: item.doi || item.pmid || item.pmcid || item.id || "",
        url: item.pmcid ? `https://europepmc.org/article/PMC/${item.pmcid.replace(/^PMC/i, "")}` : item.pmid ? `https://europepmc.org/article/MED/${item.pmid}` : `https://europepmc.org/search?query=${encodeURIComponent(termo)}`
    }));
}

export async function pesquisarLiteratura(termo) {
    const resultados = await Promise.allSettled([buscarPubMed(termo), buscarCrossref(termo), buscarEuropePmc(termo)]);
    const unicos = new Map();
    resultados.flatMap(resultado => resultado.status === "fulfilled" ? resultado.value : []).forEach(item => {
        const chave = String(item.id || item.titulo).toLowerCase();
        if (!unicos.has(chave)) unicos.set(chave, item);
    });
    return [...unicos.values()];
}

export async function buscarMapasNeuroVault(termo, quantidade = 8) {
    const parametros = new URLSearchParams({ name: termo });
    const resposta = await requisicao(`https://neurovault.org/api/collections/?${parametros}`, {}, 12000);
    const dados = await resposta.json();
    const itens = Array.isArray(dados) ? dados : (dados?.results || []);
    return itens.slice(0, quantidade).map(item => ({
        tipo: "mapa",
        fonte: "NeuroVault",
        titulo: primeiro(item.name, `Coleção ${item.id}`),
        detalhe: [item.DOI || item.doi, item.owner_name || item.owner, item.number_of_images ? `${item.number_of_images} mapas` : ""].filter(Boolean).join(" · "),
        id: texto(item.id),
        url: item.url || `https://neurovault.org/collections/${item.id}/`
    }));
}

export async function buscarDandi(termo, quantidade = 8) {
    const parametros = new URLSearchParams({ search: termo, page_size: String(quantidade) });
    const resposta = await requisicao(`https://api.dandiarchive.org/api/dandisets/?${parametros}`, {}, 12000);
    const dados = await resposta.json();
    const itens = dados?.results || (Array.isArray(dados) ? dados : []);
    return itens.slice(0, quantidade).map(item => {
        const identificador = primeiro(item.identifier, item.dandiset_id, item.id);
        const versao = item.most_recent_published_version || item.draft_version || {};
        return {
            tipo: "dataset",
            fonte: "DANDI",
            titulo: primeiro(versao.name, item.name, `Dandiset ${identificador}`),
            detalhe: [identificador, versao.version, versao.asset_count != null ? `${versao.asset_count} arquivos` : ""].filter(Boolean).join(" · "),
            id: identificador,
            url: identificador ? `https://dandiarchive.org/dandiset/${identificador}` : "https://dandiarchive.org/"
        };
    });
}

export async function consultarOpenNeuro(id = "ds000224") {
    const limpo = /^ds\d{6}$/i.test(id) ? id.toLowerCase() : "ds000224";
    const query = `query { dataset(id: "${limpo}") { id name } }`;
    const resposta = await requisicao("https://openneuro.org/crn/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
    }, 15000);
    const dados = await resposta.json();
    const item = dados?.data?.dataset;
    if (!item?.id) return [];
    return [{
        tipo: "dataset",
        fonte: "OpenNeuro",
        titulo: item.name || item.id,
        detalhe: `${item.id} · BIDS · neuroimagem aberta`,
        id: item.id,
        url: `https://openneuro.org/datasets/${item.id}`
    }];
}

export async function buscarGeneAllen(gene = "BDNF", quantidade = 8) {
    const simbolo = String(gene || "BDNF").replace(/[^A-Za-z0-9_-]/g, "").toUpperCase() || "BDNF";
    const criterio = `model::Gene,rma::criteria,[acronym$eq'${simbolo}'],rma::options[num_rows$eq${quantidade}]`;
    const url = `https://api.brain-map.org/api/v2/data/query.json?criteria=${encodeURIComponent(criterio)}`;
    const resposta = await requisicao(url, {}, 13000);
    const dados = await resposta.json();
    return (dados?.msg || []).slice(0, quantidade).map(item => ({
        tipo: "gene",
        fonte: "Allen Brain Map",
        titulo: primeiro(item.name, item.acronym, simbolo),
        detalhe: [item.acronym, item.entrez_id ? `Entrez ${item.entrez_id}` : "", item.homologene_id ? `HomoloGene ${item.homologene_id}` : ""].filter(Boolean).join(" · "),
        id: texto(item.id),
        url: item.id ? `https://human.brain-map.org/microarray/search/show?exact_match=false&search_term=${encodeURIComponent(simbolo)}` : "https://human.brain-map.org/"
    }));
}

export async function buscarGeneNcbi(gene = "BDNF", quantidade = 6) {
    await aguardarNcbi();
    const termo = `${gene}[Gene Name] AND Homo sapiens[Organism]`;
    const parametros = new URLSearchParams({ db: "gene", term: termo, retmode: "json", retmax: String(quantidade), tool: "BibliotecaDoCerebro" });
    const resposta = await requisicao(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${parametros}`);
    const dados = await resposta.json();
    const ids = dados?.esearchresult?.idlist || [];
    if (!ids.length) return [];
    await aguardarNcbi();
    const resumo = await requisicao(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=gene&id=${ids.join(",")}&retmode=json&tool=BibliotecaDoCerebro`);
    const info = await resumo.json();
    return ids.map(id => {
        const item = info?.result?.[id] || {};
        return {
            tipo: "gene",
            fonte: "NCBI Gene",
            titulo: primeiro(item.name, gene),
            detalhe: [item.description, item.nomenclaturesymbol].filter(Boolean).join(" · "),
            id,
            url: `https://www.ncbi.nlm.nih.gov/gene/${id}`
        };
    });
}

export async function buscarEvidenciasAbertas(termo) {
    const normalizado = String(termo || "brain").trim() || "brain";
    const idOpenNeuro = /^ds\d{6}$/i.test(normalizado) ? normalizado : "ds000224";
    const tarefas = {
        literatura: pesquisarLiteratura(normalizado),
        neurovault: buscarMapasNeuroVault(normalizado),
        dandi: buscarDandi(normalizado),
        openneuro: consultarOpenNeuro(idOpenNeuro),
        allen: buscarGeneAllen(/^[A-Za-z0-9_-]{2,12}$/.test(normalizado) ? normalizado : "BDNF"),
        geneNcbi: buscarGeneNcbi(/^[A-Za-z0-9_-]{2,12}$/.test(normalizado) ? normalizado : "BDNF")
    };
    const entradas = await Promise.all(Object.entries(tarefas).map(async ([chave, promessa]) => {
        try { return [chave, await promessa]; } catch { return [chave, []]; }
    }));
    return Object.fromEntries(entradas);
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

export function interpretarSwc(textoSwc) {
    const pontos = new Map();
    const linhas = [];
    String(textoSwc).split(/\r?\n/).forEach(linha => {
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
    crossref: testarCrossref,
    europepmc: testarEuropePmc,
    neurovault: testarNeuroVault,
    dandi: testarDandi,
    openneuro: testarOpenNeuro,
    allen: testarAllen
};
