export type UserRole = 'ADMIN' | 'COORDINATOR' | 'TEACHER' | 'PSYCHOLOGIST' | 'DIRECTIVE';
export type IncidentStatus = 'PENDIENTE' | 'RECIBIDO' | 'EN_SEGUIMIENTO' | 'CERRADO';
export type TaskStatus = 'ASIGNADA' | 'RECIBIDA' | 'REALIZADA' | 'COMPLETADA';

export interface FollowUpComment {
  comment: string;
  timestamp: number;
  authorName: string;
}

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  assignedCoordinatorId?: string;
  assignedCoordinatorEmail?: string;
  assignedCoordinatorName?: string;
  assignedPsychologistId?: string;
  assignedPsychologistEmail?: string;
  assignedPsychologistName?: string;
  educationLevel?: 'Preescolar' | 'Primaria' | 'Secundaria' | string;
  isRegistered?: boolean;
  password?: string;
  updatedAt?: number;
  customPermissions?: Partial<RolePermissions>;
}

export interface RolePermissions {
  // Pestañas / Módulos
  canViewNotifications: boolean;
  canViewIncidents: boolean;
  canCreateIncident: boolean;
  canViewTasks: boolean;
  canCreateTask: boolean;
  canViewUsers: boolean;
  canViewLogs: boolean;
  canViewSettings: boolean;
  canViewPermissions?: boolean;
  canViewReferrals: boolean;
  canCreateReferral: boolean;
  canViewExpedientes: boolean;
  canManageExpedientes: boolean;
  canViewInformes?: boolean;

  // Acciones y Funciones Específicas
  canEditIncidents: boolean;
  canDeleteIncidents: boolean;
  canChangeStatus: boolean;
  canAssignPsychologist: boolean;
  canAddFollowUp: boolean;
  canExportReports: boolean;
  canSendCongratulations: boolean;
  canManageUsers: boolean;
  canSendMassMessages: boolean;
}

export type RolePermissionsMap = Record<UserRole, RolePermissions>;

export const DEFAULT_ROLE_PERMISSIONS: RolePermissionsMap = {
  ADMIN: {
    canViewNotifications: true,
    canViewIncidents: true,
    canCreateIncident: false,
    canViewTasks: true,
    canCreateTask: true,
    canViewUsers: true,
    canViewLogs: false,
    canViewSettings: true,
    canViewReferrals: true,
    canCreateReferral: true,
    canViewExpedientes: true,
    canManageExpedientes: false,
    canViewInformes: true,

    canEditIncidents: true,
    canDeleteIncidents: true,
    canChangeStatus: true,
    canAssignPsychologist: true,
    canAddFollowUp: true,
    canExportReports: true,
    canSendCongratulations: true,
    canManageUsers: true,
    canSendMassMessages: true,
  },
  COORDINATOR: {
    canViewNotifications: true,
    canViewIncidents: true,
    canCreateIncident: true,
    canViewTasks: true,
    canCreateTask: false,
    canViewUsers: true,
    canViewLogs: false,
    canViewSettings: true,
    canViewReferrals: true,
    canCreateReferral: true,
    canViewExpedientes: true,
    canManageExpedientes: false,
    canViewInformes: true,

    canEditIncidents: true,
    canDeleteIncidents: false,
    canChangeStatus: true,
    canAssignPsychologist: true,
    canAddFollowUp: true,
    canExportReports: true,
    canSendCongratulations: false,
    canManageUsers: true,
    canSendMassMessages: false,
  },
  DIRECTIVE: {
    canViewNotifications: true,
    canViewIncidents: true,
    canCreateIncident: false,
    canViewTasks: true,
    canCreateTask: true,
    canViewUsers: true,
    canViewLogs: false,
    canViewSettings: true,
    canViewReferrals: true,
    canCreateReferral: false,
    canViewExpedientes: true,
    canManageExpedientes: false,
    canViewInformes: true,

    canEditIncidents: false,
    canDeleteIncidents: false,
    canChangeStatus: false,
    canAssignPsychologist: false,
    canAddFollowUp: false,
    canExportReports: true,
    canSendCongratulations: true,
    canManageUsers: true,
    canSendMassMessages: false,
  },
  TEACHER: {
    canViewNotifications: true,
    canViewIncidents: true,
    canCreateIncident: true,
    canViewTasks: true,
    canCreateTask: false,
    canViewUsers: false,
    canViewLogs: false,
    canViewSettings: false,
    canViewReferrals: true,
    canCreateReferral: true,
    canViewExpedientes: false,
    canManageExpedientes: false,
    canViewInformes: false,

    canEditIncidents: false,
    canDeleteIncidents: false,
    canChangeStatus: false,
    canAssignPsychologist: false,
    canAddFollowUp: true,
    canExportReports: true,
    canSendCongratulations: false,
    canManageUsers: false,
    canSendMassMessages: false,
  },
  PSYCHOLOGIST: {
    canViewNotifications: true,
    canViewIncidents: false,
    canCreateIncident: false,
    canViewTasks: true,
    canCreateTask: false,
    canViewUsers: false,
    canViewLogs: false,
    canViewSettings: false,
    canViewReferrals: true,
    canCreateReferral: true,
    canViewExpedientes: true,
    canManageExpedientes: true,
    canViewInformes: true,

    canEditIncidents: false,
    canDeleteIncidents: false,
    canChangeStatus: false,
    canAssignPsychologist: false,
    canAddFollowUp: true,
    canExportReports: true,
    canSendCongratulations: false,
    canManageUsers: false,
    canSendMassMessages: false,
  },
};

