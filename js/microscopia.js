import * as THREE from "three";
import { obterNeuronioComSwc } from "./integracoes.js";

function material(cor, opcoes = {}) {
    return new THREE.MeshPhysicalMaterial({
        color: cor,
        roughness: opcoes.roughness ?? .5,
        metalness: 0,
        transparent: opcoes.transparent ?? false,
        opacity: opcoes.opacity ?? 1,
        transmission: opcoes.transmission ?? 0,
        clearcoat: opcoes.clearcoat ?? .12,
        emissive: opcoes.emissive ?? 0x000000,
        emissiveIntensity: opcoes.emissiveIntensity ?? 0
    });
}

function linhaMaterial(cor, opacidade = .55) {
    return new THREE.LineBasicMaterial({ color: cor, transparent: true, opacity: opacidade, depthWrite: false });
}

export class MicroscopiaCerebral {
    constructor(cena) {
        this.cena = cena;
        this.grupo = new THREE.Group();
        this.grupo.visible = false;
        this.cena.add(this.grupo);
        this.nivel = 0;
        this.grupoTecido = new THREE.Group();
        this.grupoNeuronio = new THREE.Group();
        this.grupoSinapse = new THREE.Group();
        this.grupo.add(this.grupoTecido, this.grupoNeuronio, this.grupoSinapse);
        this.criarTecido();
        this.criarNeuronioFallback();
        this.criarSinapse();
        this.metadadosNeuronio = null;
    }

    limparGrupo(grupo) {
        while (grupo.children.length) {
            const item = grupo.children.pop();
            item.traverse?.(objeto => {
                objeto.geometry?.dispose?.();
                if (Array.isArray(objeto.material)) objeto.material.forEach(m => m.dispose?.());
                else objeto.material?.dispose?.();
            });
        }
    }

    criarTecido() {
        const matSoma = material(0x9d7764, { roughness: .62 });
        const matNucleo = material(0x6e806f, { roughness: .42, transparent: true, opacity: .72 });
        const matVaso = material(0x6d3631, { roughness: .55 });
        for (let i = 0; i < 58; i++) {
            const angulo = i * 2.399963;
            const raio = .35 + (i % 9) * .14;
            const x = Math.cos(angulo) * raio + Math.sin(i * 1.37) * .18;
            const y = Math.sin(angulo) * raio * .72 + Math.cos(i * .91) * .18;
            const z = (Math.sin(i * 2.13) * .7);
            const soma = new THREE.Mesh(new THREE.IcosahedronGeometry(.045 + (i % 5) * .009, 2), matSoma.clone());
            soma.position.set(x,y,z);
            soma.scale.set(1.2,.92,1.05);
            this.grupoTecido.add(soma);
            if (i % 4 === 0) {
                const nucleo = new THREE.Mesh(new THREE.SphereGeometry(.018, 10, 8), matNucleo.clone());
                nucleo.position.copy(soma.position).add(new THREE.Vector3(.01,.004,.015));
                this.grupoTecido.add(nucleo);
            }
        }
        for (let i = 0; i < 35; i++) {
            const pontos = [];
            const base = new THREE.Vector3((Math.random()-.5)*2.1,(Math.random()-.5)*1.5,(Math.random()-.5)*1.3);
            for (let j = 0; j < 12; j++) {
                pontos.push(new THREE.Vector3(
                    base.x + Math.sin(j*.55+i) * .17 + j*.015,
                    base.y + Math.cos(j*.45+i*.8) * .13,
                    base.z + Math.sin(j*.35+i*.2) * .15
                ));
            }
            const geometria = new THREE.BufferGeometry().setFromPoints(pontos);
            const linha = new THREE.Line(geometria, linhaMaterial(i % 5 === 0 ? 0x7c4038 : 0x65786a, i % 5 === 0 ? .48 : .22));
            this.grupoTecido.add(linha);
        }
        const curva = new THREE.CatmullRomCurve3([
            new THREE.Vector3(-1.2,-.7,-.5), new THREE.Vector3(-.55,-.2,.3), new THREE.Vector3(.1,.05,-.15), new THREE.Vector3(.7,.25,.15), new THREE.Vector3(1.2,.65,-.25)
        ]);
        const vaso = new THREE.Mesh(new THREE.TubeGeometry(curva, 70, .025, 10, false), matVaso);
        this.grupoTecido.add(vaso);
        this.grupoTecido.rotation.x = -.15;
        this.grupoTecido.scale.set(1.35,1.35,1.35);
    }

