interface BrandMarkProps {
  compactOnMobile?: boolean;
  asLink?: boolean;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}

function BrandGlyph() {
  return (
    <span className="brand-icon" aria-hidden="true">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
        <rect
          x="2"
          y="3"
          width="20"
          height="14"
          rx="2.5"
          stroke="var(--accent)"
          strokeWidth="2.2"
        />
        <circle cx="8" cy="21" r="1.9" fill="var(--accent)" />
        <circle cx="16" cy="21" r="1.9" fill="currentColor" />
      </svg>
    </span>
  );
}

export function BrandMark({
  compactOnMobile = false,
  asLink = false,
  onClick,
}: BrandMarkProps) {
  const content = (
    <>
      <BrandGlyph />
      <span className={compactOnMobile ? 'topbar-label-desktop' : undefined}>
        Palco
      </span>
    </>
  );

  if (asLink) {
    return (
      <a href="/" className="brand" translate="no" onClick={onClick}>
        {content}
      </a>
    );
  }

  return (
    <span className="brand" translate="no">
      {content}
    </span>
  );
}
