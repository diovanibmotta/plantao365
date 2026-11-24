export const AVATAR_OPTIONS = [
  '🚀',
  '🛠️',
  '💻',
  '🛡️',
  '📊',
  '☁️',
  '🔧',
  '📞',
  '🧪',
  '⚡',
  '🌐',
  '🎯',
];

interface Props {
  name: string;
  avatar?: string | null | undefined;
  size?: 'md' | 'lg';
}

/** Ícone da equipe; sem ícone escolhido, mostra a inicial do nome. */
export function TeamAvatar({ name, avatar, size = 'md' }: Props) {
  return (
    <span className={`team-avatar team-avatar-${size}`} aria-hidden="true">
      {avatar || name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
