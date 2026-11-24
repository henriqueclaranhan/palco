import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const DEMO_SLIDES = [
  {
    number: 1,
    tag: 'Revisão Q4',
    title: 'Resultados de produto e próximos marcos',
    body: 'Apresente em tela cheia enquanto seu parceiro avança os slides do celular ou notebook.',
    metrics: [
      { value: '0\u00A0MB', label: 'Armazenado no servidor' },
      { value: 'P2P', label: 'Conexão direta criptografada' },
      { value: 'Tela cheia', label: 'Para os dois lados' },
    ],
    actor: 'Anfitrião abriu o documento',
  },
  {
    number: 2,
    tag: 'Controle compartilhado',
    title: 'Cada apresentador no seu próprio ritmo',
    body: 'Qualquer participante conectado avança ou volta páginas em tempo real, com latência mínima.',
    metrics: [
      { value: '1 link', label: 'Sem cadastro ou login' },
      { value: 'QR Code', label: 'Acesso rápido no mobile' },
      { value: 'Efêmero', label: 'Expira ao fechar a aba' },
    ],
    actor: 'Coapresentador avançou para o slide 2',
  },
  {
    number: 3,
    tag: 'Segurança do anfitrião',
    title: 'Só quem cria a sala troca o PDF',
    body: 'Substitua o arquivo durante a apresentação e todos recebem a nova versão automaticamente.',
    metrics: [
      { value: '100%', label: 'Processado no navegador' },
      { value: 'WebRTC', label: 'Transferência em blocos' },
      { value: '0 login', label: 'Pronto em segundos' },
    ],
    actor: 'Anfitrião sincronizou o slide 3',
  },
];

export function StagePreview() {
  const [index, setIndex] = useState(0);
  const slide = DEMO_SLIDES[index];

  const prev = () => setIndex((i) => Math.max(0, i - 1));
  const next = () => setIndex((i) => Math.min(DEMO_SLIDES.length - 1, i + 1));

  return (
    <aside className="preview-frame" aria-label="Prévia interativa do palco">
      <div className="preview-chrome">
        <span className="preview-doc-name">apresentacao-trimestral.pdf</span>
        <span className="tally-pill">
          <span className="tally-dot" aria-hidden="true" />
          <span>Ao vivo</span>
        </span>
      </div>

      <div className="preview-slide-area">
        <div className="preview-slide-sheet">
          <div className="preview-slide-top">
            <span>{slide.tag}</span>
            <span>
              0{slide.number} / 0{DEMO_SLIDES.length}
            </span>
          </div>

          <div>
            <h2 className="preview-slide-heading">{slide.title}</h2>
            <p className="preview-slide-body">{slide.body}</p>
          </div>

          <div className="preview-slide-bars">
            {slide.metrics.map((m) => (
              <div key={m.label} className="preview-bar-item">
                <div className="preview-bar-val">{m.value}</div>
                <div className="preview-bar-lbl">{m.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="preview-dock">
        <span className="preview-sync-actor">{slide.actor}</span>
        <div className="preview-controls">
          <button
            type="button"
            className="btn btn-surface btn-icon"
            aria-label="Slide anterior da prévia"
            disabled={index === 0}
            onClick={prev}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <span className="preview-counter">
            {slide.number} / {DEMO_SLIDES.length}
          </span>
          <button
            type="button"
            className="btn btn-surface btn-icon"
            aria-label="Próximo slide da prévia"
            disabled={index === DEMO_SLIDES.length - 1}
            onClick={next}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </aside>
  );
}
