import { lerNifti } from "./nifti.js";

const BASE = "https://siibra-api-stable.apps.hbp.eu/v3_0";
const CHAVE_CACHE = "biblioteca_cerebro_ebrains_v3";
const VALIDADE_CACHE = 1000 * 60 * 60 * 12;

function idDe(objeto) {
    return objeto?.["@id"] || objeto?.id || "";
}

function textoSeguro(valor) {
    if (Array.isArray(valor)) return valor.filter(Boolean).join(", ");
    if (valor && typeof valor === "object") return valor.name || valor.shortName || valor.identifier || idDe(valor) || JSON.stringify(valor);
    return String(valor ?? "");
}

async function requisicao(url, opcoes = {}, limite = 14000) {
    const controlador = new AbortController();
    const timer = setTimeout(() => controlador.abort(), limite);
    try {
        const resposta = await fetch(url, { ...opcoes, signal: controlador.signal, headers: { Accept: "application/json, application/octet-stream;q=.9, */*;q=.8", ...(opcoes.headers || {}) } });
        if (!resposta.ok) throw new Error(`EBRAINS respondeu HTTP ${resposta.status}`);
        return resposta;
    } finally {
        clearTimeout(timer);
    }
}

async function json(url, limite) {
    return await (await requisicao(url, {}, limite)).json();
}

function urlComParametros(caminho, parametros = {}) {
    const url = new URL(`${BASE}${caminho}`);
    Object.entries(parametros).forEach(([chave, valor]) => {
        if (valor !== undefined && valor !== null && String(valor).length) url.searchParams.set(chave, String(valor));
    });
    return url.toString();
}

function normalizarParcellation(item) {
    return {
        id: idDe(item),
        nome: item?.name || item?.shortname || "Parcellation",
        shortname: item?.shortname || "",
        modalidade: item?.modality || "",
        versao: item?.version?.name || item?.versionIdentifier || "",
        deprecated: Boolean(item?.version?.deprecated),
        bruto: item
    };
}

function pontuacaoJulich(item) {
    const nome = `${item.nome} ${item.shortname}`.toLowerCase();
    let pontos = 0;
    if (nome.includes("julich") || nome.includes("jülich")) pontos += 100;
    if (nome.includes("cyto") || nome.includes("cito")) pontos += 25;
    if (nome.includes("probabil")) pontos += 12;
    if (nome.includes("brain")) pontos += 5;
    if (item.deprecated) pontos -= 80;
    return pontos;
}

function extrairNumeroInterno(regiao) {
    const bruto = regiao?.hasAnnotation?.internalIdentifier ?? regiao?.internalIdentifier ?? regiao?.lookupLabel ?? "";
    const direto = Number(bruto);
    if (Number.isFinite(direto) && direto !== 0) return Math.round(direto);
    const partes = String(bruto).match(/-?\d+(?:\.\d+)?/g);
    if (!partes?.length) return null;
    const ultimo = Number(partes.at(-1));
    return Number.isFinite(ultimo) ? Math.round(ultimo) : null;
}

function normalizarRegiao(regiao) {
    const anotacao = regiao?.hasAnnotation || {};
    const coordenadas = Array.isArray(anotacao?.bestViewPoint?.coordinates)
        ? anotacao.bestViewPoint.coordinates.map(item => Number(item?.value ?? item)).filter(Number.isFinite)
        : [];
    const paisBrutos = Array.isArray(regiao?.hasParent) ? regiao.hasParent : (regiao?.hasParent ? [regiao.hasParent] : []);
    const ontologiaBruta = Array.isArray(regiao?.ontologyIdentifier) ? regiao.ontologyIdentifier : (regiao?.ontologyIdentifier ? [regiao.ontologyIdentifier] : []);
    return {
        id: idDe(regiao),
        nome: regiao?.name || regiao?.lookupLabel || "Região sem nome",
        lookup: regiao?.lookupLabel || "",
        pai: paisBrutos.map(textoSeguro).filter(Boolean),
        cor: anotacao?.displayColor || "",
        laterality: textoSeguro(anotacao?.laterality),
        numeroInterno: extrairNumeroInterno(regiao),
        coordenadas,
        ontology: ontologiaBruta,
        bruto: regiao
    };
}

export class AtlasEbrains {
    constructor() {
        this.parcellation = null;
        this.mapa = null;
        this.espacoId = null;
        this.espacoNome = "";
        this.regioes = [];
        this.indicePorNumero = new Map();
        this.sincronizado = false;
    }