    criarNeuronioFallback() {
        const soma = new THREE.Mesh(new THREE.IcosahedronGeometry(.23, 4), material(0xb27c61, { roughness: .56, emissive: 0x2d110b, emissiveIntensity: .16 }));
        soma.scale.set(1,.85,.92);
        this.grupoNeuronio.add(soma);
        const nucleo = new THREE.Mesh(new THREE.SphereGeometry(.08, 22, 16), material(0x7e8f7c, { transparent: true, opacity: .78, transmission: .08 }));
        nucleo.position.set(.035,.02,.05);
        this.grupoNeuronio.add(nucleo);
        const gerarRamo = (origem, direcao, tamanho, profundidade, semente) => {
            if (profundidade <= 0) return;
            const destino = origem.clone().add(direcao.clone().normalize().multiplyScalar(tamanho));
            destino.x += Math.sin(semente*1.7)*.08;
            destino.y += Math.cos(semente*1.3)*.07;
            destino.z += Math.sin(semente*.9)*.06;
            const geometria = new THREE.BufferGeometry().setFromPoints([origem,destino]);
            const ramo = new THREE.Line(geometria, linhaMaterial(profundidade > 2 ? 0xc08b6c : 0x8aa18c, .72));
            this.grupoNeuronio.add(ramo);
            const quantidade = profundidade > 2 ? 3 : 2;
            for (let i=0;i<quantidade;i++) {
                const proxima = direcao.clone().applyAxisAngle(new THREE.Vector3(Math.sin(semente),Math.cos(semente),.6).normalize(), (i-(quantidade-1)/2)*.48 + Math.sin(semente+i)*.12);
                gerarRamo(destino, proxima, tamanho*.69, profundidade-1, semente*1.31+i+1);
            }
        };
        for (let i=0;i<8;i++) {
            const ang = (i/8)*Math.PI*2;
            gerarRamo(new THREE.Vector3(0,0,0), new THREE.Vector3(Math.cos(ang), Math.sin(ang)*.82, Math.sin(ang*.7)*.35), .58, 4, i+2);
        }
        const axon = new THREE.CatmullRomCurve3(Array.from({length:25},(_,i)=>new THREE.Vector3(i*.09-.1, -.12 + Math.sin(i*.42)*.055, .04+Math.cos(i*.28)*.045)));
        this.grupoNeuronio.add(new THREE.Mesh(new THREE.TubeGeometry(axon, 100, .016, 7, false), material(0x8eaa93, { roughness: .62 })));
        this.grupoNeuronio.rotation.z = -.12;
        this.grupoNeuronio.scale.set(.9,.9,.9);
    }

    criarSinapse() {
        const matTerminal = material(0x9e725d, { roughness: .58, transparent: true, opacity: .96 });
        const matDendrito = material(0x738a76, { roughness: .6 });
        const terminal = new THREE.Mesh(new THREE.SphereGeometry(.42, 48, 32), matTerminal);
        terminal.scale.set(1.1,.86,.76);
        terminal.position.x = -.62;
        this.grupoSinapse.add(terminal);
        const axon = new THREE.Mesh(new THREE.CylinderGeometry(.11,.18,1.25,20), matTerminal.clone());
        axon.rotation.z = Math.PI/2;
        axon.position.x = -1.15;
        this.grupoSinapse.add(axon);
        const espinha = new THREE.Mesh(new THREE.SphereGeometry(.34, 42, 28), matDendrito);
        espinha.scale.set(.75,1.05,.72);
        espinha.position.set(.62,0,0);
        this.grupoSinapse.add(espinha);
        const pescoco = new THREE.Mesh(new THREE.CylinderGeometry(.09,.14,.85,18), matDendrito.clone());
        pescoco.rotation.z = -Math.PI/2;
        pescoco.position.x = 1.05;
        this.grupoSinapse.add(pescoco);
        const matVesicula = material(0xd3a174, { roughness: .35, emissive: 0x6b2f19, emissiveIntensity: .17 });
        this.vesiculas = [];
        for (let i=0;i<34;i++) {
            const esfera = new THREE.Mesh(new THREE.SphereGeometry(.035,12,8), matVesicula.clone());
            const a=i*2.399963;
            const r=.08+(i%7)*.036;
            esfera.position.set(-.62 + Math.cos(a)*r, Math.sin(a)*r*.82, Math.sin(i*.87)*.15);
            this.grupoSinapse.add(esfera);
            this.vesiculas.push(esfera);
        }
        const geometriaParticulas = new THREE.BufferGeometry();
        const pos = new Float32Array(90*3);
        for (let i=0;i<90;i++) {
            pos[i*3] = -.22 + Math.random()*.45;
            pos[i*3+1] = (Math.random()-.5)*.48;
            pos[i*3+2] = (Math.random()-.5)*.45;
        }
        geometriaParticulas.setAttribute("position", new THREE.BufferAttribute(pos,3));
        this.neurotransmissores = new THREE.Points(geometriaParticulas, new THREE.PointsMaterial({ color: 0xd98d5f, size: .035, transparent: true, opacity: .8, blending: THREE.AdditiveBlending, depthWrite: false }));
        this.grupoSinapse.add(this.neurotransmissores);
        this.grupoSinapse.scale.set(1.25,1.25,1.25);
    }

