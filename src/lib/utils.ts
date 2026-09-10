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

/**
 * Normalizes text for search comparisons (removes accents/diacritics, lowercase, trimmed).
 */
export function normalizeSearchText(text?: string): string {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Normalizes a student's name by stripping diacritics / accents, converting to lowercase,
 * collapsing whitespace, and replacing punctuation with space.
 * E.g. "Hernández Ruiz, Mateo" -> "hernandez ruiz mateo"
 */
export function normalizeStudentName(name?: string): string {
  if (!name) return '';
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[,;.\-_/\\()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts unique word tokens from a normalized student name.
 */
export function getStudentNameTokens(name?: string): string[] {
  const norm = normalizeStudentName(name);
  if (!norm) return [];
  return norm.split(' ').filter(Boolean);
}

/**
 * Determines whether two student names refer to the same student:
 * 1. Exact match after accent and case removal (e.g. "Mateo Hernández" === "Mateo Hernandez").
 * 2. Word-order equivalence (e.g. "Hernández Ruiz Mateo" === "Mateo Hernández Ruiz").
 * 3. Subset equivalence when shorter name has at least 2 significant words
 *    (e.g. "Mateo Hernández" (2 words) is part of "Mateo Hernández Ruiz" (3 words)).
 */
export function areStudentNamesEquivalent(nameA?: string, nameB?: string): boolean {
  if (!nameA || !nameB) return false;
  const normA = normalizeStudentName(nameA);
  const normB = normalizeStudentName(nameB);
  if (!normA || !normB) return false;
  if (normA === normB) return true;

  const tokensA = getStudentNameTokens(nameA);
  const tokensB = getStudentNameTokens(nameB);

  if (tokensA.length === 0 || tokensB.length === 0) return false;

  // Check if sorted tokens are identical (e.g. "Apellidos Nombres" vs "Nombres Apellidos")
  const sortedA = [...tokensA].sort().join(' ');
  const sortedB = [...tokensB].sort().join(' ');
  if (sortedA === sortedB) return true;

  // Check if shorter name (at least 2 words, e.g. given name + surname) is completely contained in longer name
  const [shorter, longer] = tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];
  if (shorter.length >= 2) {
    const longerSet = new Set(longer);
    const allInLonger = shorter.every(token => longerSet.has(token));
    if (allInLonger) {
      return true;
    }
  }

  return false;
}

/**
 * Nicely formats a student name in Title Case if it was entered in ALL-CAPS or all-lowercase.
 */
export function formatStudentNameTitleCase(name: string): string {
  if (!name) return '';
  const clean = name.trim().replace(/\s+/g, ' ');
  const isAllUpper = clean === clean.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(clean);
  const isAllLower = clean === clean.toLowerCase();
  if (isAllUpper || isAllLower) {
    return clean
      .toLowerCase()
      .split(' ')
      .map(word => {
        if (!word) return '';
        if (['de', 'del', 'la', 'las', 'los', 'y', 'e'].includes(word)) {
          return word;
        }
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(' ');
  }
  return clean;
}

/**
 * Picks the most complete, accented, and well-cased display name between two equivalent names.
 */
export function pickBetterStudentDisplayName(nameA: string, nameB: string): string {
  if (!nameA) return formatStudentNameTitleCase(nameB || '');
  if (!nameB) return formatStudentNameTitleCase(nameA || '');

  const formattedA = formatStudentNameTitleCase(nameA);
  const formattedB = formatStudentNameTitleCase(nameB);

  const hasAccentsA = /[áéíóúÁÉÍÓÚñÑüÜ]/.test(formattedA);
  const hasAccentsB = /[áéíóúÁÉÍÓÚñÑüÜ]/.test(formattedB);

  const tokensA = getStudentNameTokens(formattedA);
  const tokensB = getStudentNameTokens(formattedB);

  // If one name is more complete (e.g., has both surnames or given names)
  if (tokensA.length !== tokensB.length) {
    return tokensA.length > tokensB.length ? formattedA : formattedB;
  }

  // If one has accents and the other does not, prefer the accented version
  if (hasAccentsA && !hasAccentsB) return formattedA;
  if (hasAccentsB && !hasAccentsA) return formattedB;

  return formattedA.length >= formattedB.length ? formattedA : formattedB;
}

