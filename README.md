# Consulta por nombre

Busca personas por nombre y apellidos: devuelve candidatos y luego la ficha.

## Local

    node servidor.js
    http://localhost:3000

Sin `.env` arranca en modo demo.

## Variables

Copia `.env.ejemplo` a `.env`. `MODO_DEMO=0` activa datos reales.
`CLAVE_ACCESO` protege la app: se pasa como `?k=CLAVE` y queda en cookie.

## Rutas

- GET /api/buscar?pais=VE&nombre=Jose+Perez
- GET /api/ficha?pais=VE&doc=12345678
- POST /api/banco/validar
- GET /health
