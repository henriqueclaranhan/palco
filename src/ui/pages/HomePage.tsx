import { useRef, useState } from 'react';
import { FileUp, Lock, ShieldCheck, Smartphone } from 'lucide-react';
import { env } from '@/config/env';
import { isValidRoomCode, normalizeRoomCode } from '@/domain/protocol';
import { validatePdfFile } from '@/domain/pdfValidation';
import { BrandMark } from '@/ui/components/BrandMark';
import { StagePreview } from '@/ui/components/StagePreview';
import { ThemeToggle } from '@/ui/components/ThemeToggle';

interface HomePageProps {
  onStartAsHost: (file: File) => void;
  onJoinRoom: (roomCode: string) => void;
  onOpenPrivacy: () => void;
}

export function HomePage({ onStartAsHost, onJoinRoom, onOpenPrivacy }: HomePageProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [roomInput, setRoomInput] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    const error = validatePdfFile(file);
    if (error) {
      setFileError(error);
      return;
    }
    setFileError(null);
    onStartAsHost(file);
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeRoomCode(roomInput);
    if (!isValidRoomCode(normalized)) {
      setJoinError('Digite um código válido de 8 caracteres, como K7M2-P9X4.');
      return;
    }
    setJoinError(null);
    onJoinRoom(normalized);
  };

  return (
    <div className="home-shell">
      <header className="home-header">
        <BrandMark asLink />
        <ThemeToggle />
      </header>

      <main id="main-content" className="home-main">
        <section className="home-copy" aria-labelledby="hero-title">
          <h1 id="hero-title" className="home-title">
            Chega de dizer “pode passar o slide”
          </h1>
          <p className="home-lead">
            Abra seu arquivo, envie o link temporário e deixe outra pessoa avançar ou
            voltar as páginas em tempo real.
          </p>

          <div
            className="dropzone"
            data-dragging={isDragging}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              handleFile(e.dataTransfer.files?.[0]);
            }}
          >
            <div className="dropzone-head">
              <span className="dropzone-icon" aria-hidden="true">
                <FileUp size={20} />
              </span>
              <div>
                <p className="dropzone-title">Iniciar nova apresentação</p>
                <p className="dropzone-hint">
                  Arraste um PDF aqui ou selecione do seu dispositivo (até{' '}
                  {env.maxPdfMb}&nbsp;MB).
                </p>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              aria-label="Selecionar arquivo PDF para apresentar"
              onChange={(e) => {
                handleFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />

            <div className="dropzone-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileUp size={17} aria-hidden="true" />
                <span>Escolher PDF e abrir sala</span>
              </button>
            </div>

            {fileError && (
              <p className="join-error" role="alert">
                {fileError}
              </p>
            )}
          </div>

          <form className="join-bar" onSubmit={handleJoinSubmit} noValidate>
            <label htmlFor="room-code-input" className="join-label">
              Recebeu um código de coapresentação?
            </label>
            <div className="join-row">
              <input
                id="room-code-input"
                name="roomCode"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="Ex.: K7M2-P9X4…"
                className="join-input"
                value={roomInput}
                onChange={(e) => {
                  setRoomInput(e.target.value);
                  if (joinError) setJoinError(null);
                }}
                aria-invalid={Boolean(joinError)}
              />
              <button type="submit" className="btn btn-surface">
                Entrar na sala
              </button>
            </div>
            {joinError && (
              <p className="join-error" role="alert">
                {joinError}
              </p>
            )}
          </form>
        </section>

        <StagePreview />
      </main>

      <footer className="home-footer">
        <ul className="home-guarantees">
          <li>
            <ShieldCheck size={15} aria-hidden="true" />
            <span>Transferência direta P2P (WebRTC)</span>
          </li>
          <li>
            <Lock size={15} aria-hidden="true" />
            <span>Link expira quando o anfitrião fecha a sala</span>
          </li>
          <li>
            <Smartphone size={15} aria-hidden="true" />
            <span>Tela cheia e gestos no desktop e mobile</span>
          </li>
        </ul>
        <a
          href="/privacidade"
          className="home-footer-link"
          onClick={(e) => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
              return;
            }
            e.preventDefault();
            onOpenPrivacy();
          }}
        >
          Privacidade
        </a>
      </footer>
    </div>
  );
}
