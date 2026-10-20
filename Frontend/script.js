const NODOS = [
    {
        id: 'NODE-01',
        name: 'Sirena y Baliza Termas de Copahue',
        location: 'Sector Norte',
        state: 'active',
        icon: 'fa-bullhorn',
        desc: 'Sirena acústica de evacuación y baliza estroboscópica'
    },
    {
        id: 'NODE-02',
        name: 'Sensor de gases cráter el agrio',
        location: 'Cráter Volcán Copahue',
        state: 'active',
        icon: 'fa-volcano',
        desc: 'Sensor óptico DOAS'
    },
    {
        id: 'NODE-03',
        name: 'Sismógrafo SEGEMAR / OVDAS',
        location: 'Flanco Este',
        state: 'active',
        icon: 'fa-chart-simple',
        desc: 'Estación sismológica triaxial de banda ancha'
    },
    {
        id: 'NODE-04',
        name: 'Repetidora Cerro Mellizo & Kit Solar',
        location: 'Cerro Mellizo',
        state: 'active',
        icon: 'fa-solar-panel',
        desc: 'Enlace de telemetría VHF/LoRa con batería al 98%'
    },
    {
        id: 'NODE-05',
        name: 'Estación Meteorológica Caviahue',
        location: 'Villa Caviahue',
        state: 'offline',
        icon: 'fa-wind',
        desc: 'Anemómetro y sensor de dirección de viento y ceniza'
    },
    {
        id: 'NODE-06',
        name: 'Sensor Térmico Laguna Cráter',
        location: 'Laguna Ácida',
        state: 'error',
        icon: 'fa-triangle-exclamation',
        desc: 'Falla de enlace por corrosión de gases fumarólicos'
    }
];

// API del Grupo 5. Si el frontend es servido por el backend, se usa el mismo origen.
// Si se usa Live Server (puerto 5500/5501), consulta localhost:5000.
const API = window.location.port === '5000' ? window.location.origin : 'http://localhost:5000';
// Solo para pruebas locales: en producción NUNCA incluir secretos en JavaScript del navegador.
const API_KEY = ''; // Coincide con Seguridad:ApiKey vacía en appsettings.json de esta demo.
const HEADERS_API = API_KEY ? { 'X-API-Key': API_KEY } : {};
const ESTADO_WEB = { active: 'Pendiente', active_confirmed: 'Confirmado', resolved: 'Atendido' };
let alertsData = [];
let apiConectada = false;

