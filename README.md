# Patrimonio (net-worth)

App personal para responder "¿cuánta plata tengo?" sumando todo lo que está repartido entre brokers, exchanges, bancos y efectivo.

Es una PWA: se instala desde Safari con **Compartir → Agregar a pantalla de inicio** y funciona como una app. Los datos (tenencias y ajustes) quedan guardados solo en el teléfono; el repo no contiene ninguna información personal.

## Qué hace

- Cada tenencia es un instrumento con precio + cantidad de unidades, asignada a una plataforma y un tipo.
- Muestra el valor de cada tenencia, el total por plataforma o por tipo, y el total general en USD, ARS u otra moneda.
- Actualiza al abrir la app, al volver a ella y al deslizar hacia abajo.
- Plataformas, tipos de bien y monedas se pueden agregar desde Ajustes.
- Historial: gráfico de cuánto valían las tenencias actuales en cada fecha, con presets (1S, 1M, 3M, 6M, este año, 1A, 2A) y rango personalizado.
- Widget de iPhone vía Scriptable (Ajustes → "Copiar script del widget"): chico con total y resultado del día; mediano con total, resultado de hoy, 7 y 30 días y dólar.
- Importa el reporte de cartera CSV de Cocos Capital (reemplaza las tenencias de Cocos en cada importación).
- Exporta e importa una copia de seguridad en JSON.

## Fuentes de cotización (gratis, sin clave)

| Qué | Fuente |
| --- | --- |
| Cripto y monedas (EUR, BRL…) | [CoinGecko](https://www.coingecko.com/en/api) |
| Dólar oficial, MEP, CCL, blue, cripto | [dolarapi.com](https://dolarapi.com) |
| CEDEARs, acciones, bonos y ONs de BYMA; acciones de EE.UU. | [data912.com](https://data912.com) |
| Fondos comunes de inversión | [argentinadatos.com](https://argentinadatos.com) |
| Dólar histórico | [argentinadatos.com](https://argentinadatos.com) |
| Lo que no cotiza | valor manual |

## Desarrollo

```bash
npm install
npm run dev
```

Cada push a `main` se publica en GitHub Pages con `.github/workflows/deploy.yml`.
