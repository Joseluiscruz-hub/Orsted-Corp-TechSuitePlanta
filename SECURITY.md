# Política de Seguridad — Orsted Corp TechSuitePlanta

**Proyecto:** Orsted Corp TechSuitePlanta  
**Versión soportada:** `0.0.0` (rama `main`)

## Versiones soportadas

| Versión | Soporte de seguridad |
| ------- | -------------------- |
| 0.0.0   | Sí                   |

No hay ramas o versiones legacy (p. ej. 5.x / 4.x) en este repositorio. Solo se mantiene la versión actual publicada en `main`.

## Cómo reportar una vulnerabilidad

1. Contacta al propietario del repositorio (`Joseluiscruz-hub`) por un canal privado (no abras un issue público con detalles explotables).
2. Incluye: descripción, impacto estimado, pasos de reproducción y, si aplica, captura o PoC mínima.
3. Espera confirmación; se evaluará y priorizará según riesgo.

## Alcance relevante

- Dashboard operativo Angular + Firebase Realtime Database.
- La configuración web de Firebase en el cliente es pública; el control de escritura está en las **Realtime Database Rules** (`database.rules.json`) y en la autenticación de administradores.
- No envíes secretos (API keys privadas, credenciales) en issues, PRs ni commits.

## Despliegue de reglas Firebase

Publica las reglas RTDB desde Firebase Console → Realtime Database → Rules (o con Firebase CLI), usando el contenido de `database.rules.json` del repositorio.
