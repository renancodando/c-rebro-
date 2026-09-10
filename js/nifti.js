function lerInteiro16(view, offset, little) {
    return view.getInt16(offset, little);
}

function lerInteiro32(view, offset, little) {
    return view.getInt32(offset, little);
}

function lerFloat32(view, offset, little) {
    return view.getFloat32(offset, little);
}

async function descompactarSeNecessario(buffer) {
    const bytes = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
    const gzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    if (!gzip) return buffer;
    if (typeof DecompressionStream === "undefined") {
        throw new Error("Este navegador não oferece descompactação GZIP nativa.");
    }
    const fluxo = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(fluxo).arrayBuffer();
}

function criarLeitorDados(buffer, offset, datatype, little) {
    const view = new DataView(buffer);
    const mapa = {
        2: { bytes: 1, ler: (i) => view.getUint8(offset + i) },
        4: { bytes: 2, ler: (i) => view.getInt16(offset + i * 2, little) },
        8: { bytes: 4, ler: (i) => view.getInt32(offset + i * 4, little) },
        16: { bytes: 4, ler: (i) => view.getFloat32(offset + i * 4, little) },
        64: { bytes: 8, ler: (i) => view.getFloat64(offset + i * 8, little) },
        256: { bytes: 1, ler: (i) => view.getInt8(offset + i) },
        512: { bytes: 2, ler: (i) => view.getUint16(offset + i * 2, little) },
        768: { bytes: 4, ler: (i) => view.getUint32(offset + i * 4, little) }
    };
    const definicao = mapa[datatype];
    if (!definicao) throw new Error(`Datatype NIfTI não suportado: ${datatype}`);
    return definicao;
}

export async function lerNifti(bufferComprimido) {
    const buffer = await descompactarSeNecessario(bufferComprimido);
    if (buffer.byteLength < 352) throw new Error("Arquivo NIfTI inválido ou incompleto.");
    const view = new DataView(buffer);
    let little = true;
    if (view.getInt32(0, true) !== 348) {
        if (view.getInt32(0, false) === 348) little = false;
        else throw new Error("Cabeçalho NIfTI-1 não reconhecido.");
    }

    const quantidadeDimensoes = lerInteiro16(view, 40, little);
    const dimensoes = [];
    for (let i = 0; i < 8; i++) dimensoes.push(Math.max(1, lerInteiro16(view, 40 + i * 2, little)));
    const datatype = lerInteiro16(view, 70, little);
    const bits = lerInteiro16(view, 72, little);
    const pixdim = [];
    for (let i = 0; i < 8; i++) pixdim.push(Math.abs(lerFloat32(view, 76 + i * 4, little)) || 1);
    const voxOffset = Math.max(0, Math.floor(lerFloat32(view, 108, little)));
    const slopeBruto = lerFloat32(view, 112, little);
    const intercept = lerFloat32(view, 116, little);
    const slope = slopeBruto === 0 || !Number.isFinite(slopeBruto) ? 1 : slopeBruto;
    const leitor = criarLeitorDados(buffer, voxOffset, datatype, little);

    const nx = dimensoes[1];
    const ny = dimensoes[2];
    const nz = dimensoes[3];
    const nt = quantidadeDimensoes >= 4 ? dimensoes[4] : 1;
    const quantidade = nx * ny * nz * nt;
    const bytesEsperados = voxOffset + quantidade * leitor.bytes;
    if (bytesEsperados > buffer.byteLength + 16) throw new Error("Volume NIfTI truncado.");

    const sformCode = lerInteiro16(view, 254, little);
    const srowX = [0,1,2,3].map(i => lerFloat32(view, 280 + i * 4, little));
    const srowY = [0,1,2,3].map(i => lerFloat32(view, 296 + i * 4, little));
    const srowZ = [0,1,2,3].map(i => lerFloat32(view, 312 + i * 4, little));

    return {
        buffer,
        dimensoes: [nx, ny, nz, nt],
        pixdim: [pixdim[1], pixdim[2], pixdim[3]],
        datatype,
        bits,
        slope,
        intercept,
        sformCode,
        srowX,
        srowY,
        srowZ,
        valor(indice) {
            return leitor.ler(indice) * slope + intercept;
        }
    };
}

function corParaValor(valor, maximo) {
    const normalizado = maximo > 0 ? Math.min(1, Math.abs(valor) / maximo) : 0;
    const base = 18 + Math.round(normalizado * 170);
    const cobre = 48 + Math.round(normalizado * 115);
    return [cobre, base + 42, base + 25, Math.max(25, Math.round(normalizado * 235))];
}

