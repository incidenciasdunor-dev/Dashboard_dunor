import jsPDF from 'jspdf';

export function generateAppStructurePdf() {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const primaryColor: [number, number, number] = [79, 70, 229]; // Indigo-600 #4f46e5
  const secondaryColor: [number, number, number] = [30, 41, 59]; // Slate-800
  const textColor: [number, number, number] = [51, 65, 85]; // Slate-700
  const lightBg: [number, number, number] = [248, 250, 252]; // Slate-50
  const accentBorder: [number, number, number] = [226, 232, 240]; // Slate-200

  const checkPageBreak = (neededHeight: number) => {
    if (y + neededHeight > pageHeight - margin) {
      doc.addPage();
      y = margin;
      drawHeaderFooter();
    }
  };

  const drawHeaderFooter = () => {
    // Header line
    doc.setDrawColor(...primaryColor);
    doc.setLineWidth(0.8);
    doc.line(margin, 10, pageWidth - margin, 10);

    // Header text
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...primaryColor);
    doc.text('DUNOR - Sistema de Reporte y Gestión de Incidencias Escolares', margin, 8);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text('Estructura & Arquitectura del Sistema', pageWidth - margin, 8, { align: 'right' });

    // Footer line
    const pageCount = (doc as any).internal.getNumberOfPages();
    doc.setDrawColor(...accentBorder);
    doc.setLineWidth(0.3);
    doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);

    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`Página ${pageCount}`, pageWidth - margin, pageHeight - 7, { align: 'right' });
    doc.text('Documento Confidencial - Estructura del Software DUNOR', margin, pageHeight - 7);
  };

  // Title Banner
  doc.setFillColor(...primaryColor);
  doc.rect(margin, y, contentWidth, 28, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(255, 255, 255);
  doc.text('SISTEMA DUNOR', margin + 8, y + 12);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Especificación de Estructura, Roles y Funcionalidades del Sistema', margin + 8, y + 20);

  y += 34;

  const addSectionTitle = (title: string) => {
    checkPageBreak(16);
    doc.setFillColor(...lightBg);
    doc.rect(margin, y, contentWidth, 8, 'F');

    doc.setDrawColor(...primaryColor);
    doc.setLineWidth(1);
    doc.line(margin, y, margin, y + 8);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...secondaryColor);
    doc.text(title, margin + 4, y + 5.8);

    y += 12;
  };

  const addParagraph = (text: string) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...textColor);
    const lines = doc.splitTextToSize(text, contentWidth);
    checkPageBreak(lines.length * 4.5);
    doc.text(lines, margin, y);
    y += lines.length * 4.5 + 2;
  };

  const addBulletPoint = (boldPrefix: string, text: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...primaryColor);
    
    const prefixWidth = doc.getTextWidth(`•  ${boldPrefix}: `);
    const availableWidth = contentWidth - prefixWidth;

    const lines = doc.splitTextToSize(text, availableWidth);
    checkPageBreak(lines.length * 4.2 + 2);

    doc.text(`•  ${boldPrefix}: `, margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...textColor);
    
    if (lines.length > 0) {
      doc.text(lines[0], margin + prefixWidth, y);
      for (let i = 1; i < lines.length; i++) {
        doc.text(lines[i], margin + prefixWidth, y + (i * 4));
      }
    }
    y += lines.length * 4.2 + 2;
  };

  // 1. Resumen Ejecutivo
  addSectionTitle('1. Visión General del Sistema');
  addParagraph('DUNOR es un sistema integral de gestión y reporte de incidencias escolares diseñado para instituciones educativas. Permite registrar, categorizar, darle seguimiento oportuno y generar reportes analíticos de la conducta y convivencia escolar en tiempo real.');

  // 2. Roles de Usuario
  addSectionTitle('2. Estructura de Usuarios y Roles');
  addParagraph('El sistema implementa un control de acceso basado en roles (RBAC) con 4 niveles de permisos definidos:');

  addBulletPoint('Administrador (Admin)', 'Control total de la plataforma. Crea y gestiona cuentas de usuarios, modifica roles, configura ajustes del sistema, administra bitácoras de auditoría y accede a reportes globales.');
  addBulletPoint('Directivo / Orientación', 'Supervisa el estado general de las incidencias del plantel. Puede revisar cualquier reporte, reasignar responsables, agregar comentarios de seguimiento institucional y exportar expedientes en PDF.');
  addBulletPoint('Prefecto', 'Encargado del registro directo y canalización inmediata de incidencias diarias en pasillos y aulas. Puede crear folios, registrar evidencias, asignar docentes/orientadores y dar seguimiento.');
  addBulletPoint('Docente / Tutor', 'Registra incidencias sucedidas en su aula de clase o asignadas a sus grupos. Puede visualizar el historial de sus alumnos, agregar acuse de seguimiento y consultar recomendaciones pedagógicas.');

  // 3. Módulos y Funcionalidades
  addSectionTitle('3. Módulos y Funcionalidades Principales');
  
  addBulletPoint('Módulo de Registro de Incidencias', 'Formulario ágil para dar de alta incidencias especificando alumno, grado/grupo, categoría (leve, grave, gravísima), descripción, evidencia fotográfica y medidas tomadas.');
  addBulletPoint('Módulo de Historial y Expedientes', 'Visualización cronológica de reportes por alumno o grupo. Permite filtrar por fecha, estatus (Pendiente, En Proceso, Resuelto) o nivel de gravedad.');
  addBulletPoint('Módulo de Seguimiento y Comentarios', 'Timeline interactivo donde docentes y directivos registran avances, acuerdos con padres de familia, citatorios y firma de compromisos.');
  addBulletPoint('Asistente IA (Gemini Integration)', 'Generación automática de sugerencias pedagógicas, planes de intervención conductual y redacción formal de citatorios para tutores.');
  addBulletPoint('Notificaciones y Correos (Nodemailer)', 'Envío automatizado de avisos por correo electrónico a tutores y directivos cuando se registra una incidencia grave o requiere atención urgente.');
  addBulletPoint('Exportación e Impresión Oficial', 'Vista de impresión optimizada para generar el formato oficial de citatorio/incidencia con logotipos de la institución y firmas.');

  // 4. Modelo de Datos (Firestore)
  addSectionTitle('4. Modelo de Datos (Colecciones Firestore)');
  addParagraph('La base de datos NoSQL Firestore se organiza en las siguientes colecciones principales:');

  addBulletPoint('users', 'Guarda el perfil de los usuarios (uid, nombre, email, rol, estatus activo, teléfono, fecha de creación).');
  addBulletPoint('incidents', 'Almacena cada folio registrado (id, folio, studentName, grade, group, category, description, status, createdBy, assignedTo, createdAt, imageUrl).');
  addBulletPoint('followUps (Subcolección)', 'Historial de comentarios y avances de cada incidencia (authorId, authorName, comment, timestamp, statusChange).');
  addBulletPoint('logs', 'Bitácora de auditoría del sistema que registra acciones críticas (action, userId, userEmail, details, timestamp).');
  addBulletPoint('settings', 'Parámetros del plantel (nombre de escuela, ciclo escolar, correos de notificación, plantilla de citatorio).');

  // 5. Flujo de Trabajo
  addSectionTitle('5. Flujo de Trabajo Operativo');
  addParagraph('1. Detección y Registro: El docente o prefecto detecta la situación y llena el folio con los detalles del estudiante.\n2. Canalización: El sistema clasifica la gravedad y notifica automáticamente al directivo/orientador si aplica.\n3. Citatorio / Atención: Se expide el formato de citatorio con apoyo de sugerencias IA si es requerido.\n4. Seguimiento: Se registran los acuerdos firmados por los padres en el historial del alumno.\n5. Cierre de Folio: El directivo o responsable marca la incidencia como Resuelta.');

  // 6. Seguridad e Infraestructura
  addSectionTitle('6. Seguridad y Arquitectura de Despliegue');
  addParagraph('• Autenticación: Firebase Authentication con correo/contraseña y verificación de sesión.\n• Reglas de Seguridad (Firestore Rules): Validación estricta en servidor donde los usuarios solo leen/escriben según su rol verificado en la colección "users".\n• Servidor Proxy Backend (Node.js/Express): Enruta las peticiones de envío de correos y la API de Gemini de forma segura sin exponer claves públicas.');

  // Draw header/footer on page 1
  drawHeaderFooter();

  doc.save('Estructura_Sistema_DUNOR.pdf');
}
