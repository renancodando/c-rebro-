import { CerebroInterativo } from "./cerebro.js";
import { AtlasEbrains } from "./atlas-ebrains.js";
import { pesquisarLiteratura, testesApis } from "./integracoes.js";
import { desenharCorteNifti } from "./nifti.js";

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];

const MODOS={
    visao:{titulo:"O cérebro como<br>você nunca abriu.",descricao:"Explore uma reconstrução digital com desmontagem hierárquica, cortes, literatura científica e dados públicos de neurociência."},
    anatomia:{titulo:"Anatomia que<br>responde ao toque.",descricao:"Torne o tecido transparente, isole estruturas internas e conecte cada seleção ao atlas científico."},
    atividade:{titulo:"Sinais percorrem<br>a matéria.",descricao:"Uma camada visual simula propagação e conectividade sem confundir animação educativa com medição clínica real."},
    explodido:{titulo:"Desmonte até<br>o impossível.",descricao:"Passe de hemisférios a estruturas, regiões e centenas de partes, mantendo cada elemento selecionável e pesquisável."},
    corte:{titulo:"Atravesse o<br>cérebro em tempo real.",descricao:"Mude entre planos sagital, coronal e axial e deslize o corte diretamente sobre o modelo tridimensional."},
    imersao:{titulo:"Do cérebro<br>à sinapse.",descricao:"Atravesse cinco escalas: cérebro, região, tecido, neurônio e sinapse. No nível celular, a Biblioteca tenta carregar uma reconstrução real do NeuroMorpho."}
};

const ESCALAS=[
    {nome:"Cérebro",valor:"macro",status:"Cérebro completo: anatomia global e orientação espacial."},
    {nome:"Região",valor:"região",status:"Região isolada: examine a estrutura selecionada antes de entrar no tecido."},
    {nome:"Tecido",valor:"tecido",status:"Tecido neural: células, fibras e microvasculatura em visualização educativa."},
    {nome:"Neurônio",valor:"célula",status:"Neurônio: procurando uma reconstrução morfológica real no NeuroMorpho.Org."},
    {nome:"Sinapse",valor:"sinapse",status:"Sinapse: visualização microscópica educativa de terminal, vesículas, fenda e espinha dendrítica."}
];

const atlas=new AtlasEbrains();
let cerebro;
let dadosLocais=[];
let modoAtual="visao";
let abaAtual="dados";
let selecaoAtual=null;
let regiaoAtlasAtual=null;
let detalheEbrainsAtual=null;
let volumeAtual=null;
let maximoCortesAtual={};
const cacheEstudos=new Map();
const cacheGenes=new Map();
let toastTimer=null;

