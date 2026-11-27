import { ArrowLeft } from 'lucide-react';
import { BrandMark } from '@/ui/components/BrandMark';
import { ThemeToggle } from '@/ui/components/ThemeToggle';

interface PrivacyPageProps {
  onNavigateHome: () => void;
}

function isPlainLeftClick(event: React.MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

export function PrivacyPage({ onNavigateHome }: PrivacyPageProps) {
  const handleHomeClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainLeftClick(event)) return;
    event.preventDefault();
    onNavigateHome();
  };

  return (
    <div className="home-shell">
      <header className="home-header">
        <BrandMark asLink onClick={handleHomeClick} />
        <ThemeToggle />
      </header>

      <main id="main-content" className="privacy-main">
        <a href="/" className="privacy-back" onClick={handleHomeClick}>
          <ArrowLeft size={16} aria-hidden="true" />
          <span>Voltar ao início</span>
        </a>

        <header className="privacy-hero">
          <h1 className="privacy-title">Política de Privacidade</h1>
          <p className="privacy-lead">
            O Palco funciona sem cadastro, sem login e sem guardar seus arquivos na
            nuvem. Aqui explicamos, em linguagem simples, o que acontece com seus dados
            ao usar o site.
          </p>
          <p className="privacy-updated">Última atualização: novembro de 2026</p>
        </header>

        <div className="privacy-sections">
          <section className="privacy-section" aria-labelledby="privacy-pdfs">
            <h2 id="privacy-pdfs">1. Seus arquivos PDF</h2>
            <p>
              O PDF escolhido por quem cria a sala sai direto do seu dispositivo para as
              pessoas que entrarem pelo link ou código da apresentação, em uma conexão
              direta e criptografada.
            </p>
            <p>
              Nós não recebemos, não salvamos, não vendemos e não temos acesso ao
              conteúdo dos seus arquivos. Compartilhe o link apenas com quem deve ver a
              apresentação: ao encerrar a sala ou fechar a aba, o acesso deixa de
              funcionar.
            </p>
          </section>

          <section className="privacy-section" aria-labelledby="privacy-storage">
            <h2 id="privacy-storage">2. O que fica salvo no seu navegador</h2>
            <p>
              Não usamos cookies de rastreamento, anúncios nem ferramentas para
              monitorar sua navegação. Apenas informações locais ficam no próprio
              navegador:
            </p>
            <ul>
              <li>
                <strong>Preferência de tema:</strong> guarda se você prefere o site no
                modo claro ou escuro, até que você limpe os dados do site no navegador.
              </li>
              <li>
                <strong>Cópia temporária da sala:</strong> enquanto a apresentação está
                aberta, quem criou a sala mantém o arquivo guardado temporariamente no
                próprio navegador para não perder tudo caso a página seja recarregada.
                Ao sair ou encerrar a sala, esses dados são apagados automaticamente.
              </li>
            </ul>
          </section>

          <section className="privacy-section" aria-labelledby="privacy-third-parties">
            <h2 id="privacy-third-parties">3. Serviços de terceiros</h2>
            <p>
              Para o site abrir e os dispositivos conseguirem se conectar entre si,
              alguns serviços externos (que podem operar fora do Brasil) participam da
              entrega e podem receber o endereço de rede (IP) do seu aparelho, como
              acontece normalmente na internet:
            </p>
            <ul>
              <li>
                <strong>
                  Conexão entre participantes (PeerJS, Google e Cloudflare):
                </strong>{' '}
                serviços auxiliares usados apenas para que os dispositivos da mesma sala
                se encontrem e conversem diretamente. Eles nunca recebem o conteúdo do
                PDF. Nesse formato direto, os participantes da mesma sala também trocam
                seus endereços de rede entre si.
              </li>
              <li>
                <strong>Hospedagem (Vercel):</strong> onde o site está hospedado,
                mantendo registros básicos de acesso (como IP, navegador e horário) para
                segurança e estabilidade.
              </li>
              <li>
                <strong>Fontes da página (Google Fonts):</strong> usadas apenas para
                exibir a tipografia do site.
              </li>
            </ul>
          </section>

          <section className="privacy-section" aria-labelledby="privacy-rights">
            <h2 id="privacy-rights">4. Seus direitos e controle</h2>
            <p>
              O Palco não mantém contas de usuário, histórico de apresentações nem banco
              de dados com suas informações pessoais. Você tem controle total sobre o
              que fica no seu dispositivo: basta encerrar a sala para remover a cópia
              temporária do PDF ou limpar os dados do site no navegador para apagar a
              preferência de tema.
            </p>
          </section>

          <section className="privacy-section" aria-labelledby="privacy-updates">
            <h2 id="privacy-updates">5. Atualizações desta política</h2>
            <p>
              Esta página reflete o funcionamento atual do Palco e será atualizada
              sempre que novos recursos ou serviços externos passarem a ser usados, com
              a nova data exibida no topo.
            </p>
          </section>
        </div>
      </main>

      <footer className="home-footer">
        <span>Palco | Coapresentação de PDFs em tempo real</span>
        <a href="/" className="home-footer-link" onClick={handleHomeClick}>
          Voltar para a página inicial
        </a>
      </footer>
    </div>
  );
}
