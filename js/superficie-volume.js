import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

function indice(nx, ny, x, y, z) {
    return x + y * nx + z * nx * ny;
}

function ocupado(volume, x, y, z, limiar, passo) {
    const [nx, ny, nz] = volume.dimensoes;
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return false;
    const valor = volume.valor(indice(nx, ny, x, y, z));
    return Number.isFinite(valor) && Math.abs(valor) > limiar;
}

const FACES = [
    { n: [-1,0,0], v: [[0,0,0],[0,0,1],[0,1,1],[0,0,0],[0,1,1],[0,1,0]] },
    { n: [1,0,0], v: [[1,0,0],[1,1,0],[1,1,1],[1,0,0],[1,1,1],[1,0,1]] },
    { n: [0,-1,0], v: [[0,0,0],[1,0,0],[1,0,1],[0,0,0],[1,0,1],[0,0,1]] },
    { n: [0,1,0], v: [[0,1,0],[0,1,1],[1,1,1],[0,1,0],[1,1,1],[1,1,0]] },
    { n: [0,0,-1], v: [[0,0,0],[0,1,0],[1,1,0],[0,0,0],[1,1,0],[1,0,0]] },
    { n: [0,0,1], v: [[0,0,1],[1,0,1],[1,1,1],[0,0,1],[1,1,1],[0,1,1]] }
];

export async function construirSuperficieVolume(volume, opcoes = {}) {
    const [nx, ny, nz] = volume.dimensoes;
    const sx = volume.pixdim[0] || 1;
    const sy = volume.pixdim[1] || 1;
    const sz = volume.pixdim[2] || 1;
    const limiteFaces = opcoes.limiteFaces || (innerWidth < 820 ? 18000 : 42000);
    const limiar = opcoes.limiar ?? 0;
    const total = nx * ny * nz;
    let passo = Math.max(1, Math.ceil(Math.cbrt(total / Math.max(22000, limiteFaces * .8))));
    const escala = 2.9 / Math.max(nx * sx, ny * sy, nz * sz);
    const posicoes = [];
    let faces = 0;
    let lotes = 0;

    const converter = (vx, vy, vz) => [
        (vx - nx / 2) * sx * escala,
        (vz - nz / 2) * sz * escala,
        -(vy - ny / 2) * sy * escala
    ];

    for (let z = 0; z < nz; z += passo) {
        for (let y = 0; y < ny; y += passo) {
            for (let x = 0; x < nx; x += passo) {
                if (!ocupado(volume, x, y, z, limiar, passo)) continue;
                for (const face of FACES) {
                    const nxv = x + face.n[0] * passo;
                    const nyv = y + face.n[1] * passo;
                    const nzv = z + face.n[2] * passo;
                    if (ocupado(volume, nxv, nyv, nzv, limiar, passo)) continue;
                    for (const vertice of face.v) {
                        const p = converter(x + vertice[0] * passo, y + vertice[1] * passo, z + vertice[2] * passo);
                        posicoes.push(p[0], p[1], p[2]);
                    }
                    faces++;
                    if (faces >= limiteFaces) break;
                }
                if (faces >= limiteFaces) break;
            }
            if (faces >= limiteFaces) break;
        }
        if (faces >= limiteFaces) break;
        lotes++;
        if (lotes % 5 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }

    if (!posicoes.length) throw new Error("A máscara não possui superfície detectável.");

    let geometria = new THREE.BufferGeometry();
    geometria.setAttribute("position", new THREE.Float32BufferAttribute(posicoes, 3));
    geometria = mergeVertices(geometria, .0001);
    geometria.computeVertexNormals();
    geometria.computeBoundingBox();
    geometria.computeBoundingSphere();
    return { geometria, faces, passo };
}
