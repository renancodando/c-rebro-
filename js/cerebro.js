import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { MicroscopiaCerebral } from "./microscopia.js";
import { amostrarVolumePorRotulo } from "./nifti.js";

const PALETA_ATLAS = [0x77bda3,0xbd714b,0xd1b18e,0x869985,0xa85e4b,0xb7c0a9,0x987d69,0xc28c62,0x6f907c,0xc6a78a,0x8f6e61,0xa4b69f];
const NOMES_BASE = [
    "Córtex pré-frontal", "Córtex orbitofrontal", "Córtex motor", "Córtex pré-motor", "Córtex somatossensorial",
    "Córtex parietal", "Córtex visual", "Córtex temporal", "Ínsula", "Córtex cingulado", "Hipocampo", "Amígdala",
    "Tálamo", "Hipotálamo", "Estriado", "Núcleo caudado", "Putâmen", "Globo pálido", "Cerebelo", "Tronco encefálico"
];

function aleatorio(indice) {
    const x = Math.sin(indice * 127.1 + 311.7) * 43758.5453123;
    return x - Math.floor(x);
}

function suave(inicio, fim, valor) {
    const t = THREE.MathUtils.clamp((valor-inicio)/(fim-inicio),0,1);
    return t*t*(3-2*t);
}

function materialTecido(cor, opcoes={}) {
    return new THREE.MeshPhysicalMaterial({
        color: cor,
        roughness: opcoes.roughness ?? .68,
        metalness: 0,
        clearcoat: opcoes.clearcoat ?? .06,
        clearcoatRoughness: .72,
        transparent: true,
        opacity: opcoes.opacity ?? 1,
        transmission: opcoes.transmission ?? 0,
        side: THREE.DoubleSide,
        vertexColors: opcoes.vertexColors ?? false,
        emissive: opcoes.emissive ?? 0x000000,
        emissiveIntensity: opcoes.emissiveIntensity ?? 0
    });
}

function criarHemisferio(sinal, planoCorte) {
    const geometria = new THREE.SphereGeometry(1, 96, 68);
    const pos = geometria.attributes.position;
    const cores=[];
    const corSulco = new THREE.Color(0x6f5b50);
    const corGiro = new THREE.Color(0xaa8d7c);
    for (let i=0;i<pos.count;i++) {
        let x=pos.getX(i), y=pos.getY(i), z=pos.getZ(i);
        const fase = Math.sin(y*13.2 + z*5.7) * .55 + Math.sin(z*15.7 - y*3.3) * .28 + Math.sin((x+z)*20.5) * .17;
        const sulco = Math.abs(Math.sin(y*11.4 + Math.sin(z*5.2)*2.4) * Math.cos(z*9.1 + x*3.8));
        const deformacao = fase*.032 - Math.pow(sulco,8)*.055;
        const escala = 1 + deformacao;
        x*=escala; y*=escala; z*=escala;
        const medial = sinal < 0 ? x : -x;
        if (medial > .2) x *= .78;
        x = x*.63 + sinal*.56;
        y = y*1.03 + .12 - Math.max(0,z)*.04;
        z = z*1.28 - .05;
        pos.setXYZ(i,x,y,z);
        const mistura=THREE.MathUtils.clamp((deformacao+.06)/.105,0,1);
        const c=corSulco.clone().lerp(corGiro,mistura);
        cores.push(c.r,c.g,c.b);
    }
    geometria.setAttribute("color",new THREE.Float32BufferAttribute(cores,3));
    geometria.computeVertexNormals();
    const material = materialTecido(0xffffff,{vertexColors:true,roughness:.8,clearcoat:.025});
    material.clippingPlanes=[planoCorte];
    const malha = new THREE.Mesh(geometria,material);
    malha.userData = { tipo:"superficie", hemisferio:sinal<0?"esquerdo":"direito" };
    return malha;
}