function escapar(valor){return String(valor??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function nomeSelecao(){return regiaoAtlasAtual?.nome||selecaoAtual?.nome||"cérebro humano";}

function toast(texto){
    const el=$("#toast");el.textContent=texto;el.classList.add("visivel");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("visivel"),3600);
}

function abrirModal(id){const el=$(id);el.classList.add("aberto");el.setAttribute("aria-hidden","false");}
function fecharModal(id){const el=$(id);el.classList.remove("aberto");el.setAttribute("aria-hidden","true");}

function progresso(valor,texto){
    const v=Math.max(0,Math.min(100,valor));
    $("#progressoCarregamento").textContent=`${Math.round(v)}%`;
    $("#barraCarregamento").style.width=`${v}%`;
    if(texto)$("#textoCarregamento").textContent=texto;
}

async function carregarDadosLocais(){
    try{const r=await fetch("./dados/regioes.json");dadosLocais=(await r.json())?.regioes||[];}catch{dadosLocais=[];}
}

function atualizarStatusAtlas(estado,texto){
    const ponto=$("#statusAtlasCompacto .ponto-online");
    ponto.classList.remove("ok","erro","carregando");ponto.classList.add(estado);
    $("#textoAtlasCompacto").textContent=texto;
    $("#statusAtlas").textContent=texto;
}

function atualizarResumoAtlas(){
    const resumo=atlas.resumo();
    $("#nomeParcellation").textContent=resumo.parcellation?.nome||"—";
    $("#nomeEspaco").textContent=resumo.espacoNome||resumo.espacoId||"—";
    $("#quantidadeRegioes").textContent=resumo.quantidadeRegioes?String(resumo.quantidadeRegioes):"—";
    if(resumo.quantidadeRegioes){
        $("#metricaRegioes").textContent=resumo.quantidadeRegioes;
        atualizarStatusAtlas("ok",`${resumo.quantidadeRegioes} regiões em cache`);
    }
}

async function sincronizarAtlas(forcar=false){
    const botao=$("#sincronizarAtlas");botao.disabled=true;botao.textContent="Sincronizando…";
    atualizarStatusAtlas("carregando","Consultando siibra…");
    try{
        if(forcar){atlas.parcellation=null;atlas.mapa=null;atlas.espacoId=null;atlas.regioes=[];}
        const resumo=await atlas.sincronizar();
        cerebro.mapearRegioesReais(atlas.regioes);
        atualizarResumoAtlas();
        renderizarListaAtlas($("#filtroRegioes").value);
        atualizarStatusAtlas("ok",`${resumo.quantidadeRegioes} regiões sincronizadas`);
        toast(`Atlas EBRAINS sincronizado: ${resumo.quantidadeRegioes} regiões.`);
        return resumo;
    }catch(erro){
        atualizarStatusAtlas("erro","EBRAINS indisponível agora");
        toast(`Não foi possível sincronizar o atlas: ${erro.message}`);
        throw erro;
    }finally{botao.disabled=false;botao.textContent="Sincronizar regiões";}
}

function definirModo(modo){
    modoAtual=modo;
    $$("[data-modo]").forEach(b=>b.classList.toggle("ativo",b.dataset.modo===modo));
    const c=MODOS[modo]||MODOS.visao;
    $("#tituloModo").innerHTML=c.titulo;$("#descricaoModo").textContent=c.descricao;
    $("#painelExplosao").classList.toggle("visivel",modo==="explodido");
    $("#painelCorte").classList.toggle("visivel",modo==="corte");
    $("#painelMicroscopia").classList.toggle("visivel",modo==="imersao");
    const ocultarHero=window.innerWidth<820&&["explodido","corte","imersao"].includes(modo);
    $("#hero").classList.toggle("oculto",ocultarHero);
    cerebro.definirModo(modo);
    if(window.innerWidth<=1080)$("#lateral").classList.remove("aberta");
}

function localPorNome(nome){
    const n=String(nome||"").toLocaleLowerCase("pt-BR");
    return dadosLocais.find(r=>{const a=r.nome.toLocaleLowerCase("pt-BR");return a===n||a.includes(n)||n.includes(a);})||null;
}

function selecionarDoCerebro(dados){
    selecaoAtual=dados;
    if(dados?.regiao){
        regiaoAtlasAtual=dados.regiao;detalheEbrainsAtual=null;
    }else{
        regiaoAtlasAtual=null;detalheEbrainsAtual=null;
    }
    $("#rotuloPainel").textContent=dados?.grupo||"Estrutura selecionada";
    $("#nomeRegiao").textContent=dados?.nome||"Estrutura";
    $("#seloOrigem").textContent=dados?.origem==="EBRAINS"?"EBRAINS":"3D";
    $("#estruturaFlutuante").textContent=dados?.nome||"Estrutura";
    $("#origemFlutuante").textContent=dados?.origem==="EBRAINS"?"região do atlas real":"modelo anatômico interativo";
    renderizarPainel();
    if(regiaoAtlasAtual)carregarDetalheEbrains(regiaoAtlasAtual,false);
}

async function selecionarRegiaoAtlas(regiao,abrirNo3d=false){
    regiaoAtlasAtual=regiao;selecaoAtual={nome:regiao.nome,grupo:regiao.pai?.at(-1)||"EBRAINS",origem:"EBRAINS",regiao};detalheEbrainsAtual=null;
    $("#rotuloPainel").textContent="siibra / EBRAINS";$("#nomeRegiao").textContent=regiao.nome;$("#seloOrigem").textContent="EBRAINS";
    $("#estruturaFlutuante").textContent=regiao.nome;$("#origemFlutuante").textContent="metadados reais de atlas";
    $$(".regiao-atlas").forEach(b=>b.classList.toggle("ativa",b.dataset.id===regiao.id));
    renderizarPainel();
    renderizarDetalheAtlas({regiao});
    if(abrirNo3d)cerebro.focarNome(regiao.nome);
    await carregarDetalheEbrains(regiao,true);
}

async function carregarDetalheEbrains(regiao,atualizarModal=true){
    try{
        const resultado=await atlas.detalharRegiao(regiao);
        if(regiaoAtlasAtual?.id!==regiao.id)return;
        detalheEbrainsAtual=resultado;
        regiaoAtlasAtual=resultado.regiao||regiao;
        if(abaAtual==="ebrains")renderizarPainel();
        if(atualizarModal)renderizarDetalheAtlas(resultado);
    }catch(erro){
        if(atualizarModal)renderizarDetalheAtlas({regiao,erro:erro.message});
    }
}

function renderizarPainel(){
    const alvo=$("#conteudoPainel");
    const nome=nomeSelecao();
    const local=localPorNome(nome);
    if(abaAtual==="dados"){
        const descricao=local?.descricao|| (regiaoAtlasAtual?"Região carregada da hierarquia do siibra/EBRAINS. Abra a aba EBRAINS para metadados e features do atlas.":"Selecione uma estrutura para exibir dados anatômicos e abrir as camadas científicas associadas.");
        alvo.innerHTML=`<div class="painel-regiao"><p class="descricao">${escapar(descricao)}</p><div class="etiquetas"><span>${escapar(selecaoAtual?.grupo||regiaoAtlasAtual?.pai?.at(-1)||"Cérebro")}</span><span>${regiaoAtlasAtual?"Atlas real":"Visualização 3D"}</span>${regiaoAtlasAtual?.laterality?`<span>${escapar(regiaoAtlasAtual.laterality)}</span>`:""}</div><div class="aviso-cientifico"><span>i</span><p>${regiaoAtlasAtual?"Os metadados desta seleção vêm do siibra/EBRAINS; a aparência visual só é anatomia volumétrica real quando uma máscara ou mapa NIfTI está materializado.":"O cérebro-base é uma reconstrução visual procedural realista para interação. Dados de atlas e literatura são identificados separadamente."}</p></div></div>`;
        return;
    }
    if(abaAtual==="funcoes"){
        const funcoes=local?.funcoes||["Exploração anatômica", "Consulta de literatura associada", "Isolamento e visualização espacial"];
        alvo.innerHTML=`<div class="lista-funcoes">${funcoes.map(f=>`<div>${escapar(f)}</div>`).join("")}</div>`;
        return;
    }
    if(abaAtual==="ebrains"){
        if(!regiaoAtlasAtual){
            alvo.innerHTML=`<div class="vazio">Esta seleção ainda não está vinculada a uma região do atlas.</div><button class="botao-painel" id="localizarAtualEbrains">Localizar “${escapar(nome)}” no EBRAINS</button>`;
            $("#localizarAtualEbrains")?.addEventListener("click",()=>localizarAtualNoAtlas());
            return;
        }
        if(!detalheEbrainsAtual){alvo.innerHTML=`<div class="carregando-painel">Consultando metadados e features do EBRAINS…</div>`;return;}
        const r=detalheEbrainsAtual.regiao||regiaoAtlasAtual;
        const features=detalheEbrainsAtual.features||[];
        alvo.innerHTML=`<div class="dado-eb"><span>Nome</span><strong>${escapar(r.nome)}</strong></div><div class="dado-eb"><span>ID</span><strong>${escapar(r.id)}</strong></div><div class="dado-eb"><span>Identificador interno</span><strong>${escapar(r.numeroInterno??"não informado")}</strong></div><div class="dado-eb"><span>Hierarquia</span><strong>${escapar(r.pai?.join(" → ")||"não informada")}</strong></div><div class="dado-eb"><span>Features retornadas</span><strong>${features.length}</strong></div><button class="botao-painel" id="carregarMascaraPainel">Carregar máscara NIfTI real</button>`;
        $("#carregarMascaraPainel")?.addEventListener("click",()=>carregarMascaraRegiao(r));
        return;
    }
    if(abaAtual==="estudos"){
        renderizarEstudos(nome,alvo);return;
    }
    if(abaAtual==="genes"){
        renderizarGenes(alvo);return;
    }
}

async function renderizarEstudos(nome,alvo){
    if(cacheEstudos.has(nome)){mostrarEstudos(cacheEstudos.get(nome),alvo);return;}
    alvo.innerHTML=`<div class="carregando-painel">Pesquisando PubMed e Crossref…</div>`;
    try{const itens=await pesquisarLiteratura(nome);cacheEstudos.set(nome,itens);if(abaAtual==="estudos"&&nome===nomeSelecao())mostrarEstudos(itens,alvo);}catch{alvo.innerHTML=`<div class="vazio">As fontes de literatura não responderam agora.</div>`;}
}

function mostrarEstudos(itens,alvo){
    if(!itens?.length){alvo.innerHTML=`<div class="vazio">Nenhum estudo retornado para esta consulta.</div>`;return;}
    alvo.innerHTML=itens.slice(0,10).map((i,idx)=>`<div class="estudo-item"><b>${escapar(i.titulo)}</b><span>${escapar(i.fonte)}${i.detalhe?` · ${escapar(i.detalhe)}`:""}</span>${i.url?`<button class="botao-painel abrir-url" data-url="${escapar(i.url)}">Abrir fonte</button>`:""}</div>`).join("");
    $$(".abrir-url").forEach(b=>b.addEventListener("click",()=>window.open(b.dataset.url,"_blank","noopener,noreferrer")));
}

async function renderizarGenes(alvo){
    if(!regiaoAtlasAtual){
        alvo.innerHTML=`<div class="vazio">Selecione ou localize uma região do EBRAINS antes de consultar expressão gênica.</div><button class="botao-painel" id="localizarGeneRegiao">Localizar seleção no atlas</button>`;
        $("#localizarGeneRegiao")?.addEventListener("click",()=>localizarAtualNoAtlas());
        return;
    }
    alvo.innerHTML=`<div class="consulta-gene"><span>Expressão gênica via siibra</span><div class="gene-busca"><input id="campoGene" type="search" value="BDNF" placeholder="Símbolo do gene, ex.: BDNF"><button class="botao-painel" id="buscarGene">Consultar</button></div><div class="genes-rapidos"><button data-gene="BDNF">BDNF</button><button data-gene="APOE">APOE</button><button data-gene="FOXP2">FOXP2</button><button data-gene="COMT">COMT</button><button data-gene="DRD2">DRD2</button></div><div id="resultadoGenes" class="resultado-genes"><div class="vazio">Escolha um gene para consultar a região selecionada.</div></div></div>`;
    const executar=async gene=>{
        const simbolo=String(gene||$("#campoGene")?.value||"").trim().toUpperCase();
        const resultado=$("#resultadoGenes");
        if(!simbolo||!resultado)return;
        $("#campoGene").value=simbolo;
        const chave=`${regiaoAtlasAtual.id}|${simbolo}`;
        resultado.innerHTML=`<div class="carregando-painel">Consultando ${escapar(simbolo)} no siibra…</div>`;
        try{
            let itens=cacheGenes.get(chave);
            if(!itens){itens=await atlas.listarGenesDaRegiao(regiaoAtlasAtual,simbolo);cacheGenes.set(chave,itens);}
            mostrarGenes(itens,resultado,simbolo);
        }catch{resultado.innerHTML=`<div class="vazio">A fonte não retornou expressão para ${escapar(simbolo)} nesta região.</div>`;}
    };
    $("#buscarGene")?.addEventListener("click",()=>executar());
    $("#campoGene")?.addEventListener("keydown",e=>{if(e.key==="Enter")executar();});
    $$("[data-gene]").forEach(b=>b.addEventListener("click",()=>executar(b.dataset.gene)));
}

function mostrarGenes(itens,alvo,gene=""){
    if(!itens?.length){alvo.innerHTML=`<div class="vazio">O siibra não retornou uma feature de expressão de ${escapar(gene||"gene")} para esta região. Isso não significa ausência biológica; apenas ausência de um resultado disponível nesse endpoint.</div>`;return;}
    alvo.innerHTML=itens.slice(0,20).map(i=>`<div class="dado-eb"><span>${escapar(i.category||i.modality||gene||"Gene expression")}</span><strong>${escapar(i.name||i.symbol||i.description||i.id||"Feature")}</strong></div>`).join("");
}

async function localizarAtualNoAtlas(){
    try{
        if(!atlas.sincronizado)await sincronizarAtlas();
        const termo=nomeSelecao();
        let candidatos=atlas.filtrar(termo);
        if(!candidatos.length)candidatos=await atlas.buscarRegioesRemotas(termo);
        if(!candidatos.length){toast("Nenhuma região correspondente encontrada no EBRAINS.");return;}
        await selecionarRegiaoAtlas(candidatos[0],true);
        abaAtual="ebrains";$$(".aba").forEach(b=>b.classList.toggle("ativo",b.dataset.aba===abaAtual));renderizarPainel();
    }catch{}
}

function renderizarListaAtlas(termo=""){
    const alvo=$("#listaRegioes");
    if(!atlas.regioes.length){alvo.innerHTML=`<div class="vazio">Sincronize o atlas para carregar as regiões reais.</div>`;return;}
    const itens=atlas.filtrar(termo).slice(0,450);
    alvo.innerHTML=itens.map(r=>`<button class="regiao-atlas" data-id="${escapar(r.id)}"><strong>${escapar(r.nome)}</strong><span>${r.numeroInterno??""}</span></button>`).join("")||`<div class="vazio">Nenhuma região corresponde ao filtro.</div>`;
    $$(".regiao-atlas").forEach(botao=>botao.addEventListener("click",()=>{
        const r=atlas.regioes.find(x=>x.id===botao.dataset.id);if(r)selecionarRegiaoAtlas(r,false);
    }));
}

function renderizarDetalheAtlas(resultado){
    const alvo=$("#atlasDetalhe"),r=resultado.regiao;
    if(!r){alvo.innerHTML=`<span>Dados do atlas</span><h3>Selecione uma região</h3><p>Escolha uma estrutura na lista para consultar seus metadados.</p>`;return;}
    const features=resultado.features||[];
    alvo.innerHTML=`<span>Região do atlas</span><h3>${escapar(r.nome)}</h3><p>${resultado.erro?escapar(resultado.erro):`ID: ${escapar(r.id)}${r.pai?.length?`<br>Hierarquia: ${escapar(r.pai.join(" → "))}`:""}<br>Features encontradas: ${features.length}`}</p><div class="acoes-detalhe"><button class="botao-principal" id="mostrarMascaraAtual">Máscara NIfTI real</button><button class="botao-contorno" id="usarRegiaoNo3d">Selecionar no 3D</button></div>`;
    $("#mostrarMascaraAtual")?.addEventListener("click",()=>carregarMascaraRegiao(r));
    $("#usarRegiaoNo3d")?.addEventListener("click",()=>{cerebro.focarNome(r.nome);fecharModal("#painelAtlas");definirModo("anatomia");});
}

async function carregarMascaraRegiao(regiao){
    const origem=$("#mostrarMascaraAtual")||$("#carregarMascaraPainel");
    if(origem)origem.disabled=true;
    atualizarStatusAtlas("carregando","Baixando máscara NIfTI…");
    try{
        volumeAtual=await atlas.carregarMascara(regiao);
        maximoCortesAtual={};
        await cerebro.mostrarMascara(volumeAtual,regiao,t=>atualizarStatusAtlas("carregando",t));
        $("#tituloMascara").textContent=regiao.nome;
        abrirModal("#painelMascara");
        requestAnimationFrame(()=>desenharTodosCortes());
        atualizarStatusAtlas("ok","Máscara real carregada");
        selecionarRegiaoAtlas(regiao,false);
        toast("Máscara volumétrica real carregada no 3D e nos três planos de corte.");
    }catch(erro){atualizarStatusAtlas("erro","Falha ao carregar máscara");toast(`Máscara não disponível: ${erro.message}`);}finally{if(origem)origem.disabled=false;}
}

function desenharTodosCortes(){
    if(!volumeAtual)return;
    [["sagital","#corteSagital"],["coronal","#corteCoronal"],["axial","#corteAxial"]].forEach(([plano,seletor])=>{
        const range=$(`[data-corte-nifti="${plano}"]`);const percentual=Number(range?.value||50);
        const resultado=desenharCorteNifti(volumeAtual,$(seletor),plano,percentual,{maximo:maximoCortesAtual[plano]});
        maximoCortesAtual[plano]=resultado.maximo;
    });
}

async function materializarAtlasCompleto(){
    const botao=$("#materializarAtlas");botao.disabled=true;botao.textContent="Preparando volume…";
    try{
        if(!atlas.sincronizado)await sincronizarAtlas();
        atualizarStatusAtlas("carregando","Baixando mapa rotulado…");
        const volume=await atlas.carregarMascara(null);
        botao.textContent="Construindo 3D…";
        const resultado=await cerebro.materializarAtlas(volume,atlas,t=>{atualizarStatusAtlas("carregando",t);});
        atualizarStatusAtlas("ok",`${resultado.quantidade} rótulos 3D reais`);
        $("#seloOrigem").textContent="ATLAS";
        fecharModal("#painelAtlas");definirModo("explodido");
        toast(`Atlas volumétrico materializado: ${resultado.quantidade} rótulos detectados no mapa.`);
    }catch(erro){atualizarStatusAtlas("erro","Mapa completo indisponível");toast(`Não foi possível materializar o mapa completo: ${erro.message}`);}finally{botao.disabled=false;botao.textContent="Materializar atlas 3D";}
}

function atualizarExplosao(valor){
    const n=Number(valor);cerebro.definirExplosao(n/100);$("#valorExplosao").textContent=`${n}%`;
    const nome=n<12?"Cérebro completo":n<35?"Hemisférios":n<58?"Grandes estruturas":n<82?"Regiões":"Partes individuais";
    $("#nomeNivelExplosao").textContent=nome;
}

function atualizarCorte(valor){const n=Number(valor);cerebro.definirCorte(n);$("#valorCorte").textContent=`${n>0?"+":""}${n}%`;}

async function definirEscala(nivel){
    nivel=Number(nivel);const info=ESCALAS[nivel]||ESCALAS[0];
    $$("[data-escala]").forEach(b=>{const n=Number(b.dataset.escala);b.classList.toggle("ativo",n===nivel);b.classList.toggle("passado",n<nivel);});
    $("#nomeEscala").textContent=info.nome;$("#valorEscala").textContent=info.valor;$("#microStatus").textContent=info.status;
    cerebro.definirNivelMicroscopia(nivel);
    if(nivel===3){
        const nome=nomeSelecao();
        const resultado=await cerebro.carregarNeuronioReal(nome,t=>$("#microStatus").textContent=t);
        if(resultado.real){$("#seloOrigem").textContent="NMO";toast(`Neurônio real carregado do NeuroMorpho: ${resultado.neuronio?.neuron_name||"reconstrução SWC"}.`);}else if(resultado.neuronio){$("#seloOrigem").textContent="NMO+3D";}
    }
    if(nivel===4)$("#seloOrigem").textContent="SIMULAÇÃO";
}

async function executarTestesApis(){
    const b=$("#testarApis");b.disabled=true;b.textContent="Testando…";
    await Promise.all(Object.entries(testesApis).map(async([nome,teste])=>{
        const linha=$(`.api-linha[data-api="${nome}"]`);linha.classList.remove("ok","erro");
        try{linha.classList.add(await teste()?"ok":"erro");}catch{linha.classList.add("erro");}
    }));
    b.disabled=false;b.textContent="Testar agora";
}

async function pesquisaGeral(){
    const termo=$("#campoPesquisa").value.trim(),alvo=$("#resultadoPesquisa");if(!termo)return;
    alvo.innerHTML=`<div class="carregando-painel">Consultando PubMed e Crossref…</div>`;cerebro.focarNome(termo);
    try{const itens=await pesquisarLiteratura(termo);cacheEstudos.set(termo,itens);mostrarResultadosPesquisa(itens,alvo);}catch{alvo.innerHTML=`<div class="vazio">As fontes de literatura não responderam agora.</div>`;}
}

function mostrarResultadosPesquisa(itens,alvo){
    if(!itens.length){alvo.innerHTML=`<div class="vazio">Nenhum resultado foi encontrado.</div>`;return;}
    alvo.innerHTML=itens.slice(0,14).map(i=>`<article class="resultado-item"><strong>${escapar(i.titulo)}</strong><span>${escapar(i.fonte)}${i.detalhe?` · ${escapar(i.detalhe)}`:""}</span>${i.url?`<button data-url="${escapar(i.url)}">Abrir publicação</button>`:""}</article>`).join("");
    $$("#resultadoPesquisa [data-url]").forEach(b=>b.addEventListener("click",()=>window.open(b.dataset.url,"_blank","noopener,noreferrer")));
}

async function buscarTermoNoAtlas(){
    const termo=$("#campoPesquisa").value.trim();if(!termo)return;
    try{
        if(!atlas.sincronizado)await sincronizarAtlas();
        const itens=atlas.filtrar(termo).slice(0,30);
        const alvo=$("#resultadoPesquisa");
        if(!itens.length){alvo.innerHTML=`<div class="vazio">Nenhuma região do atlas contém “${escapar(termo)}”.</div>`;return;}
        alvo.innerHTML=itens.map(r=>`<article class="resultado-item"><strong>${escapar(r.nome)}</strong><span>siibra / EBRAINS · ${escapar(r.pai?.at(-1)||"região")}</span><button data-regiao-id="${escapar(r.id)}">Abrir região</button></article>`).join("");
        $$("[data-regiao-id]").forEach(b=>b.addEventListener("click",()=>{const r=atlas.regioes.find(x=>x.id===b.dataset.regiaoId);if(r){selecionarRegiaoAtlas(r,true);fecharModal("#painelPesquisa");definirModo("anatomia");}}));
    }catch{}
}

function renderizarGrafico(){
    const canvas=$("#graficoAtividade"),ctx=canvas.getContext("2d"),dpr=Math.min(devicePixelRatio||1,2),w=canvas.clientWidth||280,h=canvas.clientHeight||82;
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    ctx.strokeStyle="rgba(232,223,207,.055)";ctx.lineWidth=1;for(let y=12;y<h;y+=18){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
    const t=performance.now()*.0015;
    [["rgba(119,189,163,.85)",0,11],["rgba(189,113,75,.82)",1.7,16],["rgba(232,223,207,.25)",3.2,7]].forEach(([cor,fase,amp],idx)=>{
        ctx.strokeStyle=cor;ctx.lineWidth=1;ctx.beginPath();
        for(let x=0;x<=w;x+=3){const y=h*.5+Math.sin(x*(.055+idx*.008)+t*(1.2+idx*.22)+fase)*amp+Math.sin(x*.16+fase)*3;x===0?ctx.moveTo(x,y):ctx.lineTo(x,y);}ctx.stroke();
    });
    requestAnimationFrame(renderizarGrafico);
}

function configurarEventos(){
    $$("[data-modo]").forEach(b=>b.addEventListener("click",()=>definirModo(b.dataset.modo)));
    $$(".aba").forEach(b=>b.addEventListener("click",()=>{abaAtual=b.dataset.aba;$$(".aba").forEach(x=>x.classList.toggle("ativo",x===b));renderizarPainel();}));
    $("#controleExplosao").addEventListener("input",e=>atualizarExplosao(e.target.value));
    $("#controleCorte").addEventListener("input",e=>atualizarCorte(e.target.value));
    $$("[data-plano]").forEach(b=>b.addEventListener("click",()=>{$$("[data-plano]").forEach(x=>x.classList.toggle("ativo",x===b));cerebro.definirPlanoCorte(b.dataset.plano);$("#nomePlanoCorte").textContent=b.textContent;atualizarCorte($("#controleCorte").value);}));
    $$("[data-escala]").forEach(b=>b.addEventListener("click",()=>definirEscala(b.dataset.escala)));
    $("#comecarExploracao").addEventListener("click",()=>definirModo("anatomia"));
    $("#demonstrarExplosao").addEventListener("click",()=>{definirModo("explodido");$("#controleExplosao").value=86;atualizarExplosao(86);});
    $("#acaoRemontar").addEventListener("click",()=>{cerebro.remontar();$("#controleExplosao").value=0;atualizarExplosao(0);});
    $("#acaoIsolar").addEventListener("click",()=>{if(!cerebro.isolarSelecao())toast("Selecione uma estrutura antes de isolar.");});
    $("#acaoTransparencia").addEventListener("click",()=>cerebro.alternarTransparencia());
    $("#acaoRotacao").addEventListener("click",()=>cerebro.alternarRotacao());
    $("#acaoResetarCamera").addEventListener("click",()=>cerebro.resetarCamera());
    $("#abrirMenu").addEventListener("click",()=>$("#lateral").classList.add("aberta"));
    $("#fecharMenu").addEventListener("click",()=>$("#lateral").classList.remove("aberta"));
    $("#voltarInicio").addEventListener("click",()=>{cerebro.desativarAtlasReal();cerebro.remontar();cerebro.resetarCamera();definirModo("visao");});
    $("#abrirPesquisa").addEventListener("click",()=>{abrirModal("#painelPesquisa");setTimeout(()=>$("#campoPesquisa").focus(),100);});
    $("#fecharPesquisa").addEventListener("click",()=>fecharModal("#painelPesquisa"));
    $("#abrirAtlas").addEventListener("click",()=>{abrirModal("#painelAtlas");renderizarListaAtlas($("#filtroRegioes").value);});
    $("#fecharAtlas").addEventListener("click",()=>fecharModal("#painelAtlas"));
    $("#fecharMascara").addEventListener("click",()=>fecharModal("#painelMascara"));
    $("#fecharCiencia")?.addEventListener("click",()=>fecharModal("#painelCiencia"));
    $("#testarApis").addEventListener("click",executarTestesApis);
    $("#sincronizarAtlas").addEventListener("click",()=>sincronizarAtlas(true).catch(()=>{}));
    $("#materializarAtlas").addEventListener("click",materializarAtlasCompleto);
    $("#filtroRegioes").addEventListener("input",e=>renderizarListaAtlas(e.target.value));
    $("#pesquisarCiencia").addEventListener("click",pesquisaGeral);$("#buscarNoAtlas").addEventListener("click",buscarTermoNoAtlas);
    $("#campoPesquisa").addEventListener("keydown",e=>{if(e.key==="Enter")pesquisaGeral();});
    $$("[data-corte-nifti]").forEach(r=>r.addEventListener("input",()=>requestAnimationFrame(()=>desenharTodosCortes())));
    $("#alternarTelaCheia").addEventListener("click",async()=>{try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen();}catch{}});
    $("#abrirCiencia")?.addEventListener("click",()=>abrirModal("#painelCiencia"));
    $$(".modal").forEach(modal=>modal.addEventListener("pointerdown",e=>{if(e.target===modal)fecharModal(`#${modal.id}`);}));
    window.addEventListener("keydown",e=>{if(e.key==="Escape"){$$(".modal.aberto").forEach(m=>fecharModal(`#${m.id}`));$("#lateral").classList.remove("aberta");}});
    window.addEventListener("resize",()=>{if(volumeAtual)requestAnimationFrame(()=>desenharTodosCortes());});
}

function configurarSugestoes(){
    const nomes=["Hipocampo","Amígdala","Tálamo","Cerebelo","Córtex pré-frontal","Córtex visual","Memória","Linguagem","BDNF"];
    $("#sugestoesPesquisa").innerHTML=nomes.map(n=>`<button>${n}</button>`).join("");
    $$("#sugestoesPesquisa button").forEach(b=>b.addEventListener("click",()=>{$("#campoPesquisa").value=b.textContent;cerebro.focarNome(b.textContent);}));
}

async function iniciar(){
    progresso(7,"Construindo o ambiente tridimensional");
    cerebro=new CerebroInterativo($("#cenaCerebro"),selecionarDoCerebro);
    $("#fallback3D").classList.remove("visivel");
    progresso(32,"Preparando anatomia e 320 partes");
    await carregarDadosLocais();
    progresso(55,"Ativando pesquisa científica");
    configurarEventos();configurarSugestoes();renderizarGrafico();
    progresso(74,"Verificando cache do atlas");
    if(atlas.carregarCache()){
        cerebro.mapearRegioesReais(atlas.regioes);atualizarResumoAtlas();renderizarListaAtlas();
    }else atualizarStatusAtlas("carregando","Pronto para sincronizar");
    progresso(91,"Ajustando interface responsiva");
    atualizarExplosao(0);atualizarCorte(0);definirEscala(0);
    await new Promise(r=>setTimeout(r,220));
    progresso(100,"Pronto");
    setTimeout(()=>$("#carregamento").classList.add("oculto"),220);
    setTimeout(async()=>{
        if(!atlas.sincronizado){
            try{await sincronizarAtlas();}catch{}
        }
    },900);
    setTimeout(()=>executarTestesApis(),3600);
}

iniciar().catch(erro=>{
    console.error(erro);$("#textoCarregamento").textContent="A interface foi carregada com recursos reduzidos";$("#carregamento").classList.add("oculto");$("#fallback3D").classList.add("visivel");
});