    carregarCache() {
        try {
            const bruto = localStorage.getItem(CHAVE_CACHE);
            if (!bruto) return false;
            const cache = JSON.parse(bruto);
            if (!cache?.salvoEm || Date.now() - cache.salvoEm > VALIDADE_CACHE) return false;
            if (!cache.parcellation?.id || !Array.isArray(cache.regioes)) return false;
            this.parcellation = cache.parcellation;
            this.mapa = cache.mapa || null;
            this.espacoId = cache.espacoId || null;
            this.espacoNome = cache.espacoNome || "";
            this.regioes = cache.regioes;
            this.reconstruirIndice();
            this.sincronizado = this.regioes.length > 0;
            return this.sincronizado;
        } catch {
            return false;
        }
    }

    salvarCache() {
        try {
            const regioes = this.regioes.map(item => ({
                id: item.id,
                nome: item.nome,
                lookup: item.lookup,
                pai: item.pai,
                cor: item.cor,
                laterality: item.laterality,
                numeroInterno: item.numeroInterno,
                coordenadas: item.coordenadas,
                ontology: item.ontology
            }));
            localStorage.setItem(CHAVE_CACHE, JSON.stringify({
                salvoEm: Date.now(),
                parcellation: this.parcellation,
                mapa: this.mapa,
                espacoId: this.espacoId,
                espacoNome: this.espacoNome,
                regioes
            }));
        } catch {}
    }

    reconstruirIndice() {
        this.indicePorNumero.clear();
        this.regioes.forEach(regiao => {
            if (Number.isFinite(regiao.numeroInterno)) this.indicePorNumero.set(regiao.numeroInterno, regiao);
        });
    }

    async listarParcellations() {
        const resposta = await json(urlComParametros("/parcellations", { size: 100, page: 1 }));
        const itens = (resposta?.items || []).map(normalizarParcellation);
        if ((resposta?.pages || 1) > 1) {
            for (let pagina = 2; pagina <= Math.min(resposta.pages, 4); pagina++) {
                const proxima = await json(urlComParametros("/parcellations", { size: 100, page: pagina }));
                itens.push(...(proxima?.items || []).map(normalizarParcellation));
            }
        }
        return itens;
    }

    async localizarJulich() {
        const itens = await this.listarParcellations();
        if (!itens.length) throw new Error("Nenhuma parcellation foi retornada pelo siibra.");
        itens.sort((a,b) => pontuacaoJulich(b) - pontuacaoJulich(a));
        this.candidatasJulich = itens.filter(item => pontuacaoJulich(item) >= 30);
        if (!this.candidatasJulich.length) throw new Error("Julich-Brain não foi localizado automaticamente.");
        this.parcellation = this.candidatasJulich[0];
        return this.parcellation;
    }

    async localizarMapa() {
        if (!this.parcellation?.id) throw new Error("Parcellation não definida.");
        const candidatas = this.candidatasJulich?.length ? this.candidatasJulich : [this.parcellation];
        let itens = [];
        let escolhida = this.parcellation;
        for (const candidata of candidatas) {
            try {
                const resposta = await json(urlComParametros("/maps", { parcellation_id: candidata.id, map_type: "LABELLED", size: 100, page: 1 }));
                const encontrados = resposta?.items || [];
                if (encontrados.length) {
                    itens = encontrados;
                    escolhida = candidata;
                    break;
                }
            } catch {}
        }
        if (!itens.length) throw new Error("Nenhum mapa rotulado Julich-Brain foi encontrado.");
        this.parcellation = escolhida;
        const preferido = itens.find(item => {
            const texto = `${item.name || ""} ${item.variant || ""} ${item.space?.name || ""}`.toLowerCase();
            return texto.includes("mni") || texto.includes("icbm");
        }) || itens.find(item => item?.space?.["@id"]) || itens[0];
        this.mapa = {
            id: idDe(preferido),
            nome: preferido?.name || preferido?.shortname || "Mapa rotulado",
            tipo: preferido?.maptype || "LABELLED",
            modalidade: preferido?.modality || "",
            space: preferido?.space || null,
            providedVolumes: preferido?.providedVolumes || {},
            bruto: preferido
        };
        this.espacoId = idDe(preferido?.space) || preferido?.space?.id || "";
        if (!this.espacoId) throw new Error("O mapa não informou um espaço de referência.");
        try {
            const espaco = await json(`${BASE}/spaces/${encodeURIComponent(this.espacoId)}`);
            this.espacoNome = espaco?.name || espaco?.shortName || this.espacoId;
        } catch {
            this.espacoNome = this.espacoId;
        }
        return this.mapa;
    }

