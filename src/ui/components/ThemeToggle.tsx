import { Moon, Sun } from 'lucide-react';
import { useColorScheme } from '@/application/useColorScheme';

export function ThemeToggle() {
  const { resolvedScheme, toggleScheme } = useColorScheme();
  const isDark = resolvedScheme === 'dark';
  const label = isDark ? 'Mudar para tema claro' : 'Mudar para tema escuro';

  return (
    <button
      type="button"
      className="btn btn-surface btn-icon"
      onClick={toggleScheme}
      aria-label={label}
      title={label}
    >
      {isDark ? (
        <Sun size={16} aria-hidden="true" />
      ) : (
        <Moon size={16} aria-hidden="true" />
      )}
    </button>
  );
}