    construirSwc(swc) {
        if (!swc?.linhas?.length) return false;
        this.limparGrupo(this.grupoNeuronio);
        const linhasPos = [];
        const cores = [];
        const tipoCor = { 1: new THREE.Color(0xc7785a), 2: new THREE.Color(0x9aa39b), 3: new THREE.Color(0x7fa388), 4: new THREE.Color(0xc19a77), 6: new THREE.Color(0x8eaa93), 7: new THREE.Color(0x718b80) };
        const pontos = swc.pontos;
        const xs=[],ys=[],zs=[];
        swc.linhas.forEach(p=>{xs.push(p.x);ys.push(p.y);zs.push(p.z)});
        const min = new THREE.Vector3(Math.min(...xs),Math.min(...ys),Math.min(...zs));
        const max = new THREE.Vector3(Math.max(...xs),Math.max(...ys),Math.max(...zs));
        const centro = min.clone().add(max).multiplyScalar(.5);
        const tamanho = Math.max(max.x-min.x,max.y-min.y,max.z-min.z) || 1;
        const escala = 3.25/tamanho;
        swc.linhas.forEach(p => {
            if (p.pai < 0 || !pontos.has(p.pai)) return;
            const pai = pontos.get(p.pai);
            [pai,p].forEach(q => {
                linhasPos.push((q.x-centro.x)*escala,(q.y-centro.y)*escala,(q.z-centro.z)*escala);
                const cor = tipoCor[p.tipo] || tipoCor[6];
                cores.push(cor.r,cor.g,cor.b);
            });
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(linhasPos,3));
        geo.setAttribute("color", new THREE.Float32BufferAttribute(cores,3));
        const materialLinhas = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .86 });
        this.grupoNeuronio.add(new THREE.LineSegments(geo, materialLinhas));
        const somas = swc.linhas.filter(p=>p.tipo===1).slice(0,14);
        const matSoma = material(0xb87356,{roughness:.5,emissive:0x34120a,emissiveIntensity:.15});
        somas.forEach(p=>{
            const esfera = new THREE.Mesh(new THREE.SphereGeometry(Math.max(.018,p.raio*escala),16,10),matSoma.clone());
            esfera.position.set((p.x-centro.x)*escala,(p.y-centro.y)*escala,(p.z-centro.z)*escala);
            this.grupoNeuronio.add(esfera);
        });
        return true;
    }

    async carregarNeuronioReal(nomeRegiao, aoStatus) {
        aoStatus?.("Consultando NeuroMorpho.Org…");
        const resultado = await obterNeuronioComSwc(nomeRegiao);
        this.metadadosNeuronio = resultado.neuronio;
        if (resultado.swc && this.construirSwc(resultado.swc)) {
            aoStatus?.(`Reconstrução real carregada: ${resultado.neuronio?.neuron_name || "neurônio"}`);
            return { ...resultado, real: true };
        }
        aoStatus?.(resultado.neuronio ? `Metadados reais encontrados; SWC indisponível. Usando morfologia visual de fallback.` : "NeuroMorpho não respondeu. Usando morfologia visual de fallback.");
        return { ...resultado, real: false };
    }

    definirNivel(nivel) {
        this.nivel = Number(nivel);
        this.grupo.visible = this.nivel >= 2;
        this.grupoTecido.visible = this.nivel === 2;
        this.grupoNeuronio.visible = this.nivel === 3;
        this.grupoSinapse.visible = this.nivel === 4;
    }

    animar(tempo) {
        if (!this.grupo.visible) return;
        if (this.grupoTecido.visible) {
            this.grupoTecido.rotation.y = Math.sin(tempo*.00015)*.08;
        }
        if (this.grupoNeuronio.visible) {
            this.grupoNeuronio.rotation.y += .00035;
        }
        if (this.grupoSinapse.visible) {
            const pos = this.neurotransmissores.geometry.attributes.position;
            for (let i=0;i<pos.count;i++) {
                let x=pos.getX(i)+.0025;
                if (x>.28) x=-.25;
                pos.setX(i,x);
            }
            pos.needsUpdate=true;
            this.vesiculas.forEach((v,i)=>v.scale.setScalar(1+Math.sin(tempo*.003+i)*.06));
        }
    }
}
