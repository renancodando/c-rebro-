import * as THREE from "three";

const COR_GIRO = new THREE.Color(0xb89180);
const COR_SULCO = new THREE.Color(0x5d4039);
const COR_INFERIOR = new THREE.Color(0x8c685d);

function saturar(valor) {
    return Math.max(0, Math.min(1, valor));
}

function suave(a, b, x) {
    const t = saturar((x - a) / Math.max(.00001, b - a));
    return t * t * (3 - 2 * t);
}

function ruidoCortical(x, y, z) {
    const a = Math.sin(y * 13.7 + Math.sin(z * 5.1) * 2.3 + x * 2.1);
    const b = Math.cos(z * 15.9 + Math.sin(y * 4.6) * 2.8 - x * 3.4);
    const c = Math.sin((y + z) * 21.4 + Math.cos(x * 8.2) * 1.6);
    const d = Math.cos((z - y) * 31.7 + x * 5.2);
    return a * .44 + b * .32 + c * .17 + d * .07;
}

function sulcoCortical(x, y, z) {
    const padraoA = Math.abs(Math.sin(y * 10.9 + z * 5.3 + Math.sin(x * 4.1)));
    const padraoB = Math.abs(Math.cos(z * 8.7 - y * 3.7 + Math.cos(x * 6.2)));
    return Math.pow(1 - Math.min(1, padraoA * .83 + padraoB * .31), 6);
}

export function materialCerebral(cor = 0xb68f7f, opcoes = {}) {
    const material = new THREE.MeshPhysicalMaterial({
        color: cor,
        roughness: opcoes.roughness ?? .72,
        metalness: 0,
        clearcoat: opcoes.clearcoat ?? .06,
        clearcoatRoughness: opcoes.clearcoatRoughness ?? .74,
        sheen: opcoes.sheen ?? .22,
        sheenColor: opcoes.sheenColor ?? new THREE.Color(0xe4b9a8),
        sheenRoughness: .82,
        ior: 1.36,
        specularIntensity: opcoes.specularIntensity ?? .34,
        transparent: true,
        opacity: opcoes.opacity ?? 1,
        side: THREE.DoubleSide,
        vertexColors: opcoes.vertexColors ?? false,
        emissive: opcoes.emissive ?? 0x000000,
        emissiveIntensity: opcoes.emissiveIntensity ?? 0
    });
    if (opcoes.clippingPlanes) material.clippingPlanes = opcoes.clippingPlanes;
    return material;
}

export function criarHemisferioRealista(sinal, planoCorte) {
    const geometria = new THREE.SphereGeometry(1, 128, 96);
    const posicao = geometria.attributes.position;
    const cores = [];

    for (let i = 0; i < posicao.count; i++) {
        let x = posicao.getX(i);
        let y = posicao.getY(i);
        let z = posicao.getZ(i);

        const frontal = suave(.15, .95, z);
        const occipital = suave(-.95, -.3, -z);
        const temporal = suave(-.85, -.05, -y) * suave(-.25, .92, z) * suave(.18, .88, Math.abs(x));
        const superior = suave(.58, .98, y);
        const medial = suave(.18, .9, -sinal * x);

        const giro = ruidoCortical(x, y, z);
        const sulco = sulcoCortical(x, y, z);
        const deformacao = giro * .026 - sulco * .072;
        const escala = 1 + deformacao;
        x *= escala;
        y *= escala;
        z *= escala;

        const largura = .66 + frontal * .055 - occipital * .035 + temporal * .055;
        x *= largura;
        y *= .95 + frontal * .045 - superior * .035;
        z *= 1.23 + frontal * .045 - occipital * .035;

        y -= temporal * .11;
        z += frontal * .055;
        z -= occipital * .035;

        if (medial > 0) x *= 1 - medial * .23;
        x += sinal * .57;
        y += .13;
        z -= .04;

        posicao.setXYZ(i, x, y, z);

        const misturaSulco = saturar((deformacao + .075) / .11);
        const inferior = suave(-.95, -.1, -y) * .35;
        const cor = COR_SULCO.clone().lerp(COR_GIRO, misturaSulco).lerp(COR_INFERIOR, inferior);
        cores.push(cor.r, cor.g, cor.b);
    }

    geometria.setAttribute("color", new THREE.Float32BufferAttribute(cores, 3));
    geometria.computeVertexNormals();

    const material = materialCerebral(0xffffff, {
        vertexColors: true,
        roughness: .76,
        clearcoat: .045,
        sheen: .28,
        clippingPlanes: [planoCorte]
    });

    const malha = new THREE.Mesh(geometria, material);
    malha.userData = {
        tipo: "superficie",
        nome: sinal < 0 ? "Hemisfério esquerdo" : "Hemisfério direito",
        grupo: "Córtex cerebral",
        hemisferio: sinal < 0 ? "esquerdo" : "direito"
    };
    return malha;
}

