# Instrucciones de Restauración del Backup

Este punto de respaldo contiene el código fuente completo, configuraciones y reglas de seguridad del Dashboard DUNOR.

## Opciones de Restauración:

### Opción 1: Usando Git (Punto de Restauración Local)
Para regresar el proyecto exactamente a este punto en cualquier momento:
```bash
git checkout v1.0.0-backup
```

### Opción 2: Usando el archivo comprimido (.tar.gz)
En el directorio `backups/` se encuentra el archivo `backup_current_stable.tar.gz`:
```bash
tar -xzvf backups/backup_current_stable.tar.gz -C .
```

### Opción 3: Exportar el proyecto a tu equipo
Puedes ir al menú superior derecho de Google AI Studio y seleccionar **"Export to ZIP"** o **"Export to GitHub"** para guardar una copia externa en tu computadora o repositorio personal.
