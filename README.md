# Orion Group – Payload Calculator

An interactive, client-side launch configurator that estimates the **maximum payload capacity** of a rocket using the **Tsiolkovsky rocket equation**. Built with plain HTML5, CSS3 and vanilla JavaScript – no frameworks, no build step, no server.

> School project for the fictional aerospace and defense company **Orion Group**. The data and orbit requirements are illustrative.

## Features

- **Three-column dashboard** (CSS Grid): parameters, rocket blueprint, results. Collapses to a single column on mobile.
- **Real-time input validation**: rejects empty, negative, zero, non-numeric and out-of-range values, with accessible error messages (`aria-invalid`, `role="alert"`).
- **Physics engine** with fully commented formulas: payload capacity, ideal Δv, TWR at T=0, burn time and mass flow rate.
- **Mission status**: green **GO** or red **NO-GO / FALHA** depending on TWR and payload viability.
- **Edge case handling**: a negative computed payload is forced to `0 kg` and an alert explains why the mission is infeasible.
- **Blueprint with dynamic dimensions**: segment heights and labels update with the mass distribution. A scanning and ignition animation runs for 2 seconds after each calculation.
- **Doughnut chart** ([Chart.js](https://www.chartjs.org/)) showing the percentage split between payload, propellant and dry mass.
- **Alerts** with [SweetAlert2](https://sweetalert2.github.io/), plus an inline fallback if the CDN is unavailable.
- Dark glassmorphism theme, `prefers-reduced-motion` support, semantic HTML and ARIA labels.

## Getting started

No installation is required. The libraries are loaded from a CDN, so an internet connection is needed.

1. Clone the repository:
   ```bash
   git clone https://github.com/<your-username>/orion-payload-calculator.git
   cd orion-payload-calculator
   ```
2. Open `index.html` in your browser, or serve the folder locally:
   ```bash
   python3 -m http.server 8000
   ```
   Then visit <http://localhost:8000>.

## Project structure

```
orion-payload-calculator/
├── index.html          # Markup and CDN script tags
├── style.css           # Styles, design tokens and responsive layout
├── script.js           # Physics, validation, view, chart and controller modules
└── assets/
    └── images/         # Optional: orion-blueprint.png replaces the built-in SVG blueprint
```

To use your own blueprint image, save it as `assets/images/orion-blueprint.png`. The script detects it and replaces the default SVG automatically.

## The physics

All calculations are in `script.js` (module `Physics`), with `g₀ = 9.81 m/s²`.

**Tsiolkovsky rocket equation**

```
Δv = vₑ · ln(m₀ / m_f),     vₑ = Isp · g₀
m₀ = dry mass + propellant + payload
m_f = dry mass + payload
```

**Payload capacity** – the equation is inverted to solve for the maximum payload `P` that still delivers the Δv required by the target orbit:

```
R = e^(Δv_required / vₑ)
P = propellant / (R − 1) − dry mass
```

If `P < 0`, the rocket cannot reach the orbit even when empty, so the payload is forced to `0 kg`.

**Mass flow rate and burn time**

```
ṁ = Thrust / (Isp · g₀)
t_burn = propellant / ṁ
```

**Thrust-to-weight ratio at T = 0** (maximum mass, tanks full and payload on board):

```
TWR = Thrust / (m₀ · g₀)
```

The mission is **GO** only if `TWR > 1.05` and the payload is positive.

### Target orbits

| Orbit | Required Δv (approx.) |
| ----- | --------------------- |
| LEO   | 9 400 m/s             |
| MEO   | 12 500 m/s            |
| GEO   | 13 900 m/s            |

Values are typical estimates that include gravity and drag losses.

### Default Orion data

| Parameter       | Value       |
| --------------- | ----------- |
| Dry mass        | 186 300 kg  |
| Propellant mass | 144 000 kg  |
| Thrust          | 4 682.5 kN  |
| Isp             | 300 s       |

With these values the result is **NO-GO**. With zero payload the rocket only reaches about 1 685 m/s, well below the 9 400 m/s needed for LEO, even though its TWR (≈ 1.45) is sufficient to lift off. The **Demo scenario** button loads an idealized single-stage vehicle that produces a **GO** result.

## Model limitations

- Constant thrust and Isp during the whole burn (sea-level Isp).
- Single stage, no staging.
- No atmospheric drag or steering losses modeled explicitly; they are included in the orbit Δv estimates.

## Browser support

Any modern browser with support for CSS Grid, container queries and ES2018 (Chrome, Edge, Safari 16+, Firefox 110+).

## Tech stack

- HTML5, CSS3, vanilla JavaScript (ES2018)
- [Chart.js 4](https://www.chartjs.org/)
- [SweetAlert2](https://sweetalert2.github.io/)
- [Inter](https://fonts.google.com/specimen/Inter) via Google Fonts

## License

Educational project. Add a license of your choice (for example MIT) before publishing.