import { useRef } from 'react';
import {
  AlertCircle,
  Download,
  FileUp,
  PowerOff,
  Radio,
  RotateCcw,
} from 'lucide-react';
import type { ParticipantRole } from '@/domain/protocol';
import type { SessionStatus } from '@/domain/session';

interface StageOverlayProps {
  role: ParticipantRole;
  status: SessionStatus;
  roomCode: string;
  transferProgress: number;
  errorMessage: string | null;
  onSelectFile: (file: File) => void;
  onLeaveToHome: () => void;
}

export function StageOverlay({
  role,
  status,
  roomCode,
  transferProgress,
  errorMessage,
  onSelectFile,
  onLeaveToHome,
}: StageOverlayProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  switch (status) {
    case 'ended':
      return (
        <div className="stage-state-card">
          <span className="stage-state-icon" aria-hidden="true">
            <PowerOff size={22} />
          </span>
          <h1 className="stage-state-title">Apresentação encerrada</h1>
          <p className="stage-state-desc">
            {role === 'host'
              ? 'A sala foi finalizada e o link temporário deixou de funcionar.'
              : 'O anfitrião encerrou a apresentação. O PDF foi removido da memória e este link não está mais ativo.'}
          </p>
          <div className="state-actions">
            <button type="button" className="btn btn-primary" onClick={onLeaveToHome}>
              Voltar ao início
            </button>
          </div>
        </div>
      );

    case 'error':
      return (
        <div className="stage-state-card" role="alert">
          <span className="stage-state-icon" data-tone="danger" aria-hidden="true">
            <AlertCircle size={22} />
          </span>
          <h1 className="stage-state-title">Não foi possível conectar</h1>
          <p className="stage-state-desc">
            {errorMessage ?? 'Ocorreu um problema na conexão com a sala.'}
          </p>
          <div className="state-actions">
            <button
              type="button"
              className="btn btn-surface"
              onClick={() => window.location.reload()}
            >
              <RotateCcw size={16} aria-hidden="true" />
              <span>Tentar novamente</span>
            </button>
            <button type="button" className="btn btn-primary" onClick={onLeaveToHome}>
              Voltar ao início
            </button>
          </div>
        </div>
      );

    case 'connecting':
    case 'reconnecting':
      return (
        <div className="stage-state-card" aria-live="polite">
          <span className="stage-state-icon" aria-hidden="true">
            <Radio size={22} />
          </span>
          <h1 className="stage-state-title">
            {status === 'reconnecting'
              ? 'Reconectando ao anfitrião…'
              : 'Conectando ao anfitrião…'}
          </h1>
          <p className="stage-state-desc">
            {status === 'reconnecting'
              ? 'Aguardando o anfitrião retornar à sala.'
              : 'Estabelecendo canal direto P2P com a sala '}
            {status === 'connecting' && (
              <>
                <strong translate="no">{roomCode}</strong>.
              </>
            )}
          </p>
        </div>
      );

    case 'transferring': {
      const progressPct = Math.round(transferProgress * 100);
      return (
        <div className="stage-state-card" aria-live="polite">
          <span className="stage-state-icon" aria-hidden="true">
            <Download size={22} />
          </span>
          <h1 className="stage-state-title">Recebendo PDF ({progressPct}%)…</h1>
          <p className="stage-state-desc">
            Transferência direta do navegador do anfitrião. Nenhum arquivo é salvo em
            servidor.
          </p>
          <div
            className="progress-track"
            role="progressbar"
            aria-valuenow={progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="progress-fill"
              style={{ width: `${Math.max(4, progressPct)}%` }}
            />
          </div>
        </div>
      );
    }

    default:
      if (role !== 'host') return null;
      return (
        <div className="stage-state-card">
          <span className="stage-state-icon" aria-hidden="true">
            <FileUp size={22} />
          </span>
          <h1 className="stage-state-title">Escolha um PDF para apresentar</h1>
          <p className="stage-state-desc">
            Sala <strong translate="no">{roomCode}</strong> pronta. Assim que você
            escolher o arquivo, qualquer coapresentador conectado o receberá
            automaticamente.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onSelectFile(file);
              e.target.value = '';
            }}
          />
          <div className="state-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp size={16} aria-hidden="true" />
              <span>Selecionar PDF</span>
            </button>
          </div>
        </div>
      );
  }
}
