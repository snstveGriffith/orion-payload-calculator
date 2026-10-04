/* ==========================================================================
   ORION GROUP · PAYLOAD CALCULATOR — script.js
   --------------------------------------------------------------------------
   Estrutura (tudo dentro de uma IIFE → nada polui o escopo global):

     1. CONSTANTES FÍSICAS E DE CONFIGURAÇÃO
     2. MÓDULO DE FÍSICA  (funções puras: recebem números, devolvem números)
     3. MÓDULO DE VALIDAÇÃO (validação em tempo real dos inputs)
     4. MÓDULO DE VISTA   (DOM, blueprint, telemetria, alertas)
     5. MÓDULO DO GRÁFICO (Chart.js – doughnut)
     6. CONTROLADOR       (liga tudo: eventos, "Calculate", presets)
   ========================================================================== */
(function () {
    "use strict";

    /* ========================================================================
       1. CONSTANTES
       ======================================================================== */

    /**
     * g₀ — aceleração gravítica padrão ao nível do mar: 9,81 m/s².
     * É usada em DOIS sítios, com significados diferentes:
     *   a) Isp (em segundos) → velocidade de escape:   vₑ = Isp · g₀   [m/s]
     *   b) massa → peso:                                 W  = m · g₀     [N]
     * (Convenção: o Isp expresso em "segundos" é definido com g₀, por isso é a
     *  mesma constante nas duas utilizações.)
     */
    const G0 = 9.81;

    /** Limiar mínimo de TWR para considerar a descolagem segura (margem de 5 %). */
    const TWR_MIN = 1.05;

    /** Duração da animação de "processamento" / ignição após clicar em Calculate. */
    const PROCESSING_MS = 2000;

    /** Valores oficiais do foguetão Orion (pré-preenchidos no formulário). */
    const ORION_OFFICIAL = Object.freeze({
        dryMass: 186300, // kg
        propellantMass: 144000, // kg
        thrustKN: 4682.5, // kN
        isp: 300, // s
        orbitDeltaV: 9400, // m/s (LEO)
    });

    /**
     * Cenário de demonstração (ilustrativo, NÃO é o Orion): um lançador
     * "single-stage-to-orbit" idealizado com muito propelente, para mostrar o
     * estado GO. Cálculo: ver comentário no módulo de física.
     */
    const DEMO_SCENARIO = Object.freeze({
        dryMass: 20000,
        propellantMass: 400000,
        thrustKN: 6000,
        isp: 350,
        orbitDeltaV: 9400,
    });

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* Formatadores numéricos em português de Portugal */
    const fmt0 = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 0 });
    const fmt1 = new Intl.NumberFormat("pt-PT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const fmt2 = new Intl.NumberFormat("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    /* ========================================================================
       2. MÓDULO DE FÍSICA
       ======================================================================== */
    const Physics = (function () {
        /**
         * Calcula toda a missão a partir dos parâmetros de entrada.
         *
         * ----------------------------------------------------------------------
         * EQUAÇÃO DO FOGUETÃO DE TSIOLKOVSKY
         * ----------------------------------------------------------------------
         *     Δv = vₑ · ln( m₀ / m_f )         com     vₑ = Isp · g₀
         *
         *   Δv  → variação de velocidade que o foguetão consegue produzir [m/s]
         *   vₑ  → velocidade de escape efetiva dos gases                 [m/s]
         *   m₀  → massa INICIAL  = massa seca + propelente + carga útil  [kg]
         *   m_f → massa FINAL    = massa seca + carga útil (tanques vazios) [kg]
         *
         * Sendo P a carga útil (payload):
         *     m₀ = M_seca + M_prop + P
         *     m_f = M_seca + P
         *
         * ----------------------------------------------------------------------
         * ISOLAR A CARGA ÚTIL (o que o programa realmente resolve)
         * ----------------------------------------------------------------------
         * Queremos o maior P tal que  Δv_disponível ≥ Δv_exigido (pela órbita).
         * O limite é a igualdade; invertemos a equação de Tsiolkovsky:
         *
         *   Δv = vₑ · ln(m₀ / m_f)
         *   ⇒ m₀ / m_f = e^(Δv / vₑ) ≡ R           (R = razão de massas exigida)
         *   ⇒ M_seca + M_prop + P = R · (M_seca + P)
         *   ⇒ M_prop − (R − 1)·M_seca = (R − 1)·P
         *
         *   ⇒        P = M_prop / (R − 1) − M_seca                      (★)
         *
         * Se (★) der um valor NEGATIVO, nem sequer sem carga o foguetão atinge o
         * Δv exigido → missão inviável → forçamos P = 0 kg e avisamos o utilizador.
         *
         * ----------------------------------------------------------------------
         * FLUXO DE MASSA E TEMPO DE QUEIMA
         * ----------------------------------------------------------------------
         * O empuxo é F = ṁ · vₑ = ṁ · Isp · g₀, logo:
         *
         *     ṁ (Mass Flow Rate) = F / (Isp · g₀)            [kg/s]
         *     t_queima = M_prop / ṁ                           [s]
         *
         * (assume empuxo e Isp constantes durante toda a queima.)
         *
         * ----------------------------------------------------------------------
         * TWR (Thrust-to-Weight Ratio) VALIDADO EM T = 0
         * ----------------------------------------------------------------------
         * No instante da ignição (T = 0) o foguetão tem a MASSA MÁXIMA (m₀, com
         * tanques cheios e carga a bordo) – é o momento mais desfavorável:
         *
         *     TWR₀ = F / (m₀ · g₀)
         *
         * Se TWR₀ ≤ 1 o empuxo não vence o peso e o foguetão nem sai da plataforma.
         * Exigimos TWR₀ > 1,05 (margem de segurança de 5 %).
         *
         * @param {{dryMass:number, propellantMass:number, thrustKN:number,
         *          isp:number, orbitDeltaV:number}} input  (kg, kg, kN, s, m/s)
         * @returns {object} resultados e diagnóstico
         */
        function computeMission(input) {
            const { dryMass, propellantMass, thrustKN, isp, orbitDeltaV } = input;

            // (a) Velocidade de escape: vₑ = Isp · g₀
            const exhaustVelocity = isp * G0;

            // (b) Razão de massas exigida pela órbita: R = e^(Δv / vₑ)
            //     (se o expoente for enorme, exp() dá Infinity → P fica negativo → tratado abaixo)
            const requiredMassRatio = Math.exp(orbitDeltaV / exhaustVelocity);

            // (c) Carga útil máxima — fórmula (★):  P = M_prop / (R − 1) − M_seca
            const rawPayload = propellantMass / (requiredMassRatio - 1) - dryMass;

            // (d) Caso crítico: valor negativo ⇒ forçar 0 kg
            const payloadViable = rawPayload > 0;
            const payload = payloadViable ? rawPayload : 0;

            // (e) Massas ao lançamento (T=0) e no fim da queima
            const initialMass = dryMass + propellantMass + payload; // m₀
            const finalMass = dryMass + payload; // m_f

            // (f) Δv realmente disponível com a carga calculada (verificação cruzada).
            //     Se payloadViable → coincide com orbitDeltaV; senão → Δv máximo com carga nula.
            const deltaVAvailable = exhaustVelocity * Math.log(initialMass / finalMass);

            // (g) Fluxo de massa e tempo de queima
            const thrustN = thrustKN * 1000; // kN → N
            const massFlowRate = thrustN / (isp * G0); // ṁ = F / (Isp·g₀)
            const burnTime = propellantMass / massFlowRate; // t = M_prop / ṁ

            // (h) TWR no instante T = 0:  F / (m₀ · g₀)
            const twr = thrustN / (initialMass * G0);

            // (i) Diagnóstico para o estado da missão
            const twrOk = twr > TWR_MIN;
            const go = payloadViable && twrOk;

            // Δv máximo com carga NULA (útil para explicar porque falhou)
            const deltaVMaxEmpty = exhaustVelocity * Math.log((dryMass + propellantMass) / dryMass);
            // TWR com carga nula
            const twrEmpty = thrustN / ((dryMass + propellantMass) * G0);

            return {
                exhaustVelocity,
                requiredMassRatio,
                rawPayload,
                payload,
                payloadViable,
                initialMass,
                finalMass,
                deltaVAvailable,
                deltaVRequired: orbitDeltaV,
                deltaVMaxEmpty,
                massFlowRate,
                burnTime,
                twr,
                twrEmpty,
                twrOk,
                go,
            };
        }

        return { computeMission };
    })();

    /* ========================================================================
       3. MÓDULO DE VALIDAÇÃO
       ======================================================================== */
    const Validation = (function () {
        /** Definição dos campos numéricos: limites realistas e chave no objeto de entrada. */
        const FIELDS = [
            { id: "dry-mass", key: "dryMass", label: "Massa seca", max: 1e8, unit: "kg" },
            { id: "prop-mass", key: "propellantMass", label: "Massa de propelente", max: 1e8, unit: "kg" },
            { id: "thrust", key: "thrustKN", label: "Empuxo", max: 1e6, unit: "kN" },
            { id: "isp", key: "isp", label: "Impulso específico", max: 5000, unit: "s" },
        ];

        /** Valida UM campo; devolve { ok, message, value }. */
        function validateField(field) {
            const el = document.getElementById(field.id);

            // type="number": se o utilizador escrever lixo, o browser expõe badInput
            if (el.validity.badInput) {
                return { ok: false, message: `${field.label}: introduza apenas números.` };
            }
            const raw = el.value.trim();
            if (raw === "") {
                return { ok: false, message: `${field.label}: campo obrigatório.` };
            }
            const value = Number(raw);
            if (!Number.isFinite(value)) {
                return { ok: false, message: `${field.label}: valor numérico inválido.` };
            }
            if (value < 0) {
                return { ok: false, message: `${field.label}: não pode ser negativo.` };
            }
            if (value === 0) {
                return { ok: false, message: `${field.label}: tem de ser superior a zero.` };
            }
            if (value > field.max) {
                return { ok: false, message: `${field.label}: máximo permitido ${fmt0.format(field.max)} ${field.unit}.` };
            }
            return { ok: true, message: "", value };
        }

        /** Aplica o estado visual/ARIA de um campo (borda vermelha + mensagem). */
        function paint(field, result) {
            const el = document.getElementById(field.id);
            const err = document.getElementById("err-" + field.id);
            el.setAttribute("aria-invalid", String(!result.ok));
            err.textContent = result.message;
        }

        /** Valida todos os campos, pinta o estado e devolve { valid, values }. */
        function validateAll() {
            const values = {};
            let valid = true;
            FIELDS.forEach((field) => {
                const res = validateField(field);
                paint(field, res);
                if (res.ok) values[field.key] = res.value;
                else valid = false;
            });
            return { valid, values };
        }

        /**
         * Impede a escrita de caracteres que não fazem sentido para massas/empuxos:
         * sinais (+ / −) e notação científica (e/E). Letras já são bloqueadas pelo
         * próprio input type="number"; a validação acima cobre colar texto.
         */
        function blockInvalidKeys(event) {
            if (["-", "+", "e", "E"].includes(event.key)) event.preventDefault();
        }

        /** Liga a validação em tempo real a todos os campos. */
        function bind(onChange) {
            FIELDS.forEach((field) => {
                const el = document.getElementById(field.id);
                el.addEventListener("keydown", blockInvalidKeys);
                el.addEventListener("input", () => {
                    paint(field, validateField(field));
                    onChange();
                });
            });
        }

        return { FIELDS, validateAll, bind };
    })();

    /* ========================================================================
       4. MÓDULO DE VISTA (DOM)
       ======================================================================== */
    const View = (function () {
        const $ = (id) => document.getElementById(id);
        const rafHandles = new WeakMap();
        let processingTimer = null;

        /** Anima um número de `from` até `to` (ease-out). Respeita "reduced motion". */
        function tweenNumber(el, to, formatter, duration = 700) {
            const from = Number(el.dataset.value || 0);
            el.dataset.value = String(to);
            cancelAnimationFrame(rafHandles.get(el));

            if (prefersReducedMotion || from === to) {
                el.textContent = formatter(to);
                return;
            }
            const t0 = performance.now();
            const step = (now) => {
                const p = Math.min(1, (now - t0) / duration);
                const eased = 1 - Math.pow(1 - p, 3);
                el.textContent = formatter(from + (to - from) * eased);
                if (p < 1) rafHandles.set(el, requestAnimationFrame(step));
            };
            rafHandles.set(el, requestAnimationFrame(step));
        }

        /** Ativa a animação de scanning + ignição durante PROCESSING_MS. */
        function triggerProcessing() {
            const stage = $("blueprint-stage");
            stage.classList.remove("is-processing");
            void stage.offsetWidth; // força reflow para reiniciar as animações CSS
            stage.classList.add("is-processing");
            stage.setAttribute("aria-busy", "true");

            clearTimeout(processingTimer);
            processingTimer = setTimeout(() => {
                stage.classList.remove("is-processing");
                stage.setAttribute("aria-busy", "false");
            }, PROCESSING_MS);
        }

        /* ---------- Blueprint com cotas dinâmicas ---------- */
        const BP = { x: 160, width: 80, top: 110, height: 270, minSeg: 26 };

        /** Cota vertical (parêntese) entre y1 e y2 na posição x. */
        function bracket(x, y1, y2, tick) {
            return `M${x - tick} ${y1} H${x + tick} M${x} ${y1} V${y2} M${x - tick} ${y2} H${x + tick}`;
        }

        function updateBlueprint(values, result) {
            const total = result.initialMass;
            const parts = [
                { id: "payload", mass: result.payload },
                { id: "prop", mass: values.propellantMass },
                { id: "dry", mass: values.dryMass },
            ];

            // Altura proporcional à massa, com mínimo para o texto ser legível
            const free = BP.height - BP.minSeg * parts.length;
            let y = BP.top;
            parts.forEach((part) => {
                const h = BP.minSeg + (part.mass / total) * free;
                const rect = $("bp-" + part.id);
                rect.setAttribute("y", y.toFixed(1));
                rect.setAttribute("height", h.toFixed(1));
                $("bp-dim-" + part.id).setAttribute("d", bracket(262, y + 1, y + h - 1, 4));
                const label = $("bp-text-" + part.id);
                label.setAttribute("y", (y + h / 2 + 4).toFixed(1));
                label.textContent = `${fmt0.format(part.mass)} kg`;
                y += h;
            });

            $("bp-dim-total").setAttribute("d", bracket(124, BP.top, BP.top + BP.height, 4));
            $("bp-text-total").textContent = `M₀ = ${fmt0.format(total)} kg`;
            $("bp-text-thrust").textContent = `F = ${fmt1.format(values.thrustKN)} kN ↑`;

            $("bp-desc").textContent =
                `Carga útil ${fmt0.format(result.payload)} kg, propelente ${fmt0.format(values.propellantMass)} kg, ` +
                `massa seca ${fmt0.format(values.dryMass)} kg; massa total ${fmt0.format(total)} kg.`;
        }

        /**
         * Tenta carregar a imagem do utilizador (data-blueprint-src). Se existir,
         * substitui o SVG de reserva; se não existir, o SVG mantém-se.
         */
        function initBlueprintImage() {
            const stage = $("blueprint-stage");
            const src = stage.dataset.blueprintSrc;
            if (!src) return;
            const probe = new Image();
            probe.onload = () => {
                const img = $("blueprint-image");
                img.src = src;
                img.hidden = false;
                stage.classList.add("has-image");
            };
            probe.src = src; // erro (ficheiro inexistente) → ignorado de propósito
        }

        /* ---------- Resultados ---------- */
        function setStatus(state, badge, reason) {
            $("mission-status").dataset.state = state;
            $("status-badge").textContent = badge;
            $("status-reason").textContent = reason;
        }

        function formatBurn(seconds) {
            const min = Math.floor(seconds / 60);
            const sec = Math.round(seconds - min * 60);
            return min > 0 ? `${fmt1.format(seconds)} (${min} min ${sec} s)` : fmt1.format(seconds);
        }

        function renderResults(values, orbitName, result) {
            // Carga útil em destaque (nunca negativa: já vem forçada a 0)
            tweenNumber($("payload-value"), result.payload, (n) => fmt0.format(n));
            $("payload-sub").textContent = result.payloadViable
                ? `≈ ${fmt2.format(result.payload / 1000)} toneladas para ${orbitName}`
                : `Valor calculado negativo (${fmt0.format(result.rawPayload)} kg) → forçado a 0 kg`;

            // Telemetria
            tweenNumber($("tm-dv-available"), result.deltaVAvailable, (n) => fmt0.format(n));
            $("tm-dv-required").textContent = fmt0.format(result.deltaVRequired);
            $("tm-twr").textContent = fmt2.format(result.twr);
            $("tm-twr").parentElement.className = result.twrOk ? "is-good" : "is-bad";
            $("tm-burn").textContent = formatBurn(result.burnTime);
            $("tm-flow").textContent = fmt1.format(result.massFlowRate);
            $("tm-dv-available").parentElement.className = result.payloadViable ? "is-good" : "is-bad";

            // Estado da missão
            const twrTxt = fmt2.format(result.twr);
            if (result.go) {
                setStatus("go", "GO", `TWR ${twrTxt} > ${fmt2.format(TWR_MIN)} e carga útil viável para ${orbitName}.`);
            } else if (!result.payloadViable) {
                setStatus(
                    "nogo",
                    "NO-GO / FALHA",
                    `Com carga nula só se atingem ${fmt0.format(result.deltaVMaxEmpty)} m/s; ${orbitName} exige ${fmt0.format(result.deltaVRequired)} m/s.`
                );
            } else {
                setStatus("nogo", "NO-GO / FALHA", `TWR ${twrTxt} ≤ ${fmt2.format(TWR_MIN)}: empuxo insuficiente para descolar com esta carga.`);
            }

            // Distribuição de massa (legenda ao lado do gráfico)
            const total = result.initialMass;
            const rows = [
                ["lg-payload", result.payload],
                ["lg-prop", values.propellantMass],
                ["lg-dry", values.dryMass],
            ];
            rows.forEach(([id, mass]) => {
                $(id).textContent = `${fmt0.format(mass)} kg · ${fmt1.format((mass / total) * 100)} %`;
            });
            tweenNumber($("chart-total"), total, (n) => fmt0.format(n));

            $("sr-summary").textContent =
                `Resultado: carga útil ${fmt0.format(result.payload)} quilogramas. Estado da missão: ${result.go ? "GO" : "NO-GO"}. ` +
                `TWR ${twrTxt}. Tempo de queima ${fmt1.format(result.burnTime)} segundos.`;
        }

        /* ---------- Alertas ---------- */
        function hideInlineAlert() {
            const box = $("inline-alert");
            box.hidden = true;
            box.textContent = "";
        }

        /**
         * Mostra o aviso de missão inviável: sempre um alerta inline (fallback robusto)
         * e, se o SweetAlert2 carregou da CDN, um modal elegante depois da animação.
         */
        function showInfeasibleAlert(result, orbitName) {
            const headline = "O empuxo é insuficiente para estas condições orbitais.";
            const detail = !result.payloadViable
                ? `Mesmo sem carga, o Δv máximo é ${fmt0.format(result.deltaVMaxEmpty)} m/s e ${orbitName} exige ${fmt0.format(result.deltaVRequired)} m/s. ` +
                `Aumente o propelente ou o Isp, ou reduza a massa seca.`
                : `O TWR em T=0 é ${fmt2.format(result.twr)} (mínimo ${fmt2.format(TWR_MIN)}). Aumente o empuxo ou reduza a massa.`;

            const box = $("inline-alert");
            box.textContent = `⚠️ ${headline} ${detail}`;
            box.hidden = false;

            if (typeof window.Swal === "undefined") return;
            setTimeout(() => {
                window.Swal.fire({
                    icon: "warning",
                    title: "Missão inviável",
                    html:
                        `<p style="margin:0 0 10px"><strong>${headline}</strong></p>` +
                        `<p style="margin:0;font-size:.9em;opacity:.85">${detail}</p>`,
                    confirmButtonText: "Entendido",
                    confirmButtonColor: "#2563eb",
                    background: "#121826",
                    color: "#e5e7eb",
                    iconColor: "#f97316",
                });
            }, prefersReducedMotion ? 0 : PROCESSING_MS);
        }

        /* ---------- Formulário ---------- */
        function readOrbit() {
            const select = $("orbit");
            return {
                deltaV: Number(select.value),
                name: select.selectedOptions[0].dataset.name,
            };
        }

        function fillForm(preset) {
            $("dry-mass").value = preset.dryMass;
            $("prop-mass").value = preset.propellantMass;
            $("thrust").value = preset.thrustKN;
            $("isp").value = preset.isp;
            $("orbit").value = String(preset.orbitDeltaV);
        }

        return {
            $,
            triggerProcessing,
            updateBlueprint,
            initBlueprintImage,
            renderResults,
            hideInlineAlert,
            showInfeasibleAlert,
            readOrbit,
            fillForm,
        };
    })();

    /* ========================================================================
       5. MÓDULO DO GRÁFICO (Chart.js · Doughnut)
       ======================================================================== */
    const MassChart = (function () {
        let chart = null;

        /** Lê as cores das variáveis CSS → uma única fonte de verdade para o tema. */
        function palette() {
            const css = getComputedStyle(document.getElementById("orion-app"));
            const read = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
            return [read("--c-payload", "#38bdf8"), read("--c-prop", "#f97316"), read("--c-dry", "#64748b")];
        }

        function init() {
            const canvas = document.getElementById("mass-chart");
            if (typeof window.Chart === "undefined") {
                // CDN indisponível: a legenda em texto continua a mostrar os valores
                canvas.parentElement.insertAdjacentHTML(
                    "afterbegin",
                    '<p class="field__error">Gráfico indisponível (Chart.js não carregou).</p>'
                );
                return;
            }

            window.Chart.defaults.font.family = '"Inter", system-ui, sans-serif';
            window.Chart.defaults.color = "#94a3b8";

            chart = new window.Chart(canvas, {
                type: "doughnut",
                data: {
                    labels: ["Carga útil", "Propelente", "Massa seca"],
                    datasets: [
                        {
                            data: [0, 0, 0],
                            backgroundColor: palette(),
                            borderColor: "#121826",
                            borderWidth: 3,
                            hoverOffset: 8,
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false, // o contentor CSS (aspect-ratio 1/1) controla a proporção
                    cutout: "68%",
                    // Animação de carregamento ativada: rotação + escala
                    animation: { animateRotate: true, animateScale: true, duration: 1100, easing: "easeOutQuart" },
                    plugins: {
                        legend: { display: false }, // legenda própria em HTML (acessível)
                        tooltip: {
                            callbacks: {
                                label(ctx) {
                                    const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                                    const pct = total > 0 ? (ctx.parsed / total) * 100 : 0;
                                    return ` ${ctx.label}: ${fmt0.format(ctx.parsed)} kg (${fmt1.format(pct)} %)`;
                                },
                            },
                        },
                    },
                },
            });
        }

        /** Atualiza os dados e re-dispara a animação de rotação. */
        function update(payload, propellant, dry) {
            if (!chart) return;
            chart.data.datasets[0].data = [payload, propellant, dry];
            if (!prefersReducedMotion) chart.reset();
            chart.update();

            const total = payload + propellant + dry;
            const pct = (v) => fmt1.format((v / total) * 100);
            document
                .getElementById("mass-chart")
                .setAttribute(
                    "aria-label",
                    `Distribuição da massa total: carga útil ${pct(payload)} %, propelente ${pct(propellant)} %, massa seca ${pct(dry)} %.`
                );
        }

        return { init, update };
    })();

    /* ========================================================================
       6. CONTROLADOR
       ======================================================================== */
    const App = (function () {
        const { $ } = View;

        /** Corre a simulação completa com os valores atuais do formulário. */
        function calculate({ animate = true } = {}) {
            const { valid, values } = Validation.validateAll();
            if (!valid) {
                const firstBad = document.querySelector('.orion-app input[aria-invalid="true"]');
                if (firstBad) firstBad.focus();
                return;
            }

            const orbit = View.readOrbit();
            const result = Physics.computeMission({ ...values, orbitDeltaV: orbit.deltaV });

            if (animate) View.triggerProcessing();
            View.hideInlineAlert();
            View.renderResults(values, orbit.name, result);
            View.updateBlueprint(values, result);
            MassChart.update(result.payload, values.propellantMass, values.dryMass);

            if (!result.go) View.showInfeasibleAlert(result, orbit.name);
        }

        function syncButtonState() {
            // Botão desativado enquanto existir qualquer campo inválido
            const anyInvalid = Validation.FIELDS.some((f) => $(f.id).getAttribute("aria-invalid") === "true");
            $("calc-btn").disabled = anyInvalid;
        }

        function loadPreset(preset) {
            View.fillForm(preset);
            Validation.validateAll();
            syncButtonState();
            calculate();
        }

        /** Pré-visualização inicial (sem animação nem alertas): mostra a massa dos dados oficiais. */
        function renderIdlePreview() {
            const { values } = Validation.validateAll();
            const total = values.dryMass + values.propellantMass;
            View.updateBlueprint(values, {
                payload: 0,
                initialMass: total,
            });
            MassChart.update(0, values.propellantMass, values.dryMass);
            ["lg-payload", "lg-prop", "lg-dry"].forEach((id, i) => {
                const mass = [0, values.propellantMass, values.dryMass][i];
                $(id).textContent = `${fmt0.format(mass)} kg · ${fmt1.format((mass / total) * 100)} %`;
            });
            $("chart-total").textContent = fmt0.format(total);
        }

        function init() {
            MassChart.init();
            View.initBlueprintImage();

            // Enter ou clique em "Calculate" → submit
            $("params-form").addEventListener("submit", (event) => {
                event.preventDefault();
                calculate();
            });

            // Validação em tempo real
            Validation.bind(syncButtonState);

            // Mudar a órbita recalcula logo (sem animação de ignição) se já houver resultado
            $("orbit").addEventListener("change", () => {
                if ($("payload-value").textContent !== "—") calculate({ animate: false });
            });

            $("reset-btn").addEventListener("click", () => loadPreset(ORION_OFFICIAL));
            $("demo-btn").addEventListener("click", () => loadPreset(DEMO_SCENARIO));

            renderIdlePreview();
        }

        return { init };
    })();

    /* Arranque quando o DOM está pronto */
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", App.init);
    } else {
        App.init();
    }
})();