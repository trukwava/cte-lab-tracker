"use strict";
const app = document.getElementById('app');
let currentView = 'today';
let role = '';
let actor = '';
let authMode = 'demo';
let dashboard = {}, assets = [], loans = [], maintenance = [], requests = [], audit = [], locations = [], borrowers = [], vendors = [];
let lastLoadedAt = '', stale = false;
let selectedAsset = null, assetSearch = '', assetStatus = '', assetCategory = '', modalKind = '', importBatch = null, toastTimer = 0, working = false;
const CATEGORIES = ['Power Tools', 'Hand Tools', 'Measuring', 'Safety', 'Stationary', 'Accessories'];
const ICONS = { today: '◫', assets: '▦', loans: '⇄', maintenance: '⚙', requests: '▤', import: '⇧', audit: '☰' };
const LABELS = { today: 'Today', assets: 'Asset library', loans: 'Loans', maintenance: 'Maintenance', requests: 'Purchase drafts', import: 'Import assets', audit: 'Activity log' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
const fmtDate = (v) => v ? new Date(v + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'Not scheduled';
const fmtTime = (v) => v ? new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const statusLabel = (s) => ({ available: 'Available', on_loan: 'On loan', missing: 'Missing', quarantined: 'Quarantined', inspection_required: 'Inspect first', in_service: 'In service' }[s] || s);
const badge = (s) => `<span class="pill ${esc(s)}"><i></i>${esc(statusLabel(s))}</span>`;
const isInstructor = () => role === 'instructor';
const canAct = () => role === 'instructor' || role === 'staff';
function notify(message, error = false) { const el = document.getElementById('toast'); if (!el)
    return; el.textContent = message; el.className = 'toast visible' + (error ? ' bad' : ''); window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => el.className = 'toast', 4100); }
async function api(path, options = {}) { const resp = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } }); let d; try {
    d = await resp.json();
}
catch {
    throw new Error('Unexpected server response');
} if (!resp.ok)
    throw new Error(d.error || 'Request failed'); return d; }