    async carregarRegioes() {
        if (!this.parcellation?.id) throw new Error("Parcellation não definida.");
        const primeira = await json(urlComParametros("/regions", { parcellation_id: this.parcellation.id, size: 100, page: 1 }));
        const regioes = (primeira?.items || []).map(normalizarRegiao);
        const paginas = Math.min(primeira?.pages || 1, 12);
        for (let pagina = 2; pagina <= paginas; pagina++) {
            const resposta = await json(urlComParametros("/regions", { parcellation_id: this.parcellation.id, size: 100, page: pagina }));
            regioes.push(...(resposta?.items || []).map(normalizarRegiao));
        }
        const unicas = new Map();
        regioes.forEach(item => {
            const chave = item.id || `${item.nome}|${item.numeroInterno}`;
            if (!unicas.has(chave)) unicas.set(chave, item);
        });
        this.regioes = [...unicas.values()].sort((a,b) => a.nome.localeCompare(b.nome, "pt-BR"));
        this.reconstruirIndice();
        return this.regioes;
    }

    async sincronizar() {
        if (!this.parcellation) await this.localizarJulich();
        if (!this.mapa || !this.espacoId) await this.localizarMapa();
        if (!this.regioes.length) await this.carregarRegioes();
        this.sincronizado = true;
        this.salvarCache();
        return this.resumo();
    }

    resumo() {
        return {
            parcellation: this.parcellation,
            mapa: this.mapa,
            espacoId: this.espacoId,
            espacoNome: this.espacoNome,
            quantidadeRegioes: this.regioes.length
        };
    }

    filtrar(termo = "") {
        const texto = termo.trim().toLocaleLowerCase("pt-BR");
        if (!texto) return this.regioes;
        return this.regioes.filter(regiao => `${regiao.nome} ${regiao.lookup} ${regiao.pai.join(" ")}`.toLocaleLowerCase("pt-BR").includes(texto));
    }

    async buscarRegioesRemotas(termo) {
        if (!this.parcellation?.id) await this.sincronizar();
        const resposta = await json(urlComParametros("/regions", { parcellation_id: this.parcellation.id, find: termo, size: 100, page: 1 }));
        return (resposta?.items || []).map(normalizarRegiao);
    }

    async detalharRegiao(regiao) {
        if (!regiao?.id) return { regiao, detalhes: regiao?.bruto || null, features: [] };
        const caminho = `/regions/${encodeURIComponent(regiao.id)}`;
        const parametros = { parcellation_id: this.parcellation.id, space_id: this.espacoId || undefined };
        const detalhes = await json(urlComParametros(caminho, parametros));
        let features = [];
        try {
            const respostaFeatures = await json(urlComParametros(`${caminho}/features`, { parcellation_id: this.parcellation.id, size: 100, page: 1 }), 18000);
            features = respostaFeatures?.items || [];
        } catch {}
        return { regiao: normalizarRegiao(detalhes), detalhes, features };
    }

    async carregarMascara(regiao = null) {
        if (!this.parcellation?.id || !this.espacoId) await this.sincronizar();
        const parametros = { parcellation_id: this.parcellation.id, space_id: this.espacoId };
        if (regiao?.id) parametros.region_id = regiao.id;
        const resposta = await requisicao(urlComParametros("/map/labelled_map.nii.gz", parametros), {}, 60000);
        const buffer = await resposta.arrayBuffer();
        return await lerNifti(buffer);
    }

    async listarGenes(termo = "") {
        const resposta = await json(urlComParametros("/vocabularies/genes", { find: termo || undefined, size: 30, page: 1 }));
        return resposta?.items || [];
    }

    async listarGenesDaRegiao(regiao, gene) {
        if (!regiao?.id || !this.parcellation?.id || !gene) return [];
        try {
            const resposta = await json(urlComParametros("/feature/GeneExpressions", {
                parcellation_id: this.parcellation.id,
                region_id: regiao.id,
                gene,
                size: 50,
                page: 1
            }), 18000);
            return resposta?.items || [];
        } catch {
            return [];
        }
    }

    regiaoPorNumero(numero) {
        return this.indicePorNumero.get(Number(numero)) || null;
    }
}