function escapeHTML(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function alertaDesdeAPI(reg, eventosPorId, confirmados) {
    const d = reg.data || {};
    const origenId = (d.related_record_ids || [])[0];
    const origen = eventosPorId[origenId];
    const estado = d.alert_status === 'active' && confirmados.has(d.alert_id) ? 'active_confirmed' : d.alert_status;
    return {
        id: String(d.alert_id || reg.record_id),
        time: new Date(reg.timestamp).toLocaleTimeString('es-AR', { hour12: false }),
        isoDate: reg.timestamp,
        title: d.message || 'Alerta sin descripción',
        source: origen?.subsystem || reg.subsystem || 'Grupo 5',
        origin_type: reg.metadata?.source_type || 'simulated',
        level: reg.alert_level,
        status: ESTADO_WEB[estado] || 'Pendiente',
        channels: d.channels || [],
        metadata: {
            alert_evaluated: reg.metadata?.alert_evaluated,
            node_id: origen?.node_id || reg.node_id,
            trace_id: origenId || reg.record_id
        }
    };
}
async function apiFetch(path, options = {}) {
    const r = await fetch(`${API}${path}`, {
        ...options,
        headers: { ...HEADERS_API, ...(options.headers || {}) },
        cache: 'no-store'
    });
    if (!r.ok) {
        const detail = await r.text();
        throw new Error(`HTTP ${r.status} en ${path}: ${detail.slice(0, 250)}`);
    }
    return r.json();
}
async function cargarAlertasDesdeAPI() {
    const [alertas, eventos, registros] = await Promise.all([
        apiFetch('/api/v1/alerts'),
        apiFetch('/api/eventos'),
        apiFetch('/api/v1/records?limit=200')
    ]);
    const eventosPorId = {};
    for (const e of (eventos.items || [])) eventosPorId[e.record_id] = e;
    const confirmados = new Set();
    for (const reg of (registros.items || [])) {
        if (reg.record_type === 'confirmation' && reg.data?.confirmation_type === 'device_execution' && reg.data?.result === 'success') {
            confirmados.add(reg.data.alert_id);
        }
    }
    const ultimos = new Map();
    for (const reg of (alertas.items || [])) {
        const id = reg.data?.alert_id;
        if (!id) continue;
        const previo = ultimos.get(id);
        if (!previo || new Date(reg.timestamp) >= new Date(previo.timestamp)) ultimos.set(id, reg);
    }
    return [...ultimos.values()]
        .map(reg => alertaDesdeAPI(reg, eventosPorId, confirmados))
        .sort((a, b) => new Date(b.isoDate) - new Date(a.isoDate));
}
function mostrarEstadoConexion(ok, mensaje) {
    const el = document.getElementById('api-connection-status');
    if (el) { el.textContent = mensaje; el.style.color = ok ? '#15803d' : '#dc2626'; }
}
async function refrescarAlertas() {
    try {
        alertsData = await cargarAlertasDesdeAPI();
        apiConectada = true;
        mostrarEstadoConexion(true, '● API conectada · actualización automática');
    } catch (e) {
        apiConectada = false;
        console.error('No se pudo conectar con la API:', e);
        mostrarEstadoConexion(false, '● API desconectada · revisá el backend (puerto 5000)');
        // No muestra datos ficticios como si fueran reales. Conserva solo las lecturas previas.
    }
    updateKPIs();
    renderPriorityAlertsUI();
    renderHistoryTableUI();
    await refrescarEstadoESP32();
}
async function refrescarEstadoESP32() {
    const el = document.getElementById('esp32-status');
    if (!el) return;
    try {
        const r = await apiFetch('/api/v1/status');
        const estado = r.items?.[0];
        const online = estado?.status === 'active';
        el.textContent = online ? 'ESP32 conectado' : 'ESP32 desconectado';
        el.style.color = online ? '#15803d' : '#dc2626';
    } catch {
        el.textContent = 'Estado ESP32 no disponible';
        el.style.color = '#dc2626';
    }
}

function normalizeLevel(level) {
    const l = String(level ?? "").trim().toLowerCase();
    if (l === 'crítico' || l === 'critico' || l === 'critical') return 'critical';
    if (l === 'alto' || l === 'high') return 'high';
    if (l === 'medio' || l === 'medium') return 'medium';
    if (l === 'bajo' || l === 'low') return 'low';
    return 'normal';
}

function renderRiskBadgeHTML(level, isEvaluated = true) {
    const norm = normalizeLevel(level);
    let iconClass = 'fa-circle-check';
    let text = 'Normal';
    let riskClass = 'risk-normal';

    switch (norm) {
        case 'critical':
            iconClass = 'fa-radiation';
            text = 'Crítico';
            riskClass = 'risk-critical';
            break;
        case 'high':
            iconClass = 'fa-circle-exclamation';
            text = 'Alto';
            riskClass = 'risk-high';
            break;
        case 'medium':
            iconClass = 'fa-triangle-exclamation';
            text = 'Medio';
            riskClass = 'risk-medium';
            break;
        case 'low':
            iconClass = 'fa-circle-info';
            text = 'Bajo';
            riskClass = 'risk-low';
            break;
        default:
            iconClass = 'fa-circle-check';
            text = 'Normal';
            riskClass = 'risk-normal';
    }

    let html = `<span class="badge-risk ${riskClass}"><i class="fa-solid ${iconClass}"></i> ${text}</span>`;
    if (isEvaluated === false) {
        html += `<div class="badge-unevaluated"><i class="fa-solid fa-triangle-exclamation"></i> Riesgo no evaluado</div>`;
    }
    return html;
}

function renderOriginBadgeHTML(originType) {
    const type = String(originType || 'simulated').toLowerCase();
    if (type === 'real') {
        return `<span class="badge-origin real"><i class="fa-solid fa-satellite-dish"></i> Real</span>`;
    }
    if (type === 'test') {
        return `<span class="badge-origin test"><i class="fa-solid fa-vial"></i> Test</span>`;
    }
    return `<span class="badge-origin simulated"><i class="fa-solid fa-flask"></i> Simulado</span>`;
}

function renderChannelsHTML(channels) {
    if (!Array.isArray(channels) || channels.length === 0) {
        return `<span class="channel-tag"><i class="fa-solid fa-bell"></i> Canal estándar</span>`;
    }
    return `
        <div class="channels-list">
            ${channels.map(ch => {
        let icon = 'fa-bullhorn';
        const lower = ch.toLowerCase();
        if (lower.includes('baliza') || lower.includes('luz')) icon = 'fa-lightbulb';
        else if (lower.includes('radio') || lower.includes('vhf')) icon = 'fa-tower-broadcast';
        else if (lower.includes('sms') || lower.includes('push') || lower.includes('cel')) icon = 'fa-mobile-screen';
        else if (lower.includes('segemar') || lower.includes('defensa') || lower.includes('red')) icon = 'fa-shield-halved';
        return `<span class="channel-tag"><i class="fa-solid ${icon}"></i> ${escapeHTML(ch)}</span>`;
    }).join('')}
        </div>
    `;
}

// Renderiza los Nodos de Telemetría (Panel index.html)
function renderNodesUI() {
    const nodesContainer = document.getElementById('nodes-container');
    if (!nodesContainer) return;

    nodesContainer.innerHTML = NODOS.map(node => {
        let stateText = 'Activo';
        if (node.state === 'offline') stateText = 'Desconectado';
        else if (node.state === 'error') stateText = 'Falla';

        return `
            <div class="node-card">
                <div class="node-info">
                    <div class="node-icon">
                        <i class="fa-solid ${node.icon}"></i>
                    </div>
                    <div>
                        <div class="node-title">${node.name}</div>
                        <div class="node-subtitle">${node.location}</div>
                    </div>
                </div>
                <span class="node-state ${node.state}">${stateText}</span>
            </div>
        `;
    }).join('');
}

// Renderiza las Alertas Prioritarias 
function renderPriorityAlertsUI() {
    const priorityContainer = document.getElementById('priority-alerts-container');
    if (!priorityContainer) return;

    const priorityItems = alertsData.filter(a => {
        const norm = normalizeLevel(a.level);
        return (norm === 'high' || norm === 'critical') && a.status !== 'Atendido';
    });

    if (priorityItems.length === 0) {
        priorityContainer.innerHTML = `
            <div style="grid-column: 1 / -1; padding: 22px; text-align: center; color: var(--text-muted); background: var(--bg-subtle); border-radius: var(--radius-md);">
                <i class="fa-solid fa-circle-check" style="color: var(--accent-green); font-size: 1.6rem; margin-bottom: 8px; display: block;"></i>
                No hay alertas prioritarias activas en este momento.
            </div>
        `;
        return;
    }

    priorityContainer.innerHTML = priorityItems.map(item => {
        const norm = normalizeLevel(item.level);
        const isEval = item.metadata?.alert_evaluated !== false;
        const cleanTitle = String(item.title || '')
            .replace(/\[SIMULACI[ÓO]N\]\s*/gi, '')
            .replace(/>\s*3000\s*m/gi, '')
            .trim();

        return `
            <div class="priority-card ${norm}">
                <div class="priority-card-top">
                    ${renderRiskBadgeHTML(item.level, isEval)}
                    ${renderOriginBadgeHTML(item.origin_type)}
                </div>
                <h3>${escapeHTML(cleanTitle)}</h3>
                <div class="priority-card-meta">
                    <span><i class="fa-solid fa-location-dot"></i> ${escapeHTML(item.source)}</span>
                    <span><i class="fa-solid fa-clock"></i> ${item.time}</span>
                </div>
                <div>
                    <strong style="font-size: 0.72rem; text-transform: uppercase; color: var(--text-muted);">Canales de Difusión:</strong>
                    ${renderChannelsHTML(item.channels)}
                </div>
                <div class="priority-card-actions">
                    <span style="font-size: 0.76rem; font-weight: 600; color: var(--text-secondary);">
                        Estado: <strong>${item.status}</strong>
                    </span>
                    <button class="btn-action-sm" title="Confirmar / Atender alerta" onclick="toggleStatus('${escapeHTML(item.id)}')">
                        <i class="fa-solid fa-check"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// Actualiza el contador de alertas activas
function updateKPIs() {
    const kpiActiveAlerts = document.getElementById('kpi-active-alerts');
    if (!kpiActiveAlerts) return;

    const activeCount = alertsData.filter(a => a.status !== 'Atendido').length;
    kpiActiveAlerts.textContent = activeCount;
}

// Renderiza la tabla completa
function renderHistoryTableUI() {
    const tableBody = document.getElementById('alerts-table-body');
    if (!tableBody) return;

    tableBody.innerHTML = '';
    alertsData.forEach((alert) => {
        const isEval = alert.metadata?.alert_evaluated !== false;
        const isoString = alert.isoDate || new Date().toISOString();
        const traceId = alert.metadata?.trace_id || `TRC-${String(alert.id).padStart(3, '0')}`;
        const cleanTitle = String(alert.title || '')
            .replace(/\[SIMULACI[ÓO]N\]\s*/gi, '')
            .replace(/>\s*3000\s*m/gi, '')
            .trim();

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <span class="iso-timestamp">#${escapeHTML(alert.id)}</span>
                <span class="iso-sub">${escapeHTML(traceId)}</span>
            </td>
            <td>
                <span class="iso-timestamp">${isoString.replace('T', ' ').substring(0, 19)}</span>
                <span class="iso-sub">${alert.time}</span>
            </td>
            <td>
                <strong>${escapeHTML(cleanTitle)}</strong>
                ${renderChannelsHTML(alert.channels)}
            </td>
            <td>
                <div>${escapeHTML(alert.source)}</div>
                <div style="margin-top: 4px;">${renderOriginBadgeHTML(alert.origin_type)}</div>
            </td>
            <td>
                ${renderRiskBadgeHTML(alert.level, isEval)}
            </td>
            <td>
                <span style="font-weight: 600;">${alert.status}</span>
            </td>
            <td>
                <button class="btn-action-sm" title="Cambiar estado" onclick="toggleStatus('${escapeHTML(alert.id)}')">
                    <i class="fa-solid fa-check"></i>
                </button>
            </td>
        `;
        tableBody.appendChild(tr);
    });
}

// Resolver en servidor: ya NO modificamos el estado solo en localStorage.
window.toggleStatus = async function (id) {
    const alerta = alertsData.find(a => a.id === String(id));
    if (!alerta || alerta.status === 'Atendido') return;
    if (!confirm(`¿Resolver la alerta ${id} en el backend y apagar la alarma asociada si corresponde?`)) return;
    try {
        await apiFetch(`/api/v1/alerts/${encodeURIComponent(id)}/resolve`, { method: 'POST' });
        await refrescarAlertas();
    } catch (e) {
        console.error(e);
        alert(`No se pudo resolver la alerta: ${e.message}`);
    }
};

// El backend no tiene endpoint para borrar el historial: recargar en lugar de borrar datos solo visuales.
const btnClear = document.getElementById('btn-clear');
if (btnClear) btnClear.addEventListener('click', refrescarAlertas);

// Inicialización del Mapa Satelital de Copahue
function initMapIfPresent() {
    const mapContainer = document.getElementById('copahue-map');
    if (!mapContainer || typeof L === 'undefined') return;

    const copahueCenter = [-37.855, -71.115];
    const map = L.map('copahue-map', {
        zoomControl: true,
        scrollWheelZoom: true
    }).setView(copahueCenter, 11);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 18
    }).addTo(map);

    const puntos = [
        { nombre: 'Cráter principal volcán Copahue', coords: [-37.859, -71.171], desc: 'Cráter activo El Agrio. Monitoreo de fumarolas y gases SO2.', estado: 'Alerta Amarilla' },
        { nombre: 'Termas de Copahue - Sirena norte', coords: [-37.820, -71.095], desc: 'Sirena acústica de evacuación y baliza sector norte.', estado: 'Activo' },
        { nombre: 'Villa Caviahue - Centro operativo', coords: [-37.880, -71.055], desc: 'Población urbana, centro de evacuación y red comunitaria.', estado: 'Normal' },
        { nombre: 'Estación sísmica OVDAS / SEGEMAR', coords: [-37.865, -71.135], desc: 'Sismógrafo triaxial de banda ancha.', estado: 'Operando' },
        { nombre: 'Repetidora cerro mellizo y kit solar', coords: [-37.842, -71.080], desc: 'Enlace de comunicaciones VHF/LoRa y panel fotovoltaico.', estado: 'Batería 98%' }
    ];

    puntos.forEach(p => {
        L.marker(p.coords).addTo(map)
            .bindPopup(`
                <div style="font-family: inherit;">
                    <strong style="color: #1C382B; font-size: 0.95rem;">${p.nombre}</strong><br>
                    <span style="color: #4A5B51; font-size: 0.85rem;">${p.desc}</span><br>
                    <div style="margin-top: 6px; font-size: 0.78rem; font-weight: 700; color: #15803D;">● ${p.estado}</div>
                </div>
            `);
    });
}
renderNodesUI();
renderPriorityAlertsUI();
updateKPIs();
renderHistoryTableUI();
initMapIfPresent();
refrescarAlertas();
setInterval(refrescarAlertas, 5000);