export const normalizeUserRole = (roleStr?: string | null): UserRole | undefined => {
  if (!roleStr) return undefined;
  const rUpper = String(roleStr).toUpperCase().trim();
  if (rUpper === 'ADMIN' || rUpper === 'ADMINISTRADOR' || rUpper === 'ADMINISTRADORA' || rUpper === 'ADMINISTRACION' || rUpper === 'ADMINISTRACIÓN') return 'ADMIN';
  if (rUpper === 'DIRECTIVE' || rUpper === 'DIRECTIVO' || rUpper === 'DIRECTIVA' || rUpper === 'DIRECCION' || rUpper === 'DIRECCIÓN' || rUpper === 'DIRECTOR' || rUpper === 'DIRECTORA') return 'DIRECTIVE';
  if (rUpper === 'COORDINATOR' || rUpper === 'COORDINADOR' || rUpper === 'COORDINADORA' || rUpper === 'COORDINACION' || rUpper === 'COORDINACIÓN') return 'COORDINATOR';
  if (rUpper === 'PSYCHOLOGIST' || rUpper === 'PSICOLOGO' || rUpper === 'PSICÓLOGO' || rUpper === 'PSICOLOGA' || rUpper === 'PSICÓLOGA' || rUpper === 'PSICOLOGIA' || rUpper === 'PSICOLOGÍA' || rUpper === 'ORIENTADOR' || rUpper === 'ORIENTADORA' || rUpper === 'ORIENTACION' || rUpper === 'ORIENTACIÓN') return 'PSYCHOLOGIST';
  if (rUpper === 'TEACHER' || rUpper === 'DOCENTE' || rUpper === 'PROFESOR' || rUpper === 'PROFESORA' || rUpper === 'MAESTRO' || rUpper === 'MAESTRA') return 'TEACHER';
  
  // Fallback checks for string inclusions
  if (rUpper.includes('ADMIN')) return 'ADMIN';
  if (rUpper.includes('DIREC')) return 'DIRECTIVE';
  if (rUpper.includes('COORD')) return 'COORDINATOR';
  if (rUpper.includes('PSICO') || rUpper.includes('ORIENTA')) return 'PSYCHOLOGIST';
  if (rUpper.includes('DOCEN') || rUpper.includes('PROFE') || rUpper.includes('MAESTR') || rUpper.includes('TEACH')) return 'TEACHER';

  return undefined;
};

