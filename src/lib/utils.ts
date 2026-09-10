import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { UserProfile } from '../types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function normalizeEducationLevel(lvl?: string): 'Preescolar' | 'Primaria' | 'Secundaria' | '' {
  if (!lvl) return '';
  const s = lvl.toLowerCase().trim();
  if (s.includes('pre') || s.includes('kinder') || s.includes('kínder')) return 'Preescolar';
  if (s.includes('prim')) return 'Primaria';
  if (s.includes('sec')) return 'Secundaria';
  return '';
}

export function getUserEducationLevel(
  user?: Partial<UserProfile> | null,
  allCoordinators?: UserProfile[]
): 'Preescolar' | 'Primaria' | 'Secundaria' | '' {
  if (!user) return '';

  // 1. Direct explicit educationLevel on user (highest priority - source of truth)
  if (user.educationLevel) {
    const norm = normalizeEducationLevel(user.educationLevel);
    if (norm) return norm;
  }

  // 2. User's own email or name (e.g., if user profile itself has section/level keyword)
  const userEmail = (user.email || '').toLowerCase();
  const userName = (user.name || '').toLowerCase();
  if (userEmail.includes('primaria') || userName.includes('primaria')) return 'Primaria';
  if (userEmail.includes('secundaria') || userName.includes('secundaria')) return 'Secundaria';
  if (userEmail.includes('kinder') || userName.includes('kinder') || userEmail.includes('preescolar') || userName.includes('preescolar')) return 'Preescolar';

  // 3. Coordinator lookup by assignedCoordinatorId in allCoordinators list
  if (user.assignedCoordinatorId && allCoordinators && allCoordinators.length > 0) {
    const matchedCoord = allCoordinators.find(
      c => c.uid === user.assignedCoordinatorId || (c.email && c.email.toLowerCase() === user.assignedCoordinatorEmail?.toLowerCase())
    );
    if (matchedCoord && matchedCoord !== user) {
      if (matchedCoord.educationLevel) {
        const coordNorm = normalizeEducationLevel(matchedCoord.educationLevel);
        if (coordNorm) return coordNorm;
      }
      const coordLevel = getUserEducationLevel(matchedCoord);
      if (coordLevel) return coordLevel;
    }
  }

  // 4. Assigned coordinator email or name (fallback if teacher has no level configured)
  const coordEmail = (user.assignedCoordinatorEmail || '').toLowerCase();
  const coordName = (user.assignedCoordinatorName || '').toLowerCase();
  if (coordEmail.includes('primaria') || coordName.includes('primaria')) return 'Primaria';
  if (coordEmail.includes('secundaria') || coordName.includes('secundaria')) return 'Secundaria';
  if (coordEmail.includes('kinder') || coordName.includes('kinder') || coordEmail.includes('preescolar') || coordName.includes('preescolar')) return 'Preescolar';

  return '';
}
