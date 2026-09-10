export const EXPERIENCIAS = {
    memoria: {
        nome: "Formação de uma memória",
        subtitulo: "rota educacional",
        passos: [
            { nome: "Córtex visual", texto: "A informação sensorial é processada antes de ganhar contexto." },
            { nome: "Hipocampo", texto: "O hipocampo participa da formação e organização de novas memórias declarativas." },
            { nome: "Córtex pré-frontal", texto: "A memória de trabalho ajuda a manter e manipular informação relevante." },
            { nome: "Córtex temporal", texto: "Redes temporais participam da consolidação e recuperação de informação semântica." }
        ]
    },
    medo: {
        nome: "Circuito do medo",
        subtitulo: "rota educacional",
        passos: [
            { nome: "Tálamo", texto: "Sinais sensoriais alcançam circuitos de retransmissão e integração." },
            { nome: "Amígdala", texto: "A amígdala participa da avaliação de saliência e aprendizagem associativa emocional." },
            { nome: "Hipotálamo", texto: "Circuitos hipotalâmicos participam de respostas autonômicas." },
            { nome: "Córtex pré-frontal", texto: "Regiões pré-frontais participam da regulação e reavaliação do contexto." }
        ]
    },
    linguagem: {
        nome: "Rede da linguagem",
        subtitulo: "rota educacional",
        passos: [
            { nome: "Córtex temporal", texto: "Áreas temporais participam do processamento auditivo e lexical." },
            { nome: "Córtex parietal", texto: "Regiões parietais integram componentes fonológicos e multimodais." },
            { nome: "Córtex pré-frontal", texto: "Regiões frontais inferiores participam de seleção e produção linguística." },
            { nome: "Córtex motor", texto: "A produção da fala envolve planejamento e execução motora." }
        ]
    },
    visao: {
        nome: "Da retina à percepção",
        subtitulo: "rota educacional",
        passos: [
            { nome: "Tálamo", texto: "Informação visual passa por núcleos talâmicos antes de alcançar o córtex." },
            { nome: "Córtex visual", texto: "O córtex occipital analisa propriedades como orientação, contraste e movimento." },
            { nome: "Córtex temporal", texto: "A via ventral contribui para reconhecimento de objetos e formas." },
            { nome: "Córtex parietal", texto: "A via dorsal contribui para relações espaciais e ação guiada pela visão." }
        ]
    },
    movimento: {
        nome: "Do plano ao movimento",
        subtitulo: "rota educacional",
        passos: [
            { nome: "Córtex pré-frontal", texto: "Metas e contexto ajudam a definir a ação apropriada." },
            { nome: "Estriado", texto: "Circuitos dos núcleos da base participam da seleção e modulação de ações." },
            { nome: "Córtex motor", texto: "Comandos motores voluntários são organizados em redes corticais." },
            { nome: "Cerebelo", texto: "O cerebelo contribui para precisão temporal, coordenação e aprendizagem motora." }
        ]
    }
};

export class ControladorExperiencia {
    constructor(aoPasso, aoFim) {
        this.aoPasso = aoPasso;
        this.aoFim = aoFim;
        this.temporizador = null;
        this.indice = 0;
        this.experiencia = null;
    }

    iniciar(chave) {
        this.parar(false);
        this.experiencia = EXPERIENCIAS[chave];
        if (!this.experiencia) return false;
        this.indice = 0;
        this.executarPasso();
        this.temporizador = setInterval(() => {
            this.indice++;
            if (this.indice >= this.experiencia.passos.length) {
                this.parar(true);
                return;
            }
            this.executarPasso();
        }, 2800);
        return true;
    }

    executarPasso() {
        const passo = this.experiencia?.passos?.[this.indice];
        if (!passo) return;
        this.aoPasso?.({ experiencia: this.experiencia, passo, indice: this.indice, total: this.experiencia.passos.length });
    }

    parar(notificar = false) {
        if (this.temporizador) clearInterval(this.temporizador);
        this.temporizador = null;
        if (notificar && this.experiencia) this.aoFim?.(this.experiencia);
        this.experiencia = null;
        this.indice = 0;
    }
}
