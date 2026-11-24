import { useState } from 'react';

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0]!, parts[parts.length - 1]!] : parts;
  return letters.map((p) => p[0]!.toUpperCase()).join('') || '?';
}

interface AvatarProps {
  userId: string;
  name: string;
  className?: string;
}

/** Foto do Microsoft Entra ID (salva no login); sem foto, mostra as iniciais. */
export function Avatar({ userId, name, className = 'avatar' }: AvatarProps) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span className={className} aria-hidden="true">
      {failed === userId ? (
        initials(name)
      ) : (
        <img src={`/api/users/${userId}/photo`} alt="" onError={() => setFailed(userId)} />
      )}
    </span>
  );
}