function curvaTubular(pontos, raio, cor, opacidade = .92, segmentos = 90) {
    const curva = new THREE.CatmullRomCurve3(pontos, false, "catmullrom", .42);
    const geometria = new THREE.TubeGeometry(curva, segmentos, raio, 8, false);
    const material = new THREE.MeshPhysicalMaterial({
        color: cor,
        roughness: .63,
        transparent: true,
        opacity: opacidade,
        clearcoat: .08,
        clearcoatRoughness: .55
    });
    return new THREE.Mesh(geometria, material);
}

export function criarSulcosMaiores() {
    const grupo = new THREE.Group();
    const cor = 0x4d302e;

    for (const sinal of [-1, 1]) {
        const x = sinal * 1.165;
        const sulcos = [
            [
                new THREE.Vector3(x, .89, .12),
                new THREE.Vector3(x * 1.01, .64, .08),
                new THREE.Vector3(x * 1.02, .31, .03),
                new THREE.Vector3(x * .99, -.03, -.05),
                new THREE.Vector3(x * .94, -.26, -.18)
            ],
            [
                new THREE.Vector3(x * .99, .05, .88),
                new THREE.Vector3(x * 1.03, -.04, .61),
                new THREE.Vector3(x * 1.02, -.16, .3),
                new THREE.Vector3(x * .98, -.24, -.03),
                new THREE.Vector3(x * .91, -.28, -.36)
            ],
            [
                new THREE.Vector3(x * .92, .74, -.45),
                new THREE.Vector3(x * .96, .58, -.65),
                new THREE.Vector3(x * .94, .34, -.8),
                new THREE.Vector3(x * .88, .12, -.9)
            ]
        ];
        sulcos.forEach((pontos, indice) => {
            const tubo = curvaTubular(pontos, indice === 1 ? .024 : .017, cor, .58, 64);
            tubo.userData = { decorativo: true };
            grupo.add(tubo);
        });
    }
    return grupo;
}

export function criarMateriaBranca(planoCorte) {
    const grupo = new THREE.Group();
    for (const sinal of [-1, 1]) {
        const geometria = new THREE.SphereGeometry(1, 80, 56);
        const posicao = geometria.attributes.position;
        for (let i = 0; i < posicao.count; i++) {
            let x = posicao.getX(i), y = posicao.getY(i), z = posicao.getZ(i);
            x *= .49;
            y *= .72;
            z *= .96;
            x += sinal * .48;
            y += .09;
            z -= .04;
            posicao.setXYZ(i, x, y, z);
        }
        geometria.computeVertexNormals();
        const material = materialCerebral(0xd1c6b2, {
            roughness: .83,
            opacity: .34,
            sheen: .08,
            clippingPlanes: [planoCorte]
        });
        const malha = new THREE.Mesh(geometria, material);
        malha.userData = { tipo: "tecido", nome: "Substância branca", grupo: sinal < 0 ? "Hemisfério esquerdo" : "Hemisfério direito" };
        grupo.add(malha);
    }
    grupo.visible = false;
    return grupo;
}

export function criarSistemaVentricular(planoCorte) {
    const grupo = new THREE.Group();
    const material = new THREE.MeshPhysicalMaterial({
        color: 0x6e8d88,
        roughness: .2,
        transmission: .42,
        thickness: .28,
        transparent: true,
        opacity: .48,
        clearcoat: .25,
        clearcoatRoughness: .3,
        clippingPlanes: [planoCorte]
    });

    for (const sinal of [-1, 1]) {
        const curva = new THREE.CatmullRomCurve3([
            new THREE.Vector3(sinal * .15, .36, .5),
            new THREE.Vector3(sinal * .24, .31, .25),
            new THREE.Vector3(sinal * .31, .12, .02),
            new THREE.Vector3(sinal * .29, -.14, -.18),
            new THREE.Vector3(sinal * .22, -.32, -.03)
        ]);
        const lateral = new THREE.Mesh(new THREE.TubeGeometry(curva, 70, .065, 12, false), material.clone());
        lateral.userData = { tipo: "estrutura", nome: sinal < 0 ? "Ventrículo lateral esquerdo" : "Ventrículo lateral direito", grupo: "Sistema ventricular" };
        grupo.add(lateral);
    }

    const terceiro = new THREE.Mesh(new THREE.CapsuleGeometry(.045, .42, 8, 16), material.clone());
    terceiro.position.set(0, -.02, -.02);
    terceiro.userData = { tipo: "estrutura", nome: "Terceiro ventrículo", grupo: "Sistema ventricular" };
    grupo.add(terceiro);

    const aqueduto = new THREE.Mesh(new THREE.CylinderGeometry(.032, .032, .44, 14), material.clone());
    aqueduto.rotation.x = Math.PI / 2;
    aqueduto.position.set(0, -.31, .17);
    aqueduto.userData = { tipo: "estrutura", nome: "Aqueduto cerebral", grupo: "Sistema ventricular" };
    grupo.add(aqueduto);

    grupo.visible = false;
    return grupo;
}