export const getRolePermission = (
  role: UserRole | string | undefined | null,
  permissionKey: keyof RolePermissions,
  customMap?: Partial<RolePermissionsMap> | Record<string, any>,
  isSuperAdmin: boolean = false,
  userCustomPermissions?: Partial<RolePermissions>
): boolean => {
  if (isSuperAdmin) {
    return true;
  }

  const normRole = normalizeUserRole(role);
  const effectiveRole: UserRole | undefined = normRole || (isSuperAdmin ? 'ADMIN' : undefined);
  const isAdminOrSuperWithoutRole = isSuperAdmin && (normRole === 'ADMIN' || !normRole);

  // 1. Always guarantee access to critical management panels for Super Admins ONLY when role is ADMIN or unassigned
  if (isAdminOrSuperWithoutRole && (permissionKey === 'canViewPermissions' || permissionKey === 'canViewSettings' || permissionKey === 'canViewUsers')) {
    return true;
  }

  // 2. Check user-level custom permission IF explicitly defined for this specific user
  if (userCustomPermissions && typeof userCustomPermissions === 'object' && userCustomPermissions[permissionKey] !== undefined) {
    return Boolean(userCustomPermissions[permissionKey]);
  }

  // 3. Check role-level custom permissions explicitly set in Firestore (permisos collection / settings)
  if (effectiveRole && customMap) {
    // Check direct key
    if (customMap[effectiveRole] && customMap[effectiveRole]![permissionKey] !== undefined) {
      return Boolean(customMap[effectiveRole]![permissionKey]);
    }
    // Check normalized keys if customMap contains keys like 'psicologo', 'teacher', etc.
    const matchedKey = Object.keys(customMap).find(k => normalizeUserRole(k) === effectiveRole);
    if (matchedKey && customMap[matchedKey] && customMap[matchedKey][permissionKey] !== undefined) {
      return Boolean(customMap[matchedKey][permissionKey]);
    }
  }

  // 4. Fallback to default role permissions
  if (effectiveRole) {
    const roleDefaults = DEFAULT_ROLE_PERMISSIONS[effectiveRole];
    if (roleDefaults && roleDefaults[permissionKey] !== undefined) {
      return Boolean(roleDefaults[permissionKey]);
    }
  }

  return false;
};

export const hasPermission = getRolePermission;

export interface SystemSettings {
  appName?: string;
  appLogoUrl?: string;
  emailNotificationsEnabled: boolean;
  forwardingEnabled: boolean;
  coordinatorAdminMapping: Record<string, string[]>; // coordinatorId -> adminIds[]
  categories?: string[];
  rolePermissions?: Partial<RolePermissionsMap>;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  dueDate: string;
  assignedToEmail: string;
  assignedToName: string;
  assignedToRole: UserRole;
  createdByEmail: string;
  createdByName: string;
  createdByRole: UserRole;
  createdAt: number;
  status: TaskStatus;
  evidenceText?: string;
  evidenceFiles?: string[];
  evidenceSubmittedAt?: number;
  directiveFeedback?: string;
  readAt?: number;
  overdueReminderSent?: boolean;
  lastReminderSentAt?: number;
}

export interface Incident {
  id: string;
  date: string;
  place: string;
  students: string;
  description: string;
  disciplinaryMeasures: string;
  followUp: string;
  followUpHistory?: FollowUpComment[];
  reporterName: string;
  reporterId: string;
  reporterEmail?: string;
  coordinatorId: string;
  coordinatorIds?: string[];
  notifiedTeacherId?: string;
  suggestReferral?: boolean;
  referralStatus?: 'SUGGESTED' | 'IN_PROGRESS';
  referralComments?: string;
  school: string;
  isReceived: boolean;
  status?: IncidentStatus;
  readAt?: number;
  receivedByName?: string;
  images?: string[];
  categories?: string[];
  deletedByCoordinators?: string[];
  forwardedTo?: string[];
  createdAt: number;
}

export interface Log {
  id?: string;
  action: string;
  userEmail: string;
  userName: string;
  timestamp: number;
  details?: string;
}

export interface Referral {
  id: string;
  incidentId?: string;
  studentName: string;
  gradeGroup: string;
  teacherId: string;
  teacherName: string;
  teacherEmail: string;
  coordinatorId?: string;
  coordinatorName?: string;
  coordinatorEmail?: string;
  psychologistId?: string;
  psychologistName?: string;
  psychologistEmail?: string;
  reasonAndBackground: string;
  teacherStrategies: string;
  psychologistComment?: string;
  additionalRecipients?: { uid?: string; email: string; name: string; role: string }[];
  status?: 'PENDIENTE' | 'EN_VALORACION' | 'ATENDIDO';
  createdAt: number;
  updatedAt?: number;
}

export interface Expediente {
  id: string;
  studentName: string;
  gradeGroup?: string;
  linkedReferralId?: string;
  teacherName?: string;
  teacherEmail?: string;
  reasonAndBackground: string;
  teacherStrategies: string;
  parentInterviews?: string;
  psychologicalEvaluation?: string;
  attachmentName?: string;
  attachmentData?: string;
  psychologyFollowUp?: string;
  latestProgress?: string;
  notifiedCoordinatorEmail?: string;
  notifiedCoordinatorName?: string;
  psychologistId: string;
  psychologistName: string;
  psychologistEmail: string;
  status?: 'EN_PROCESO' | 'CASO_CONCLUIDO';
  createdAt: number;
  updatedAt: number;
}