async function post(path, body = {}) { return api(path, { method: 'POST', body: JSON.stringify(body) }); }
async function loadAll() { const [d, a, l, m, r, au, lo, bo, ve] = await Promise.all(['/api/dashboard', '/api/assets', '/api/loans', '/api/maintenance', '/api/requests', '/api/audit', '/api/locations', '/api/borrowers', '/api/vendors'].map(p => api(p))); dashboard = d; lastLoadedAt = new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); stale = false; assets = a; loans = l; maintenance = m; requests = r; audit = au; locations = lo; borrowers = bo; vendors = ve; }
function nav() { return `<aside class="sidebar"><div class="brand"><div class="brand-logo">R<span>•</span></div><div><div class="brand-name">Riverton</div><div class="brand-sub">LAB OPERATIONS</div></div></div><div class="lab-select"><span class="lab-symbol">⌂</span><div><strong>Carpentry lab</strong><small>Technical school · ${authMode === 'demo' ? 'Demo' : 'Local pilot'}</small></div><span class="chev">⌄</span></div><div class="side-label">WORKSPACE</div><nav aria-label="Workspace navigation">${['today', 'assets', 'loans', 'maintenance', 'requests', 'import', 'audit'].map(v => `<button type="button" class="nav-item ${currentView === v ? 'active' : ''}" data-view="${v}"><span class="nav-icon">${ICONS[v]}</span>${LABELS[v]}${v === 'today' && dashboard.overdueCount ? `<span class="nav-count">${dashboard.overdueCount}</span>` : ''}</button>`).join('')}</nav><div class="side-bottom"><div class="side-hint"><span class="safe-dot"></span> ${authMode === 'demo' ? 'LOCAL DEMO' : 'LOCAL PILOT'} <small>Synthetic records · No live systems</small></div>${isInstructor() && authMode === 'demo' ? `<button class="reset-link" data-action="reset-demo">↻ Reset synthetic demo records</button>` : ''}<button class="profile" data-action="logout"><span class="avatar">${esc(authMode === 'demo' ? (actor === 'DEMO-INSTRUCTOR' ? 'IN' : actor === 'DEMO-STAFF' ? 'ST' : 'VW') : actor.slice(0, 2).toUpperCase())}</span><span><strong>${esc(authMode === 'demo' ? (role === 'instructor' ? 'Demo Instructor' : role === 'staff' ? 'Demo Staff' : 'Demo Viewer') : actor + ' · ' + role)}</strong><small>${authMode === 'demo' ? 'Switch demo role' : 'Sign out'}</small></span><span>⇥</span></button></div></aside>`; }
function topbar(title, desc, actions = '') { return `<div class="header-row"><div><div class="crumb">RIVERTON / CARPENTRY LAB <span>/ ${esc(title.toUpperCase())}</span></div><h1>${esc(title)}</h1><p class="subtitle">${esc(desc)}</p></div><div class="header-actions">${actions}<span class="sync-time" title="This is a snapshot; refresh after other staff make changes">${stale ? 'Snapshot may be stale' : 'Updated ' + lastLoadedAt}</span>${btn('↻ Refresh', 'refresh', 'secondary')}</div></div>`; }
function btn(txt, action, variant = 'primary', extras = '') { return `<button type="button" class="btn ${variant}" data-action="${action}" ${extras}>${txt}</button>`; }
function cardTitle(title, note, action = '') { return `<div class="section-heading"><div><h2>${title}</h2><p>${note}</p></div>${action}</div>`; }
function tableHead(cols) { return `<thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>`; }
function assetLink(a) { return `<button type="button" class="text-link" data-asset="${esc(a.asset_id || a.id)}">${esc(a.tag)}</button>`; }
function todayView() {
    return `${topbar('Today', 'The equipment decisions that need attention first.', canAct() ? btn('＋ Add asset', 'new-asset', 'secondary') + btn('⇄ Issue tool', 'quick-checkout') : '')}
<div class="notice"><div class="notice-symbol">ⓘ</div><div><strong>Local demonstration workspace</strong><span>Fictional staff, tools and vendors. Records here do not certify equipment safety or authorize purchasing.</span></div><span class="notice-tag">DEMO DATA</span></div>
<div class="stats"><button class="stat" data-view="loans"><div class="stat-top"><span>Overdue loans</span><span class="stat-icon red">↗</span></div><strong>${dashboard.overdueCount || 0}</strong><small>Return follow-up required <span>↗</span></small></button><button class="stat" data-view="maintenance"><div class="stat-top"><span>Maintenance due</span><span class="stat-icon amber">◷</span></div><strong>${dashboard.maintenanceDueCount || 0}</strong><small>Based on scheduled date <span>↗</span></small></button><button class="stat" data-view="assets"><div class="stat-top"><span>Blocked equipment</span><span class="stat-icon violet">⊘</span></div><strong>${(dashboard.quarantinedCount || 0) + (dashboard.missingCount || 0) + ((dashboard.blocked || []).filter((a) => a.status === 'in_service').length)}</strong><small>Missing / inspect / service <span>↗</span></small></button><button class="stat" data-view="assets"><div class="stat-top"><span>Available assets</span><span class="stat-icon green">✓</span></div><strong>${dashboard.availableCount || 0}<span class="stat-outof"> / ${dashboard.assets || 0}</span></strong><small>Individual tools tracked <span>↗</span></small></button></div>
<div class="two-col"><section class="panel">${cardTitle('Overdue checkouts', 'Active loans past the recorded due instant.', `<span class="little-count">${dashboard.overdueCount || 0} items</span>`)}${(dashboard.overdue || []).length ? `<div class="table-wrap"><table>${tableHead(['Asset', 'Borrower', 'Due', ''])}<tbody>${dashboard.overdue.map((l) => `<tr><td><div class="table-main">${assetLink(l)}<small>${esc(l.make_model)}</small></div></td><td><span class="code">${esc(l.borrower_code)}</span></td><td><span class="overdue-date">${fmtTime(l.due_at)}</span></td><td>${canAct() ? `<button class="mini-btn" data-action="return" data-id="${l.asset_id}">Return ↗</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('All loans are within their due window.')}</section>
<section class="panel">${cardTitle('Maintenance queue', 'Date-driven reviews. Usage hours are not inferred.', `<span class="little-count">${dashboard.maintenanceDueCount || 0} due</span>`)}${(dashboard.maintenance || []).length ? `<div class="queue">${dashboard.maintenance.slice(0, 7).map((a) => `<div class="queue-item"><div class="queue-icon">⚙</div><div><strong>${assetLink(a)} · ${esc(a.make_model)}</strong><small>Due ${fmtDate(a.next_due_date)} · ${a.interval_days}-day policy</small></div>${isInstructor() ? `<button class="mini-btn" data-action="service" data-id="${a.id}">Record service</button>` : ''}</div>`).join('')}</div>` : empty('No maintenance reviews due.')}</section></div>
<div class="two-col lower"><section class="panel">${cardTitle('Needs resolution', 'Assets blocked from checkout and their current disposition.')}${(dashboard.blocked || []).length ? `<div class="queue">${dashboard.blocked.slice(0, 8).map((a) => `<div class="queue-item"><div class="queue-icon ${a.status === 'missing' ? 'red' : ''}">${a.status === 'missing' ? '?' : '!'}</div><div><strong>${assetLink(a)} · ${esc(a.make_model)}</strong><small>${esc(a.current_location || 'Location unconfirmed')}</small></div>${badge(a.status)}</div>`).join('')}</div>` : empty('No blocked assets.')}</section><section class="panel">${cardTitle('Recent decisions', 'A short trail of attributed operational changes.')}${audit.length ? `<div class="timeline">${audit.slice(0, 6).map(a => `<div class="event"><div class="event-line"></div><strong>${esc(a.action.replaceAll('_', ' '))}</strong><span>${esc(a.entity_id)} · ${esc(a.actor)}</span><small>${fmtTime(a.created_at)}</small></div>`).join('')}</div>` : empty('No decisions recorded yet.')}</section></div>`;
}
function assetView() {
    let filtered = assets.filter(a => (!assetStatus || a.status === assetStatus) && (!assetCategory || a.category === assetCategory) && (!assetSearch || [a.tag, a.make_model, a.category, a.serial_ref, a.home_location].some((v) => String(v || '').toLowerCase().includes(assetSearch.toLowerCase()))));
    return `${topbar('Asset library', 'Track where every serialized tool is and what action it needs.', (canAct() ? btn('＋ Add asset', 'new-asset') : '') + btn('⇩ Export CSV', 'export-assets', 'secondary'))}
<section class="panel table-panel"><div class="toolbar"><label class="search-wrap"><span>⌕</span><input id="asset-search" aria-label="Search assets" placeholder="Search by tag, model, category or serial…" value="${esc(assetSearch)}"></label><select id="asset-status" aria-label="Filter by status"><option value="">All statuses</option>${['available', 'on_loan', 'missing', 'quarantined', 'inspection_required', 'in_service'].map(v => `<option value="${v}" ${assetStatus === v ? 'selected' : ''}>${statusLabel(v)}</option>`).join('')}</select><select id="asset-category" aria-label="Filter by category"><option value="">All categories</option>${CATEGORIES.map(v => `<option ${assetCategory === v ? 'selected' : ''}>${v}</option>`).join('')}</select><button class="btn secondary" data-action="print-labels">▦ Print QR labels</button></div><div class="table-meta">${filtered.length} of ${assets.length} assets · Individually tracked</div>${filtered.length ? `<div class="table-wrap"><table class="assets-table">${tableHead(['Asset / model', 'Category', 'Location', 'Condition', 'Availability', 'Next review', ''])}<tbody>${filtered.map(a => `<tr><td><div class="table-main">${assetLink(a)}<small>${esc(a.make_model)}</small></div></td><td>${esc(a.category)}</td><td>${esc(a.current_location || 'Unconfirmed')}</td><td class="capitalize">${esc(a.condition)}</td><td>${badge(a.status)}</td><td>${fmtDate(a.next_due_date)}</td><td><button class="row-more" aria-label="View asset ${esc(a.tag)}" data-asset="${esc(a.id)}">›</button></td></tr>`).join('')}</tbody></table></div>` : empty('No assets match the current search or filters.')}</section>`;
}
function loanView() {
    return `${topbar('Loan register', 'Every issued tool has one accountable, time-bounded checkout.', canAct() ? btn('＋ Check out', 'quick-checkout') : '')}
<section class="panel table-panel">${cardTitle('Checkout history', 'Active and returned loan events, newest first.')}${loans.length ? `<div class="table-wrap"><table>${tableHead(['Asset', 'Borrower', 'Issued', 'Due', 'Returned', 'Status', ''])}<tbody>${loans.map(l => `<tr><td>${assetLink(l)}</td><td class="code">${esc(l.borrower_code)}</td><td>${fmtTime(l.issued_at)}</td><td>${fmtTime(l.due_at)}</td><td>${fmtTime(l.returned_at)}</td><td>${l.returned_at ? '<span class="muted">Returned</span>' : l.due_at < new Date().toISOString() ? '<span class="overdue-date">Overdue</span>' : badge('on_loan')}</td><td>${canAct() && !l.returned_at ? `<button class="mini-btn" data-action="return" data-id="${l.asset_id}">Return</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('No loans recorded.')}</section>`;
}
function maintenanceView() {
    const due = assets.filter(a => a.next_due_date && a.next_due_date <= new Date().toISOString().slice(0, 10));
    return `${topbar('Maintenance', 'Record service separately from any instructor decision to release equipment.')}
<div class="notice warn"><div class="notice-symbol">⚠</div><div><strong>Maintenance is not a safety certification</strong><span>Next-review dates are calculated from recorded service dates and versioned interval policies. No usage-hour sensor is connected.</span></div></div>
<section class="panel table-panel">${cardTitle('Scheduled reviews', `${due.length} assets with a review date today or earlier.`)}${due.length ? `<div class="table-wrap"><table>${tableHead(['Asset', 'Model', 'Interval', 'Due date', 'Status', ''])}<tbody>${due.map(a => `<tr><td>${assetLink(a)}</td><td>${esc(a.make_model)}</td><td>${a.interval_days} days · v${a.plan_version}</td><td><span class="overdue-date">${fmtDate(a.next_due_date)}</span></td><td>${badge(a.status)}</td><td>${isInstructor() ? `<button class="mini-btn" data-action="service" data-id="${a.id}">Record service</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('No due reviews recorded.')}</section><section class="panel table-panel second-panel">${cardTitle('Service history', 'Attribution, policy version and future review date are retained.')}${maintenance.length ? `<div class="table-wrap"><table>${tableHead(['Asset', 'Service date', 'Plan used', 'Next review', 'Reference', 'Recorded by'])}<tbody>${maintenance.map(m => `<tr><td>${assetLink(m)}</td><td>${fmtDate(m.serviced_date)}</td><td>v${m.plan_version}</td><td>${fmtDate(m.next_due_date)}</td><td>${esc(m.reference || '—')}</td><td class="code">${esc(m.actor)}</td></tr>`).join('')}</tbody></table></div>` : empty('No service events.')}</section>`;
}
function requestsView() {
    return `${topbar('Purchase drafts', 'Prepare a reviewable request. No orders or procurement approvals are issued.', isInstructor() ? btn('＋ New draft', 'new-request') + btn('⇩ Export CSV', 'export-requests', 'secondary') : btn('⇩ Export CSV', 'export-requests', 'secondary'))}
<div class="notice"><div class="notice-symbol">ⓘ</div><div><strong>Reference-only vendor catalog</strong><span>Estimates and vendor references are curated placeholders. Availability and purchasing authorization have not been verified.</span></div></div><section class="panel table-panel">${cardTitle('Request register', 'Drafts are internal preparation records, not purchase orders.')}${requests.length ? `<div class="table-wrap"><table>${tableHead(['Request', 'Item / reason', 'Qty', 'Vendor reference', 'Unit estimate', 'State', 'Created'])}<tbody>${requests.map(r => `<tr><td class="code">PR-${String(r.id).padStart(4, '0')}</td><td><div class="table-main">${esc(r.item_name)}<small>${esc(r.reason)}</small></div></td><td>${r.quantity}</td><td>${esc(r.vendor_name || 'Unassigned')}</td><td>${r.estimated_unit_price_cents === null ? 'Not supplied' : '$' + (r.estimated_unit_price_cents / 100).toFixed(2)}</td><td><span class="pill neutral">Draft</span></td><td>${fmtTime(r.created_at)}</td></tr>`).join('')}</tbody></table></div>` : empty('No purchase drafts. Create one for a missing or replacement item.')}</section>`;
}
function importView() {
    return `${topbar('Import assets', 'Validate records before they enter the lab inventory.')}
<div class="two-col import-cols"><section class="panel import-panel"><div class="eyebrow">STEP 01 · UPLOAD OR PASTE</div><h2>Bring in a small asset list</h2><p class="subtitle">Use CSV with columns: tag, category, make_model, serial_ref, home_location_id. Maximum 300 rows. Duplicate tags and missing locations are flagged before acceptance.</p><div class="field"><label for="csv-file">Choose a .csv file</label><input type="file" id="csv-file" accept=".csv,text/csv"></div><div class="field"><label for="csv-text">Or paste CSV</label><textarea id="csv-text" rows="9" spellcheck="false" placeholder="tag,category,make_model,serial_ref,home_location_id&#10;AST-NEW-01,Hand Tools,Claw hammer,SER-NEW-01,LOC-1"></textarea></div>${canAct() ? btn('Validate import', 'preview-import') : '<p class="muted">Viewer role cannot import.</p>'}<p class="hint">Rows are first reviewed, then individually accepted. Corrections to rejected rows keep their import row identity.</p></section><section class="panel import-panel"><div class="eyebrow">STEP 02 · REVIEW</div><h2>Validated entries</h2><div id="import-preview">${importBatch ? renderImportRows() : '<div class="import-placeholder"><span>▤</span><strong>No preview yet</strong><small>Validate a CSV to inspect each row and correct rejected records.</small></div>'}</div></section></div>`;
}
function renderImportRows() { if (!importBatch)
    return ''; const rows = (importBatch.rows || []); return `<div class="validation-summary"><strong>${rows.filter(r => !r.errors.length).length} ready</strong> · <span>${rows.filter(r => r.errors.length).length} need attention</span></div><div class="import-items">${rows.map((r, i) => `<div class="import-item"><div class="import-item-head"><strong>Row ${r.row_number}</strong><span class="${r.errors.length ? 'err' : 'ok'}">${r.errors.length ? r.errors.join(' · ') : r.warnings?.length ? 'Ready · ' + r.warnings.join(' · ') : 'Ready to accept'}</span></div><div class="import-row-fields"><input aria-label="Tag row ${r.row_number}" data-import="${i}:tag" value="${esc(r.values.tag)}"><select aria-label="Category row ${r.row_number}" data-import="${i}:category">${CATEGORIES.map(c => `<option ${c === r.values.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select><input aria-label="Model row ${r.row_number}" data-import="${i}:make_model" value="${esc(r.values.make_model)}"><input aria-label="Serial row ${r.row_number}" data-import="${i}:serial_ref" value="${esc(r.values.serial_ref)}"><select aria-label="Home location row ${r.row_number}" data-import="${i}:home_location_id"><option value="">Choose location</option>${locations.map(l => `<option value="${l.id}" ${l.id === r.values.home_location_id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div></div>`).join('')}</div>${canAct() ? btn('Accept valid rows', 'commit-import') : '<p class="muted">Viewer role cannot import.</p>'}`; }
function auditView() {
    return `${topbar('Activity log', 'An append-only account of material changes to the demo lab.')}
<section class="panel table-panel">${cardTitle('Operational audit', 'Recent changes include actor, time, entity and event type.')}${audit.length ? `<div class="table-wrap"><table>${tableHead(['Event', 'Entity', 'Record', 'Actor', 'Recorded'])}<tbody>${audit.map(a => `<tr><td>${esc(a.action.replaceAll('_', ' '))}</td><td class="capitalize">${esc(a.entity.replaceAll('_', ' '))}</td><td class="code">${esc(a.entity_id)}</td><td class="code">${esc(a.actor)}</td><td>${fmtTime(a.created_at)}</td></tr>`).join('')}</tbody></table></div>` : empty('No activity.')}</section>`;
}
function empty(s) { return `<div class="empty-state"><span>◌</span>${esc(s)}</div>`; }
function draw() { const body = { today: todayView, assets: assetView, loans: loanView, maintenance: maintenanceView, requests: requestsView, import: importView, audit: auditView }; app.innerHTML = `<div class="shell">${nav()}<main class="main"><div class="mobile-bar"><strong>Riverton · Lab Operations</strong><button class="btn secondary" data-action="mobile-nav">Menu</button></div><div class="content">${body[currentView]()}</div><footer class="footer">Riverton demo · All data synthetic · Display timezone: <strong>${esc(tz)}</strong> · <span>Local data only</span></footer></main></div><div id="overlay"></div><div class="toast" id="toast" role="status" aria-live="polite"></div>`; if (selectedAsset)
    showDetail(); }
function selectView(view) { currentView = view; selectedAsset = null; draw(); window.scrollTo({ top: 0, behavior: 'instant' }); }
async function showAsset(id) { try {
    selectedAsset = await api('/api/assets/' + encodeURIComponent(id));
    showDetail();
}
catch (e) {
    notify(e.message, true);
} }
function actionRow(label, action, a, disabled = false) { return `<button class="action-tile" data-action="${action}" data-id="${esc(a.id)}" ${disabled ? 'disabled' : ''}><span>${label}</span><span>↗</span></button>`; }
function showDetail() {
    if (!selectedAsset)
        return;
    const a = selectedAsset, overlay = document.getElementById('overlay');
    if (!overlay)
        return;
    overlay.innerHTML = `<div class="modal-backdrop" data-action="close-detail"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="Asset ${esc(a.tag)}"><header class="drawer-top"><span class="eyebrow">ASSET DETAILS</span><button class="close-icon" aria-label="Close" data-action="close-detail">×</button></header><div class="drawer-body"><div class="drawer-name"><span class="asset-symbol">⌁</span><div><h2>${esc(a.make_model)}</h2><span class="code">${esc(a.tag)}</span></div></div><div class="detail-badge">${badge(a.status)} <span class="muted">${esc(a.category)}</span></div><div class="vendor-reference">Vendor references: <strong>${esc(a.vendor_names || 'None assigned')}</strong></div><div class="detail-grid"><div><small>Current location</small><strong>${esc(a.current_location || 'Unconfirmed')}</strong></div><div><small>Home location</small><strong>${esc(a.home_location || 'Not assigned')}</strong></div><div><small>Condition</small><strong class="capitalize">${esc(a.condition)}</strong></div><div><small>Serial reference</small><strong>${esc(a.serial_ref || 'Not recorded')}</strong></div><div><small>Review interval</small><strong>${a.interval_days} days · v${a.plan_version}</strong></div><div><small>Next review</small><strong>${fmtDate(a.next_due_date)}</strong></div></div>${a.borrower_code ? `<div class="detail-highlight"><strong>On loan to ${esc(a.borrower_code)}</strong><p>Due ${fmtTime(a.loan_due_at)}</p></div>` : ''}
<h3>Actions</h3><div class="detail-actions">${canAct() && a.status === 'available' ? actionRow('Issue this tool', 'checkout', a) + actionRow('Edit asset record', 'edit', a) : ''}${canAct() && a.status === 'on_loan' ? actionRow('Record return', 'return', a) : ''}${canAct() && a.status === 'available' ? actionRow('Flag equipment', 'flag', a) : ''}${isInstructor() && ['quarantined', 'inspection_required', 'missing', 'in_service'].includes(a.status) ? actionRow('Instructor release / locate', 'release', a) : ''}${isInstructor() && a.status !== 'on_loan' ? actionRow('Record service', 'service', a) : ''}${isInstructor() ? actionRow('Revise review interval', 'policy', a) : ''}${isInstructor() ? actionRow('Draft replacement request', 'replacement', a) : ''}</div>
<h3>Maintenance history</h3><div class="history-list">${(a.service_events || []).slice(0, 5).map((s) => `<div><strong>${fmtDate(s.serviced_date)}</strong> · Plan v${s.plan_version}<small>${esc(s.notes)} · Next due ${fmtDate(s.next_due_date)}</small></div>`).join('') || '<p class="muted">No service events recorded.</p>'}</div>
<h3>Policy versions</h3><div class="history-list">${(a.plan_versions || []).map((p) => `<div><strong>v${p.version}</strong> · ${p.interval_days} days<small>Base ${fmtDate(p.base_date)} · Next ${fmtDate(p.next_due_date)}</small></div>`).join('')}</div><div class="detail-disclaimer">Operational status reflects recorded observations and instructor decisions, not a safety certification.</div></div></aside>`;
}
const locOpts = (selected = '') => locations.map(l => `<option value="${esc(l.id)}" ${l.id === selected ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
const borrowerOpts = () => borrowers.map(b => `<option value="${esc(b.code)}">${esc(b.code)} · ${esc(b.label)}</option>`).join('');
const categoriesOpts = () => CATEGORIES.map(c => `<option>${esc(c)}</option>`).join('');
const field = (label, name, inner, help = '') => `<label class="field"><span>${esc(label)}</span>${inner}${help ? `<small>${esc(help)}</small>` : ''}</label>`;
const input = (name, type = 'text', val = '', extra = '') => `<input name="${name}" type="${type}" value="${esc(val)}" ${extra}>`;
const select = (name, inner) => `<select name="${name}">${inner}</select>`;
const dateTimeDefault = () => { const d = new Date(Date.now() + 86400_000); const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 16); };
function openForm(kind, id = '') {
    modalKind = kind;
    const a = assets.find(a => a.id === id) || selectedAsset || {}, out = document.getElementById('overlay');
    if (!out)
        return;
    let title = '', subtitle = '', fields = '';
    switch (kind) {
        case 'new-asset':
            title = 'Add a serialized asset';
            subtitle = 'Create an individual inventory record and an initial date-based review schedule.';
            fields = field('Asset tag', 'tag', input('tag', 'text', '', 'required placeholder="AST-NEW-01"')) + field('Category', 'category', select('category', categoriesOpts())) + field('Make / model', 'make_model', input('make_model', 'text', '', 'required placeholder="18V cordless drill"')) + field('Serial reference', 'serial_ref', input('serial_ref')) + field('Home location', 'home_location_id', select('home_location_id', locOpts())) + field('Current location', 'current_location_id', select('current_location_id', locOpts())) + field('Observed condition', 'condition', select('condition', `<option value="unknown">Unknown</option><option value="good">Good</option><option value="worn">Worn</option><option value="damaged">Damaged (blocks issue)</option>`)) + field('Vendor reference (curated)', 'vendor_id', select('vendor_id', `<option value="">None</option>` + vendors.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join(''))) + field('Review interval (days)', 'interval_days', input('interval_days', 'number', '180', 'min="1" max="3650"'));
            break;
        case 'edit':
            title = 'Edit asset details';
            subtitle = 'Status cannot be overridden here. A reported defect automatically blocks issue; changes are audited.';
            fields = `<div class="immutable-tag">Immutable QR tag · <strong>${esc(a.tag)}</strong></div>` + field('Category', 'category', select('category', CATEGORIES.map(c => `<option ${c === a.category ? 'selected' : ''}>${esc(c)}</option>`).join(''))) + field('Make / model', 'make_model', input('make_model', 'text', a.make_model, 'required')) + field('Serial reference', 'serial_ref', input('serial_ref', 'text', a.serial_ref || '')) + field('Home location', 'home_location_id', select('home_location_id', locOpts(a.home_location_id))) + field('Current location', 'current_location_id', select('current_location_id', locOpts(a.current_location_id))) + field('Observed condition', 'condition', select('condition', ['good', 'worn', 'damaged', 'unknown'].map(c => `<option value="${c}" ${c === a.condition ? 'selected' : ''}>${c}</option>`).join(''))) + field('Vendor reference', 'vendor_id', select('vendor_id', `<option value="">None</option>` + vendors.map(v => `<option value="${v.id}" ${v.id === a.vendor_ids ? 'selected' : ''}>${esc(v.name)}</option>`).join(''))) + field('Change note', 'note', `<textarea name="note" rows="3" required placeholder="Explain the update or physical observation"></textarea>`);
            break;
        case 'checkout':
        case 'quick-checkout':
            title = 'Issue a tool';
            subtitle = 'Only available assets can be checked out. One active loan per asset.';
            fields = field('Asset', 'asset_id', select('asset_id', assets.filter(a => a.status === 'available').map(x => `<option value="${x.id}" ${x.id === id ? 'selected' : ''}>${esc(x.tag)} · ${esc(x.make_model)}</option>`).join(''))) + field('Borrower code', 'borrower_code', select('borrower_code', borrowerOpts())) + field('Due time (your timezone)', 'due_local', input('due_local', 'datetime-local', dateTimeDefault(), 'required')) + field('Observed condition', 'condition', select('condition', ['good', 'worn', 'unknown'].map(c => `<option ${c === a.condition ? 'selected' : ''}>${c}</option>`).join('')));
            break;
        case 'return':
            title = 'Record tool return';
            subtitle = 'A damaged return remains blocked for inspection.';
            fields = `<input type="hidden" name="asset_id" value="${esc(id)}">` + field('Return condition', 'condition', select('condition', ['good', 'worn', 'damaged', 'unknown'].map(c => `<option ${c === 'good' ? 'selected' : ''}>${c}</option>`).join(''))) + field('Destination', 'location_id', select('location_id', locOpts(a.home_location_id))) + field('Observation / defect note', 'note', `<textarea name="note" rows="3" placeholder="Describe any damage or discrepancies"></textarea>`);
            break;
        case 'flag':
            title = 'Flag equipment';
            subtitle = 'Blocked assets cannot be issued until their status is resolved.';
            fields = field('Flag state', 'status', select('status', `<option value="inspection_required">Awaiting inspection (damaged)</option><option value="quarantined">Quarantined</option><option value="missing">Missing</option><option value="in_service">Out for service</option>`)) + field('Required note', 'note', `<textarea name="note" rows="4" required placeholder="What was observed?"></textarea>`);
            break;
        case 'release':
            title = 'Record instructor release';
            subtitle = 'A documented operational decision, not a safety certification.';
            fields = field('Instructor decision note', 'note', `<textarea name="note" rows="4" required placeholder="Record basis for release or confirmed location"></textarea>`) + field('Condition after review', 'condition', select('condition', `<option value="good">Good</option><option value="worn">Worn</option><option value="unknown">Unknown</option>`)) + field('Location (required if previously missing)', 'location_id', select('location_id', `<option value="">Keep recorded location</option>` + locOpts()));
            break;
        case 'service':
            title = 'Record service event';
            subtitle = 'Service advances the due date under the current policy version, without clearing defects.';
            fields = field('Service date', 'serviced_date', input('serviced_date', 'date', new Date().toISOString().slice(0, 10), 'required')) + field('Description of work', 'note', `<textarea name="note" rows="4" required placeholder="Work performed; reviewer"></textarea>`) + field('Service reference (optional)', 'reference', input('reference', 'text', '', 'placeholder="Service log or photo reference"'));
            break;
        case 'policy':
            title = 'Revise maintenance interval';
            subtitle = 'Create a new policy version; earlier service history stays tied to its original version.';
            fields = field('New interval (days)', 'interval_days', input('interval_days', 'number', String(a.interval_days || 180), 'required min="1" max="3650"'));
            break;
        case 'new-request':
        case 'replacement':
            title = 'Create purchase-request draft';
            subtitle = 'Draft only. No order, vendor availability claim, or authorization to spend.';
            fields = field('Item name', 'item_name', input('item_name', 'text', kind === 'replacement' ? a.make_model : '', 'required')) + field('Quantity', 'quantity', input('quantity', 'number', '1', 'required min="1"')) + field('Reason', 'reason', `<textarea name="reason" rows="3" required placeholder="Explain what needs replacing or replenishing"></textarea>`) + field('Vendor reference', 'vendor_id', select('vendor_id', `<option value="">Not specified</option>` + vendors.map(v => `<option value="${v.id}">${esc(v.name)} (checked ${fmtDate(v.last_checked)})</option>`).join(''))) + field('Estimated unit price, if supplied', 'estimated_unit_price', input('estimated_unit_price', 'number', '', 'min="0" step="0.01" placeholder="Not supplied"')) + `<input type="hidden" name="asset_id" value="${kind === 'replacement' ? esc(id) : ''}">`;
            break;
    }
    out.innerHTML = `<div class="modal-backdrop" data-action="close-modal"></div><div class="dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header class="dialog-head"><div><div class="eyebrow">RIVERTON · DEMO</div><h2>${title}</h2><p>${subtitle}</p></div><button class="close-icon" aria-label="Close" data-action="close-modal">×</button></header><form id="action-form" data-kind="${kind}" data-id="${esc(id)}"><div class="dialog-fields">${fields}</div><div class="dialog-foot"><button type="button" class="btn secondary" data-action="close-modal">Cancel</button><button type="submit" class="btn primary">${kind === 'checkout' || kind === 'quick-checkout' ? 'Issue tool' : kind === 'return' ? 'Record return' : kind === 'new-asset' ? 'Create asset' : kind === 'release' ? 'Record release' : kind === 'new-request' || kind === 'replacement' ? 'Save draft' : 'Save record'}</button></div></form></div>`;
    out.querySelector('input:not([type=hidden]),select,textarea')?.focus();
}
function closeModal() { const overlay = document.getElementById('overlay'); if (overlay)
    overlay.innerHTML = ''; modalKind = ''; selectedAsset = null; }
async function refresh(restoreView = true) { await loadAll(); if (restoreView)
    draw(); }
async function submitForm(form) {
    if (working)
        return;
    working = true;
    const submit = form.querySelector('button[type=submit]');
    if (submit) {
        submit.disabled = true;
        submit.textContent = 'Saving…';
    }
    const b = Object.fromEntries(new FormData(form).entries()), kind = form.dataset.kind, id = form.dataset.id || b.asset_id;
    try {
        if (kind === 'new-asset')
            await post('/api/assets', b);
        else if (kind === 'edit')
            await post(`/api/assets/${id}/edit`, b);
        else if (kind === 'checkout' || kind === 'quick-checkout')
            await post(`/api/assets/${b.asset_id}/checkout`, { borrower_code: b.borrower_code, due_at: new Date(b.due_local).toISOString(), condition: b.condition });
        else if (kind === 'return')
            await post(`/api/assets/${id}/return`, b);
        else if (kind === 'flag')
            await post(`/api/assets/${id}/flag`, b);
        else if (kind === 'release')
            await post(`/api/assets/${id}/release`, b);
        else if (kind === 'service')
            await post(`/api/assets/${id}/service`, b);
        else if (kind === 'policy')
            await post(`/api/assets/${id}/policy`, b);
        else if (kind === 'new-request' || kind === 'replacement')
            await post('/api/requests', b);
        closeModal();
        await refresh();
        notify(kind === 'new-request' || kind === 'replacement' ? 'Purchase draft saved. No order placed.' : 'Operational record saved and audited.');
    }
    catch (e) {
        notify(e.message, true);
    }
    finally {
        working = false;
        if (submit) {
            submit.disabled = false;
            submit.textContent = 'Save record';
        }
    }
}
function loginScreen() {
    if (authMode === 'pilot') {
        app.innerHTML = `<div class="login-shell"><div class="login-side"><div class="login-brand"><div class="brand-logo">R<span>•</span></div><strong>Riverton</strong></div><div class="login-intro"><div class="eyebrow">CARPENTRY LAB · OPERATIONS</div><h1>Every tool<br>accounted for.</h1><p>One practical place to issue tools, record repairs and prepare replacement requests.</p><div class="login-features"><span>✓ Tracked equipment loans</span><span>✓ Inspection-first blocking</span><span>✓ Attributed operational actions</span></div></div><div class="login-footer">Fictional school, fictional records. Local-only pilot authentication experiment.</div></div><div class="login-main"><div class="login-card"><div class="eyebrow">LOCAL PILOT SIGN-IN</div><h2>Sign in to the lab</h2><p>Use credentials issued by your local administrator. This is a single-lab pilot, not a public deployment.</p><form id="pilot-login-form"><label class="field">Username<input name="username" type="text" autocomplete="username" maxlength="31" required autofocus></label><label class="field">Password<input name="password" type="password" autocomplete="current-password" required></label><button class="btn primary" type="submit">Sign in securely</button></form><div class="login-footnote">Accounts are created with the local administration command. The demo role selector and reset are disabled in this mode.</div></div></div></div><div id="toast" class="toast" role="status"></div>`;
        return;
    }
    app.innerHTML = `<div class="login-shell"><div class="login-side"><div class="login-brand"><div class="brand-logo">R<span>•</span></div><strong>Riverton</strong></div><div class="login-intro"><div class="eyebrow">CARPENTRY LAB · OPERATIONS</div><h1>Every tool<br>accounted for.</h1><p>One practical place to issue tools, record repairs and prepare replacement requests.</p><div class="login-features"><span>✓ Single-loan accountability</span><span>✓ Inspection-first blocking</span><span>✓ Auditable maintenance decisions</span></div></div><div class="login-footer">Fictional school, fictional records. Demonstration only.</div></div><div class="login-main"><div class="login-card"><div class="eyebrow">LOCAL DEMO SIGN-IN</div><h2>Open the lab workspace</h2><p>Choose a fictional role. This simulates permissions locally; it is not a production identity provider.</p><button class="role-choice" data-login="instructor"><span class="role-avatar">IN</span><span><strong>Demo Instructor</strong><small>Full operational workflows and instructor release decisions</small></span><span>→</span></button><button class="role-choice" data-login="staff"><span class="role-avatar">ST</span><span><strong>Demo Staff</strong><small>Asset checkout, return, flags and import</small></span><span>→</span></button><button class="role-choice" data-login="viewer"><span class="role-avatar">VW</span><span><strong>Demo Viewer</strong><small>Read-only equipment and service records</small></span><span>→</span></button><div class="login-footnote">QR scans lead to this sign-in first. No borrower details are available to signed-out visitors.</div></div></div></div><div id="toast" class="toast" role="status"></div>`;
}
async function boot() { try {
    const s = await api('/api/session');
    authMode = s.demo ? 'demo' : 'pilot';
    if (!s.authenticated) {
        loginScreen();
        return;
    }
    actor = s.actor;
    role = s.role;
    await loadAll();
    draw();
    const queryAsset = new URL(location.href).searchParams.get('asset');
    if (queryAsset)
        showAsset(queryAsset);
}
catch (e) {
    app.innerHTML = `<div class="fatal"><h2>Unable to open the lab</h2><p>${esc(e.message)}</p><button data-action="reload">Retry connection</button></div>`;
} }
app.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action],[data-view],[data-asset],[data-login]');
    if (!target)
        return;
    if (target.dataset.login) {
        try {
            const s = await post('/api/demo/login', { role: target.dataset.login });
            role = s.role;
            actor = s.actor;
            await boot();
        }
        catch (err) {
            notify(err.message, true);
        }
        return;
    }
    if (target.dataset.view) {
        selectView(target.dataset.view);
        return;
    }
    if (target.dataset.asset) {
        await showAsset(target.dataset.asset);
        return;
    }
    const action = target.dataset.action || '', id = target.dataset.id || '';
    if (action === 'reload') {
        location.reload();
        return;
    }
    if (action === 'reset-demo') {
        if (!window.confirm('Reset the entire fictional Riverton demo to its original 60 assets? This permanently removes DEMO edits.'))
            return;
        try {
            await post('/api/demo/reset', {});
            importBatch = null;
            await refresh();
            notify('Synthetic demo restored to initial fixtures.');
        }
        catch (err) {
            notify(err.message, true);
        }
        return;
    }
    if (action === 'refresh') {
        try {
            await refresh();
            notify('Latest lab records loaded.');
        }
        catch (err) {
            stale = true;
            notify('Refresh failed; displayed records may be stale.', true);
        }
        return;
    }
    if (action === 'logout') {
        try {
            await post(authMode === 'demo' ? '/api/demo/logout' : '/api/auth/logout');
            selectedAsset = null;
            loginScreen();
        }
        catch (err) {
            notify(err.message, true);
        }
        return;
    }
    if (action === 'close-detail' || action === 'close-modal') {
        closeModal();
        return;
    }
    if (action === 'mobile-nav') {
        document.querySelector('.sidebar')?.classList.toggle('mobile-open');
        return;
    }
    if (['new-asset', 'edit', 'quick-checkout', 'checkout', 'return', 'flag', 'release', 'service', 'policy', 'new-request', 'replacement'].includes(action)) {
        openForm(action, id);
        return;
    }
    if (action === 'export-assets' || action === 'export-requests') {
        location.href = '/api/export/' + (action === 'export-assets' ? 'assets' : 'requests');
        return;
    }
    if (action === 'print-labels') {
        const filtered = assets.filter(a => (!assetStatus || a.status === assetStatus) && (!assetCategory || a.category === assetCategory) && (!assetSearch || [a.tag, a.make_model, a.category, a.serial_ref].some((v) => String(v || '').toLowerCase().includes(assetSearch.toLowerCase()))));
        if (!filtered.length)
            return notify('No matching asset labels to print', true);
        window.open('/api/labels?ids=' + encodeURIComponent(filtered.slice(0, 24).map(a => a.id).join(',')), '_blank', 'noopener');
        notify('Print sheet opened for first ' + Math.min(filtered.length, 24) + ' matches');
        return;
    }
    if (action === 'preview-import') {
        const box = document.getElementById('csv-text');
        if (!box?.value.trim())
            return notify('Choose a CSV file or paste CSV text first', true);
        try {
            importBatch = await post('/api/import/preview', { csv: box.value });
            draw();
            notify('Import validated. Review or correct rows before acceptance.');
        }
        catch (err) {
            notify(err.message, true);
        }
        return;
    }
    if (action === 'commit-import' && importBatch) {
        try {
            for (const el of document.querySelectorAll('[data-import]')) {
                const [i, k] = (el.dataset.import || '').split(':');
                importBatch.rows[Number(i)].values[k] = el.value;
            }
            const result = await post('/api/import/commit', { batch_id: importBatch.batch_id, rows: importBatch.rows.map((r) => ({ row_number: r.row_number, values: r.values })) });
            importBatch.rows = result.invalid;
            if (!result.invalid.length)
                importBatch = null;
            await refresh();
            notify(`${result.committed.length} rows accepted · ${result.invalid.length} still need correction`);
        }
        catch (err) {
            notify(err.message, true);
        }
        return;
    }
});
app.addEventListener('submit', async (e) => {
    const pilotForm = e.target.closest('form#pilot-login-form');
    if (pilotForm) {
        e.preventDefault();
        const button = pilotForm.querySelector('button[type=submit]');
        button.disabled = true;
        try {
            const fields = new FormData(pilotForm);
            await post('/api/auth/login', { username: fields.get('username'), password: fields.get('password') });
            await boot();
        }
        catch (err) {
            notify(err.message, true);
            pilotForm.querySelector('[name=password]').value = '';
            button.disabled = false;
        }
        return;
    }
    const form = e.target.closest('form#action-form');
    if (form) {
        e.preventDefault();
        await submitForm(form);
    }
});
app.addEventListener('change', async (e) => { const el = e.target; if (el.id === 'asset-status') {
    assetStatus = el.value;
    draw();
}
else if (el.id === 'asset-category') {
    assetCategory = el.value;
    draw();
}
else if (el.id === 'csv-file' && el.files?.[0]) {
    const f = el.files[0];
    if (f.size > 200000) {
        notify('CSV exceeds 200 KB', true);
        return;
    }
    const box = document.getElementById('csv-text');
    box.value = await f.text();
} });
app.addEventListener('input', e => { const el = e.target; if (el.id === 'asset-search') {
    const pos = el.selectionStart || 0;
    assetSearch = el.value;
    draw();
    const next = document.getElementById('asset-search');
    next?.focus();
    next?.setSelectionRange(pos, pos);
} });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('overlay')?.childElementCount)
    closeModal(); });
boot();