export function criarCorpoCaloso(planoCorte) {
    const curva = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-.48, .17, .36),
        new THREE.Vector3(-.24, .36, .2),
        new THREE.Vector3(0, .42, .02),
        new THREE.Vector3(.24, .36, .2),
        new THREE.Vector3(.48, .17, .36)
    ]);
    const material = materialCerebral(0xd8cdb9, { roughness: .78, opacity: .82, clippingPlanes: [planoCorte] });
    const malha = new THREE.Mesh(new THREE.TubeGeometry(curva, 80, .095, 16, false), material);
    malha.scale.y = .72;
    malha.userData = { tipo: "estrutura", nome: "Corpo caloso", grupo: "Comissuras cerebrais" };
    return malha;
}

export function criarNucleosBasais(planoCorte) {
    const grupo = new THREE.Group();
    const criar = (nome, grupoNome, pos, escala, cor) => {
        const malha = new THREE.Mesh(
            new THREE.SphereGeometry(.22, 34, 24),
            materialCerebral(cor, { roughness: .66, opacity: .9, clippingPlanes: [planoCorte] })
        );
        malha.position.copy(pos);
        malha.scale.copy(escala);
        malha.userData = { tipo: "estrutura", nome, grupo: grupoNome };
        grupo.add(malha);
        return malha;
    };

    for (const sinal of [-1, 1]) {
        criar("Núcleo caudado", "Núcleos da base", new THREE.Vector3(sinal * .37, .18, .1), new THREE.Vector3(.55, 1.35, .62), 0x9a6a58);
        criar("Putâmen", "Núcleos da base", new THREE.Vector3(sinal * .5, -.02, -.05), new THREE.Vector3(.75, 1.05, .7), 0x8d5d51);
        criar("Globo pálido", "Núcleos da base", new THREE.Vector3(sinal * .39, -.03, -.03), new THREE.Vector3(.43, .77, .5), 0xc0a487);
    }
    return grupo;
}

export function criarVasculaturaRealista() {
    const grupo = new THREE.Group();
    const corArteria = 0x713d36;
    const corVena = 0x4f5c5d;

    const troncos = [
        [new THREE.Vector3(0, -1.22, .18), new THREE.Vector3(.02, -.93, .2), new THREE.Vector3(.03, -.65, .18), new THREE.Vector3(.02, -.4, .1)],
        [new THREE.Vector3(.02, -.42, .1), new THREE.Vector3(.44, -.28, .35), new THREE.Vector3(.76, -.18, .58), new THREE.Vector3(1.02, -.02, .78)],
        [new THREE.Vector3(.02, -.42, .1), new THREE.Vector3(-.44, -.28, .35), new THREE.Vector3(-.76, -.18, .58), new THREE.Vector3(-1.02, -.02, .78)]
    ];

    troncos.forEach((pontos, i) => grupo.add(curvaTubular(pontos, i === 0 ? .026 : .017, corArteria, .8, 70)));

    for (const sinal of [-1, 1]) {
        for (let i = 0; i < 18; i++) {
            const t = i / 17;
            const zBase = -.78 + t * 1.56;
            const yBase = -.58 + Math.sin(t * Math.PI) * 1.18;
            const xBase = sinal * (1.11 - Math.abs(yBase) * .06);
            const pontos = [
                new THREE.Vector3(sinal * .72, -.14 + Math.sin(i) * .12, zBase * .62),
                new THREE.Vector3(sinal * .91, yBase * .45, zBase * .8),
                new THREE.Vector3(xBase, yBase, zBase)
            ];
            grupo.add(curvaTubular(pontos, .006 + (i % 5 === 0 ? .004 : 0), i % 4 === 0 ? corVena : corArteria, .36, 32));
        }
    }

    grupo.userData = { tipo: "vasculatura" };
    return grupo;
}

export function criarRealismoComplementar(planoCorte) {
    const grupo = new THREE.Group();
    const sulcos = criarSulcosMaiores();
    const materiaBranca = criarMateriaBranca(planoCorte);
    const ventriculos = criarSistemaVentricular(planoCorte);
    const corpoCaloso = criarCorpoCaloso(planoCorte);
    const nucleosBasais = criarNucleosBasais(planoCorte);
    const vasos = criarVasculaturaRealista();

    grupo.add(sulcos, materiaBranca, ventriculos, corpoCaloso, nucleosBasais, vasos);
    corpoCaloso.visible = false;
    nucleosBasais.visible = false;

    return { grupo, sulcos, materiaBranca, ventriculos, corpoCaloso, nucleosBasais, vasos };
}