function pontoInterno(indice) {
    for (let tentativa=0;tentativa<60;tentativa++) {
        const s=indice*73+tentativa*17;
        const x=aleatorio(s)*2-1;
        const y=aleatorio(s+1)*2-1;
        const z=aleatorio(s+2)*2-1;
        if ((x*x)/1.28+(y*y)/.86+(z*z)/1.42 < 1) return new THREE.Vector3(x*1.18,y*.92+.08,z*1.15-.06);
    }
    return new THREE.Vector3();
}

function corDeterministica(indice) {
    return PALETA_ATLAS[Math.abs(Math.round(indice)) % PALETA_ATLAS.length];
}

export class CerebroInterativo {
    constructor(canvas, aoSelecionar) {
        this.canvas=canvas;
        this.aoSelecionar=aoSelecionar;
        this.cena=new THREE.Scene();
        this.camera=new THREE.PerspectiveCamera(36,1,.05,120);
        this.camera.position.set(3.8,.8,5.4);
        this.renderizador=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:"high-performance",stencil:false});
        this.renderizador.setPixelRatio(Math.min(window.devicePixelRatio||1, window.innerWidth < 820 ? 1.25 : 1.65));
        this.renderizador.outputColorSpace=THREE.SRGBColorSpace;
        this.renderizador.toneMapping=THREE.ACESFilmicToneMapping;
        this.renderizador.toneMappingExposure=1.03;
        this.renderizador.localClippingEnabled=true;
        this.controles=new OrbitControls(this.camera,canvas);
        this.controles.enableDamping=true;
        this.controles.dampingFactor=.055;
        this.controles.enablePan=false;
        this.controles.minDistance=2.15;
        this.controles.maxDistance=10;
        this.controles.target.set(0,.05,0);
        this.controles.autoRotate=true;
        this.controles.autoRotateSpeed=.48;
        this.raio=new THREE.Raycaster();
        this.raio.params.Points.threshold=.07;
        this.mouse=new THREE.Vector2();
        this.planoCorte=new THREE.Plane(new THREE.Vector3(1,0,0),10);
        this.modo="visao";
        this.explosao=0;
        this.alvoExplosao=0;
        this.nivelMicro=0;
        this.transparente=false;
        this.selecionado=null;
        this.regioesReais=[];
        this.atlasRealAtivo=false;
        this.grupoCerebro=new THREE.Group();
        this.grupoFragmentos=new THREE.Group();
        this.grupoInterno=new THREE.Group();
        this.grupoAtlas=new THREE.Group();
        this.grupoMascara=new THREE.Group();
        this.cena.add(this.grupoCerebro,this.grupoFragmentos,this.grupoInterno,this.grupoAtlas,this.grupoMascara);
        this.fragmentos=[];
        this.objetosSelecionaveis=[];
        this.pontosAtlas=[];
        this.criarAmbiente();
        this.criarAnatomia();
        this.criarFragmentos();
        this.criarAtividade();
        this.microscopia=new MicroscopiaCerebral(this.cena);
        this.configurarEventos();
        this.redimensionar();
        this.animar();
    }

    criarAmbiente() {
        this.cena.fog=new THREE.FogExp2(0x090f0d,.058);
        this.cena.add(new THREE.HemisphereLight(0xe4dac7,0x152119,1.42));
        const luzPrincipal=new THREE.SpotLight(0xdacdb8,18,18,Math.PI/5,.72,1.6);
        luzPrincipal.position.set(-4,5,5);
        luzPrincipal.target.position.set(0,0,0);
        this.cena.add(luzPrincipal,luzPrincipal.target);
        const luzVerdete=new THREE.PointLight(0x77bda3,8,11,2);
        luzVerdete.position.set(3.4,1.7,-2.3);
        this.cena.add(luzVerdete);
        const luzCobre=new THREE.PointLight(0xbd714b,9,10,2);
        luzCobre.position.set(-2.6,-1.7,3.8);
        this.cena.add(luzCobre);
        const anel=new THREE.Mesh(new THREE.RingGeometry(1.45,1.46,120),new THREE.MeshBasicMaterial({color:0xbd714b,transparent:true,opacity:.2,side:THREE.DoubleSide}));
        anel.rotation.x=-Math.PI/2;
        anel.position.y=-1.48;
        anel.scale.set(1.25,1.25,1.25);
        this.anel=anel;
        this.cena.add(anel);
        const pontos=700;
        const pos=new Float32Array(pontos*3);
        for(let i=0;i<pontos;i++){
            pos[i*3]=(Math.random()-.5)*15;
            pos[i*3+1]=(Math.random()-.5)*9;
            pos[i*3+2]=(Math.random()-.5)*11;
        }
        const geo=new THREE.BufferGeometry();
        geo.setAttribute("position",new THREE.BufferAttribute(pos,3));
        this.poeira=new THREE.Points(geo,new THREE.PointsMaterial({color:0x8b9b8f,size:.008,transparent:true,opacity:.17,depthWrite:false}));
        this.cena.add(this.poeira);
        this.ajudanteCorte=new THREE.PlaneHelper(this.planoCorte,3.2,0xbd714b);
        this.ajudanteCorte.visible=false;
        this.cena.add(this.ajudanteCorte);
    }

    criarAnatomia() {
        this.hemisferioEsquerdo=criarHemisferio(-1,this.planoCorte);
        this.hemisferioDireito=criarHemisferio(1,this.planoCorte);
        this.grupoCerebro.add(this.hemisferioEsquerdo,this.hemisferioDireito);
        this.objetosSelecionaveis.push(this.hemisferioEsquerdo,this.hemisferioDireito);

        const cerebeloGeo=new THREE.SphereGeometry(.66,64,42);
        const p=cerebeloGeo.attributes.position;
        const cores=[];
        const escuro=new THREE.Color(0x6c594e),claro=new THREE.Color(0x9a7e6d);
        for(let i=0;i<p.count;i++){
            let x=p.getX(i),y=p.getY(i),z=p.getZ(i);
            const sulco=Math.abs(Math.sin(y*24+z*4));
            const f=1-sulco*.045;
            p.setXYZ(i,x*.92*f,y*.58*f,z*.82*f);
            const c=escuro.clone().lerp(claro,1-Math.pow(sulco,5));
            cores.push(c.r,c.g,c.b);
        }
        cerebeloGeo.setAttribute("color",new THREE.Float32BufferAttribute(cores,3));
        cerebeloGeo.computeVertexNormals();
        const cerebeloMat=materialTecido(0xffffff,{vertexColors:true,roughness:.82});
        cerebeloMat.clippingPlanes=[this.planoCorte];
        this.cerebelo=new THREE.Mesh(cerebeloGeo,cerebeloMat);
        this.cerebelo.position.set(.05,-.86,1.03);
        this.cerebelo.userData={tipo:"estrutura",nome:"Cerebelo",grupo:"Encéfalo posterior"};
        this.grupoCerebro.add(this.cerebelo);
        this.objetosSelecionaveis.push(this.cerebelo);

        const troncoMat=materialTecido(0x80695c,{roughness:.76});
        troncoMat.clippingPlanes=[this.planoCorte];
        this.tronco=new THREE.Mesh(new THREE.CapsuleGeometry(.22,.82,8,22),troncoMat);
        this.tronco.position.set(.04,-1.08,.42);
        this.tronco.rotation.x=.16;
        this.tronco.userData={tipo:"estrutura",nome:"Tronco encefálico",grupo:"Tronco encefálico"};
        this.grupoCerebro.add(this.tronco);
        this.objetosSelecionaveis.push(this.tronco);

        const criarElipsoide=(nome,grupo,posicao,escala,cor)=>{
            const mat=materialTecido(cor,{roughness:.55,opacity:.94,emissive:0x180b07,emissiveIntensity:.05});
            mat.clippingPlanes=[this.planoCorte];
            const m=new THREE.Mesh(new THREE.SphereGeometry(.25,30,22),mat);
            m.position.copy(posicao);m.scale.copy(escala);m.userData={tipo:"estrutura",nome,grupo};
            this.grupoInterno.add(m);this.objetosSelecionaveis.push(m);return m;
        };
        this.talamo=criarElipsoide("Tálamo","Diencéfalo",new THREE.Vector3(0,.0,.08),new THREE.Vector3(1.15,.78,.9),0x92715f);
        this.amigdala=criarElipsoide("Amígdala","Sistema límbico",new THREE.Vector3(.48,-.38,.34),new THREE.Vector3(.65,.55,.7),0x8f5046);
        this.amigdala2=criarElipsoide("Amígdala","Sistema límbico",new THREE.Vector3(-.48,-.38,.34),new THREE.Vector3(.65,.55,.7),0x8f5046);
        const curvaH=new THREE.CatmullRomCurve3([new THREE.Vector3(-.72,-.35,.15),new THREE.Vector3(-.55,-.42,.52),new THREE.Vector3(-.25,-.51,.68),new THREE.Vector3(-.05,-.48,.72)]);
        const hipMat=materialTecido(0xa36a56,{roughness:.62});hipMat.clippingPlanes=[this.planoCorte];
        const hip=new THREE.Mesh(new THREE.TubeGeometry(curvaH,60,.09,12,false),hipMat);hip.userData={tipo:"estrutura",nome:"Hipocampo",grupo:"Sistema límbico"};
        const hip2=hip.clone();hip2.scale.x=-1;
        this.grupoInterno.add(hip,hip2);this.objetosSelecionaveis.push(hip,hip2);
        this.grupoInterno.visible=false;

        this.criarVasos();
    }

    criarVasos() {
        this.vasos=new THREE.Group();
        const mat=new THREE.LineBasicMaterial({color:0x713b35,transparent:true,opacity:.3,depthWrite:false});
        for(let lado=-1;lado<=1;lado+=2){
            for(let i=0;i<26;i++){
                const pts=[];
                const baseY=-.65+aleatorio(i+lado*9)*1.45;
                const baseZ=-.85+aleatorio(i*3+lado*5)*1.75;
                for(let j=0;j<18;j++){
                    const t=j/17;
                    const x=lado*(1.13-.46*t+Math.sin(t*8+i)*.025);
                    const y=baseY+(t-.5)*.36+Math.sin(t*10+i*.7)*.04;
                    const z=baseZ+Math.sin(t*7+i)*.16;
                    pts.push(new THREE.Vector3(x,y,z));
                }
                const linha=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),mat.clone());
                this.vasos.add(linha);
            }
        }
        this.grupoCerebro.add(this.vasos);
    }

    criarFragmentos() {
        for(let i=0;i<320;i++){
            const base=pontoInterno(i);
            const raio=.085+aleatorio(i*7+2)*.09;
            const geo=new THREE.IcosahedronGeometry(raio,1);
            geo.scale(1.2+aleatorio(i+4)*.75,.8+aleatorio(i+5)*.45,1+aleatorio(i+6)*.5);
            const cor=i%19===0?0x9d5e4d:(i%7===0?0x8b7969:0x987b6b);
            const mat=materialTecido(cor,{roughness:.82,opacity:0});
            mat.clippingPlanes=[this.planoCorte];
            const m=new THREE.Mesh(geo,mat);
            m.position.copy(base);
            m.rotation.set(aleatorio(i+7)*Math.PI,aleatorio(i+8)*Math.PI,aleatorio(i+9)*Math.PI);
            const hemi=base.x<0?-1:1;
            const indiceGrupo=Math.floor(i/16);
            const indiceRegiao=Math.floor(i/4);
            const normal=base.clone().normalize();
            const hemiOffset=new THREE.Vector3(hemi*.35,0,0);
            const grupoAng=indiceGrupo*2.399963;
            const grupoOffset=new THREE.Vector3(Math.cos(grupoAng)*.38,Math.sin(grupoAng*.7)*.28,Math.sin(grupoAng)*.36);
            const regAng=indiceRegiao*.77;
            const regOffset=new THREE.Vector3(Math.cos(regAng)*.3,Math.sin(regAng*.83)*.25,Math.sin(regAng)*.32);
            const pecaOffset=normal.multiplyScalar(.5+aleatorio(i+55)*.95);
            m.userData={tipo:"fragmento",indice:i,nome:NOMES_BASE[i%NOMES_BASE.length],grupo:hemi<0?"Hemisfério esquerdo":"Hemisfério direito",base:base.clone(),hemiOffset,grupoOffset,regOffset,pecaOffset};
            this.fragmentos.push(m);this.grupoFragmentos.add(m);this.objetosSelecionaveis.push(m);
        }
    }

    criarAtividade() {
        const qtd=165,pos=new Float32Array(qtd*3);
        for(let i=0;i<qtd;i++){
            const p=pontoInterno(i*13+5);
            pos.set([p.x,p.y,p.z],i*3);
        }
        const geo=new THREE.BufferGeometry();geo.setAttribute("position",new THREE.BufferAttribute(pos,3));
        const mat=new THREE.PointsMaterial({color:0xd58a5e,size:.038,transparent:true,opacity:.85,blending:THREE.AdditiveBlending,depthWrite:false,clippingPlanes:[this.planoCorte]});
        this.atividade=new THREE.Points(geo,mat);this.atividade.visible=false;this.grupoCerebro.add(this.atividade);
        this.conexoes=new THREE.Group();
        for(let i=0;i<34;i++){
            const a=pontoInterno(i*7+1),b=pontoInterno(i*11+33);
            const meio=a.clone().lerp(b,.5).add(new THREE.Vector3(0,.18+aleatorio(i)*.3,0));
            const curva=new THREE.QuadraticBezierCurve3(a,meio,b);
            const linha=new THREE.Line(new THREE.BufferGeometry().setFromPoints(curva.getPoints(28)),new THREE.LineBasicMaterial({color:i%4===0?0xbd714b:0x77bda3,transparent:true,opacity:.16,depthWrite:false,clippingPlanes:[this.planoCorte]}));
            this.conexoes.add(linha);
        }
        this.conexoes.visible=false;this.grupoCerebro.add(this.conexoes);
    }

    configurarEventos() {
        this.canvas.addEventListener("pointerup",evento=>{
            if(this.nivelMicro>=2)return;
            const rect=this.canvas.getBoundingClientRect();
            this.mouse.x=((evento.clientX-rect.left)/rect.width)*2-1;
            this.mouse.y=-((evento.clientY-rect.top)/rect.height)*2+1;
            this.raio.setFromCamera(this.mouse,this.camera);
            const alvos=this.atlasRealAtivo&&this.pontosAtlas.length?this.pontosAtlas:this.objetosSelecionaveis.filter(o=>o.visible&&o.parent?.visible!==false);
            const hits=this.raio.intersectObjects(alvos,false);
            if(!hits.length)return;
            const objeto=hits[0].object;
            this.selecionar(objeto);
        });
        window.addEventListener("resize",()=>this.redimensionar(),{passive:true});
    }

    selecionar(objeto) {
        this.limparDestaque();
        this.selecionado=objeto;
        if(objeto.isPoints){
            objeto.material.size*=1.45;
            objeto.material.opacity=1;
        }else if(objeto.material?.emissive){
            objeto.material.emissive.setHex(0x5e2d1b);objeto.material.emissiveIntensity=.34;
        }
        const dados={...objeto.userData};
        if(dados.regiao) Object.assign(dados,{nome:dados.regiao.nome,grupo:dados.regiao.pai?.at(-1)||"EBRAINS",origem:"EBRAINS",regiao:dados.regiao});
        this.aoSelecionar?.(dados);
    }

    limparDestaque() {
        if(!this.selecionado)return;
        if(this.selecionado.isPoints){
            this.selecionado.material.size/=1.45;this.selecionado.material.opacity=.76;
        }else if(this.selecionado.material?.emissive){
            this.selecionado.material.emissive.setHex(0x000000);this.selecionado.material.emissiveIntensity=0;
        }
    }

    mapearRegioesReais(regioes) {
        this.regioesReais=regioes||[];
        if(!this.regioesReais.length)return;
        this.fragmentos.forEach((f,i)=>{
            const reg=this.regioesReais[i%this.regioesReais.length];
            f.userData.regiao=reg;
            f.userData.nome=reg.nome;
        });
    }

    definirModo(modo) {
        this.modo=modo;
        this.ajudanteCorte.visible=modo==="corte";
        this.atividade.visible=modo==="atividade"&&this.nivelMicro<2;
        this.conexoes.visible=modo==="atividade"&&this.nivelMicro<2;
        this.grupoInterno.visible=(modo==="anatomia"||modo==="corte")&&this.nivelMicro<2;
        this.controles.autoRotate=modo==="visao"&&this.nivelMicro===0;
        if(modo==="explodido")this.alvoExplosao=Math.max(.28,this.alvoExplosao);
        if(modo!=="explodido"&&this.alvoExplosao>.15)this.alvoExplosao=0;
        if(modo!=="imersao"&&this.nivelMicro>0)this.definirNivelMicroscopia(0);
        if(modo==="corte")this.planoCorte.constant=0;
        else this.planoCorte.constant=10;
        this.atualizarVisibilidadePrincipal();
    }

    atualizarVisibilidadePrincipal() {
        const micro=this.nivelMicro>=2;
        this.grupoCerebro.visible=!micro;
        this.grupoFragmentos.visible=!micro&&!this.atlasRealAtivo;
        this.grupoAtlas.visible=!micro&&this.atlasRealAtivo;
        this.grupoMascara.visible=!micro&&this.grupoMascara.children.length>0;
        this.microscopia.definirNivel(this.nivelMicro);
    }

    definirExplosao(valor) { this.alvoExplosao=THREE.MathUtils.clamp(Number(valor),0,1); }

    definirPlanoCorte(plano) {
        const normal=plano==="coronal"?new THREE.Vector3(0,0,1):plano==="axial"?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0);
        this.planoCorte.normal.copy(normal);this.planoCorte.constant=0;
    }

    definirCorte(valor) { this.planoCorte.constant=Number(valor)*.016; }

    alternarTransparencia() {
        this.transparente=!this.transparente;
        const op=this.transparente?.22:1;
        [this.hemisferioEsquerdo,this.hemisferioDireito,this.cerebelo,this.tronco].forEach(m=>m.material.opacity=op);
        this.vasos.visible=!this.transparente;
        this.grupoInterno.visible=this.transparente||this.modo==="anatomia"||this.modo==="corte";
        return this.transparente;
    }

    alternarRotacao(){this.controles.autoRotate=!this.controles.autoRotate;return this.controles.autoRotate;}

    isolarSelecao(){
        if(!this.selecionado)return false;
        const nome=this.selecionado.userData?.regiao?.nome||this.selecionado.userData?.nome;
        if(this.atlasRealAtivo){this.pontosAtlas.forEach(p=>p.visible=p===this.selecionado||p.userData?.regiao?.nome===nome);}
        else {this.objetosSelecionaveis.forEach(o=>o.visible=(o===this.selecionado||o.userData?.nome===nome));}
        return true;
    }

    mostrarTudo(){
        this.objetosSelecionaveis.forEach(o=>o.visible=true);this.pontosAtlas.forEach(o=>o.visible=true);
        this.atualizarVisibilidadePrincipal();
    }

    remontar(){this.alvoExplosao=0;this.mostrarTudo();}

    resetarCamera(){
        this.camera.position.set(3.8,.8,5.4);this.controles.target.set(0,.05,0);this.controles.update();
    }

    focarNome(nome){
        const texto=String(nome||"").toLocaleLowerCase("pt-BR");
        const alvo=(this.atlasRealAtivo?this.pontosAtlas:this.objetosSelecionaveis).find(o=>String(o.userData?.regiao?.nome||o.userData?.nome||"").toLocaleLowerCase("pt-BR").includes(texto));
        if(!alvo)return false;
        this.selecionar(alvo);this.mostrarTudo();
        const centro=new THREE.Box3().setFromObject(alvo).getCenter(new THREE.Vector3());
        this.controles.target.lerp(centro,.72);this.controles.update();return true;
    }

    limparAtlas() {
        while(this.grupoAtlas.children.length){const o=this.grupoAtlas.children.pop();o.geometry?.dispose?.();o.material?.dispose?.();}
        while(this.grupoMascara.children.length){const o=this.grupoMascara.children.pop();o.geometry?.dispose?.();o.material?.dispose?.();}
        this.pontosAtlas=[];
    }

    async materializarAtlas(volume,atlas,aoProgresso) {
        this.limparAtlas();
        aoProgresso?.("Amostrando voxels do atlas…");
        const amostra=await amostrarVolumePorRotulo(volume,{limitePontos:window.innerWidth<820?42000:85000});
        let indice=0;
        for(const [rotulo,posicoes] of amostra.grupos.entries()){
            if(posicoes.length<6)continue;
            const geo=new THREE.BufferGeometry();geo.setAttribute("position",new THREE.Float32BufferAttribute(posicoes,3));
            const regiao=atlas.regiaoPorNumero(rotulo);
            const mat=new THREE.PointsMaterial({color:corDeterministica(rotulo),size:.026,transparent:true,opacity:.76,depthWrite:false,clippingPlanes:[this.planoCorte]});
            const pontos=new THREE.Points(geo,mat);
            const centro=new THREE.Box3().setFromBufferAttribute(geo.attributes.position).getCenter(new THREE.Vector3());
            pontos.userData={tipo:"atlas",rotulo,regiao,nome:regiao?.nome||`Rótulo ${rotulo}`,grupo:"Mapa rotulado EBRAINS",centro,offset:centro.clone().normalize().multiplyScalar(.65+aleatorio(rotulo)*.7)};
            this.grupoAtlas.add(pontos);this.pontosAtlas.push(pontos);
            indice++;
            if(indice%20===0){aoProgresso?.(`Construindo regiões 3D… ${indice}`);await new Promise(r=>setTimeout(r,0));}
        }
        this.atlasRealAtivo=this.pontosAtlas.length>0;
        if(this.atlasRealAtivo){
            this.hemisferioEsquerdo.material.opacity=.13;this.hemisferioDireito.material.opacity=.13;this.cerebelo.material.opacity=.16;this.vasos.visible=false;
        }
        this.atualizarVisibilidadePrincipal();
        aoProgresso?.(`${this.pontosAtlas.length} rótulos 3D materializados.`);
        return {quantidade:this.pontosAtlas.length,passo:amostra.passo};
    }

    async mostrarMascara(volume,regiao,aoProgresso) {
        while(this.grupoMascara.children.length){const o=this.grupoMascara.children.pop();o.geometry?.dispose?.();o.material?.dispose?.();}
        aoProgresso?.("Convertendo máscara NIfTI para pontos 3D…");
        const amostra=await amostrarVolumePorRotulo(volume,{limitePontos:window.innerWidth<820?28000:52000});
        const todas=[];
        for(const posicoes of amostra.grupos.values())todas.push(...posicoes);
        if(!todas.length)throw new Error("A máscara não contém voxels visíveis.");
        const geo=new THREE.BufferGeometry();geo.setAttribute("position",new THREE.Float32BufferAttribute(todas,3));
        const mat=new THREE.PointsMaterial({color:0xd29a70,size:.032,transparent:true,opacity:.92,depthWrite:false,clippingPlanes:[this.planoCorte]});
        const pontos=new THREE.Points(geo,mat);pontos.userData={tipo:"mascara",regiao,nome:regiao?.nome||"Máscara EBRAINS",grupo:"Máscara NIfTI real"};
        this.grupoMascara.add(pontos);
        this.hemisferioEsquerdo.material.opacity=.1;this.hemisferioDireito.material.opacity=.1;this.cerebelo.material.opacity=.12;this.vasos.visible=false;
        this.grupoMascara.visible=true;
        this.grupoCerebro.visible=true;
        aoProgresso?.(`Máscara real carregada: ${regiao?.nome||"região"}`);
        return pontos;
    }

    desativarAtlasReal() {
        this.atlasRealAtivo=false;this.grupoAtlas.visible=false;
        this.hemisferioEsquerdo.material.opacity=this.transparente?.22:1;this.hemisferioDireito.material.opacity=this.transparente?.22:1;this.cerebelo.material.opacity=this.transparente?.22:1;this.vasos.visible=!this.transparente;
        this.atualizarVisibilidadePrincipal();
    }

    definirNivelMicroscopia(nivel) {
        this.nivelMicro=Number(nivel);
        this.microscopia.definirNivel(this.nivelMicro);
        if(this.nivelMicro===0){this.resetarCamera();}
        if(this.nivelMicro===1){
            if(this.selecionado)this.isolarSelecao();
            this.camera.position.set(2.2,.35,3.15);this.controles.target.set(0,0,0);
        }
        if(this.nivelMicro===2){this.camera.position.set(0,.15,4.15);this.controles.target.set(0,0,0);}
        if(this.nivelMicro===3){this.camera.position.set(0,.05,4.3);this.controles.target.set(0,0,0);}
        if(this.nivelMicro===4){this.camera.position.set(0,0,4.2);this.controles.target.set(0,0,0);}
        this.controles.autoRotate=false;this.controles.update();this.atualizarVisibilidadePrincipal();
    }

    async carregarNeuronioReal(nomeRegiao,aoStatus){return await this.microscopia.carregarNeuronioReal(nomeRegiao,aoStatus);}

    redimensionar(){
        const w=this.canvas.clientWidth||1,h=this.canvas.clientHeight||1;
        this.renderizador.setPixelRatio(Math.min(window.devicePixelRatio||1, w<820?1.25:1.65));
        this.renderizador.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();
    }

    atualizarExplosao(){
        this.explosao+=(this.alvoExplosao-this.explosao)*.065;
        const hemi=suave(0,.27,this.explosao),grupo=suave(.18,.55,this.explosao),reg=suave(.46,.8,this.explosao),peca=suave(.73,1,this.explosao);
        const opFragmentos=suave(.12,.28,this.explosao);
        const opSuperficie=1-suave(.18,.38,this.explosao);
        if(!this.atlasRealAtivo&&this.nivelMicro<2){
            this.hemisferioEsquerdo.material.opacity=this.transparente?Math.min(.22,opSuperficie):opSuperficie;
            this.hemisferioDireito.material.opacity=this.transparente?Math.min(.22,opSuperficie):opSuperficie;
            this.cerebelo.material.opacity=this.transparente?Math.min(.22,opSuperficie):opSuperficie;
            this.vasos.visible=opSuperficie>.4&&!this.transparente;
            for(const f of this.fragmentos){
                const u=f.userData;
                f.position.copy(u.base).addScaledVector(u.hemiOffset,hemi).addScaledVector(u.grupoOffset,grupo).addScaledVector(u.regOffset,reg).addScaledVector(u.pecaOffset,peca);
                f.material.opacity=opFragmentos;
                f.visible=opFragmentos>.025;
            }
        }
        if(this.atlasRealAtivo){
            const intensidade=suave(.1,1,this.explosao);
            this.pontosAtlas.forEach(p=>p.position.copy(p.userData.offset||new THREE.Vector3()).multiplyScalar(intensidade));
        }
    }

    animar(){
        requestAnimationFrame(()=>this.animar());
        const tempo=performance.now();
        this.atualizarExplosao();
        if(this.atividade.visible)this.atividade.material.opacity=.48+Math.sin(tempo*.004)*.32;
        if(this.conexoes.visible)this.conexoes.rotation.y=Math.sin(tempo*.0002)*.025;
        this.anel.rotation.z+=.0012;this.poeira.rotation.y+=.00005;
        this.microscopia.animar(tempo);
        this.controles.update();this.renderizador.render(this.cena,this.camera);
    }
}