function indiceVolume(volume, x, y, z) {
    const [nx, ny] = volume.dimensoes;
    return x + y * nx + z * nx * ny;
}

export function desenharCorteNifti(volume, canvas, plano, percentual = 50, opcoes = {}) {
    const [nx, ny, nz] = volume.dimensoes;
    const p = Math.max(0, Math.min(1, percentual / 100));
    let largura;
    let altura;
    let obter;

    if (plano === "sagital") {
        const x = Math.min(nx - 1, Math.floor(p * nx));
        largura = ny;
        altura = nz;
        obter = (u, v) => volume.valor(indiceVolume(volume, x, u, nz - 1 - v));
    } else if (plano === "coronal") {
        const y = Math.min(ny - 1, Math.floor(p * ny));
        largura = nx;
        altura = nz;
        obter = (u, v) => volume.valor(indiceVolume(volume, u, y, nz - 1 - v));
    } else {
        const z = Math.min(nz - 1, Math.floor(p * nz));
        largura = nx;
        altura = ny;
        obter = (u, v) => volume.valor(indiceVolume(volume, u, ny - 1 - v, z));
    }

    const temporario = document.createElement("canvas");
    temporario.width = largura;
    temporario.height = altura;
    const ctxTemp = temporario.getContext("2d", { alpha: false });
    const imagem = ctxTemp.createImageData(largura, altura);
    let maximo = opcoes.maximo || 0;

    if (!maximo) {
        const passo = Math.max(1, Math.floor(Math.max(largura, altura) / 110));
        for (let v = 0; v < altura; v += passo) {
            for (let u = 0; u < largura; u += passo) maximo = Math.max(maximo, Math.abs(obter(u, v)));
        }
        if (!maximo) maximo = 1;
    }

    for (let v = 0; v < altura; v++) {
        for (let u = 0; u < largura; u++) {
            const valor = obter(u, v);
            const indice = (v * largura + u) * 4;
            if (!valor || !Number.isFinite(valor)) {
                imagem.data[indice] = 5;
                imagem.data[indice + 1] = 8;
                imagem.data[indice + 2] = 6;
                imagem.data[indice + 3] = 255;
                continue;
            }
            const [r,g,b,a] = corParaValor(valor, maximo);
            imagem.data[indice] = Math.min(255, r + 55);
            imagem.data[indice + 1] = Math.min(255, g + 50);
            imagem.data[indice + 2] = Math.min(255, b + 38);
            imagem.data[indice + 3] = Math.max(90, a);
        }
    }
    ctxTemp.putImageData(imagem, 0, 0);

    const retangulo = canvas.getBoundingClientRect();
    const proporcao = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(retangulo.width * proporcao));
    canvas.height = Math.max(1, Math.round(retangulo.height * proporcao));
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.imageSmoothingEnabled = false;
    const escala = Math.min(canvas.width / largura, canvas.height / altura);
    const dw = largura * escala;
    const dh = altura * escala;
    const dx = (canvas.width - dw) / 2;
    const dy = (canvas.height - dh) / 2;
    ctx.drawImage(temporario, dx, dy, dw, dh);
    ctx.strokeStyle = "rgba(189,113,75,.55)";
    ctx.lineWidth = Math.max(1, proporcao);
    ctx.strokeRect(dx + .5, dy + .5, Math.max(0,dw - 1), Math.max(0,dh - 1));
    return { maximo };
}

export async function amostrarVolumePorRotulo(volume, opcoes = {}) {
    const [nx, ny, nz] = volume.dimensoes;
    const limite = opcoes.limitePontos || 72000;
    const total = nx * ny * nz;
    const passo = Math.max(1, Math.ceil(Math.cbrt(total / limite)));
    const grupos = new Map();
    let processados = 0;

    const sx = volume.pixdim[0] || 1;
    const sy = volume.pixdim[1] || 1;
    const sz = volume.pixdim[2] || 1;
    const escala = 2.8 / Math.max(nx * sx, ny * sy, nz * sz);

    for (let z = 0; z < nz; z += passo) {
        for (let y = 0; y < ny; y += passo) {
            for (let x = 0; x < nx; x += passo) {
                const valor = Math.round(volume.valor(indiceVolume(volume, x, y, z)));
                if (!valor) continue;
                if (!grupos.has(valor)) grupos.set(valor, []);
                const px = (x - nx / 2) * sx * escala;
                const py = (z - nz / 2) * sz * escala;
                const pz = -(y - ny / 2) * sy * escala;
                grupos.get(valor).push(px, py, pz);
            }
        }
        processados++;
        if (processados % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }

    return { grupos, passo, dimensoes: [nx,ny,nz] };
}
