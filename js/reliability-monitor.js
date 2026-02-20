// Independent Reliability Monitoring Component
// Include on tool pages to show uptime and incident history

const RELIABILITY_API = 'https://v7086lxsji.execute-api.us-east-1.amazonaws.com';

const RELIABILITY_STYLES = `
<style>
.reliability-section {
    margin: 24px 0;
}
.reliability-metrics {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
    margin-bottom: 20px;
}
.reliability-metric {
    text-align: center;
    padding: 24px 16px;
    background: #f9fafb;
    border-radius: 12px;
    border: 1px solid #e5e7eb;
}
.reliability-metric .value {
    font-size: 2.5rem;
    font-weight: 700;
    line-height: 1;
    margin-bottom: 8px;
}
.reliability-metric .value.green { color: #10b981; }
.reliability-metric .value.yellow { color: #f59e0b; }
.reliability-metric .value.red { color: #ef4444; }
.reliability-metric .label {
    font-size: 0.9rem;
    color: #6b7280;
}
.reliability-metric .sublabel {
    font-size: 0.75rem;
    color: #9ca3af;
    margin-top: 4px;
}

.reliability-disclaimer {
    font-size: 0.8rem;
    color: #9ca3af;
    font-style: italic;
    margin-bottom: 24px;
    padding: 12px 16px;
    background: #f9fafb;
    border-radius: 6px;
}

.reliability-history {
    margin-top: 24px;
}
.reliability-history-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: #f9fafb;
    border-radius: 8px;
    cursor: pointer;
    border: 1px solid #e5e7eb;
    transition: all 0.2s;
}
.reliability-history-header:hover {
    background: #f3f4f6;
}
.reliability-history-header h4 {
    font-family: 'Inter', sans-serif;
    font-size: 1rem;
    font-weight: 600;
    color: #0f2744;
    margin: 0;
}
.reliability-history-toggle {
    font-size: 1.25rem;
    color: #9ca3af;
    transition: transform 0.2s;
}
.reliability-history-toggle.open {
    transform: rotate(180deg);
}
.reliability-history-content {
    display: none;
    padding: 16px 0;
}
.reliability-history-content.open {
    display: block;
}
.reliability-history table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
}
.reliability-history th,
.reliability-history td {
    text-align: left;
    padding: 12px;
    border-bottom: 1px solid #e5e7eb;
}
.reliability-history th {
    background: #f9fafb;
    color: #6b7280;
    font-weight: 500;
    font-size: 0.8rem;
}
.reliability-history .incident-type {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 4px;
    font-size: 0.8rem;
    font-weight: 500;
}
.reliability-history .incident-type.outage {
    background: #fee2e2;
    color: #991b1b;
}
.reliability-history .incident-type.degraded {
    background: #fef3c7;
    color: #92400e;
}
.reliability-history .incident-type.slow {
    background: #e0f2fe;
    color: #0369a1;
}
.reliability-no-incidents {
    text-align: center;
    padding: 24px;
    color: #10b981;
    font-weight: 500;
}

.report-outage-link {
    display: inline-block;
    margin-top: 16px;
    color: #3b82f6;
    font-size: 0.9rem;
    cursor: pointer;
    text-decoration: none;
}
.report-outage-link:hover {
    text-decoration: underline;
}

.outage-modal {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.5);
    z-index: 1000;
    justify-content: center;
    align-items: center;
    padding: 20px;
}
.outage-modal.active {
    display: flex;
}
.outage-modal-container {
    background: white;
    border-radius: 12px;
    max-width: 500px;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 25px 50px rgba(0,0,0,0.25);
}
.outage-modal-header {
    padding: 20px 24px;
    border-bottom: 1px solid #e5e7eb;
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.outage-modal-header h3 {
    font-family: 'Inter', sans-serif;
    font-size: 1.1rem;
    font-weight: 600;
    color: #0f2744;
}
.outage-modal-close {
    background: none;
    border: none;
    font-size: 1.5rem;
    cursor: pointer;
    color: #9ca3af;
}
.outage-modal-body {
    padding: 24px;
}
.outage-form-group {
    margin-bottom: 16px;
}
.outage-form-group label {
    display: block;
    font-size: 0.9rem;
    font-weight: 500;
    color: #4b5563;
    margin-bottom: 6px;
}
.outage-form-group input,
.outage-form-group textarea {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    font-size: 0.95rem;
    font-family: inherit;
}
.outage-form-group textarea {
    min-height: 100px;
}
.outage-submit-btn {
    width: 100%;
    background: #0f2744;
    color: white;
    border: none;
    padding: 14px 24px;
    border-radius: 6px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
}
.outage-submit-btn:hover {
    background: #1e3a5f;
}
.outage-success {
    text-align: center;
    padding: 40px 24px;
    color: #065f46;
}
.outage-error {
    background: #fee2e2;
    color: #991b1b;
    padding: 12px;
    border-radius: 6px;
    margin-bottom: 16px;
    display: none;
}

@media (max-width: 768px) {
    .reliability-metrics {
        grid-template-columns: 1fr;
    }
}
</style>
`;

const OUTAGE_MODAL_HTML = `
<div class="outage-modal" id="outageModal">
    <div class="outage-modal-container">
        <div class="outage-modal-header">
            <h3>🚨 Report an Outage</h3>
            <button class="outage-modal-close" onclick="closeOutageModal()">×</button>
        </div>
        <div class="outage-modal-body">
            <div class="outage-error" id="outageError"></div>
            <div id="outageFormContainer">
                <form id="outageForm">
                    <input type="hidden" name="toolSlug" id="outageToolSlug">
                    <input type="hidden" name="toolName" id="outageToolName">
                    <div class="outage-form-group">
                        <label>Your Name</label>
                        <input type="text" name="reporterName" required placeholder="Jane Smith">
                    </div>
                    <div class="outage-form-group">
                        <label>Your Email</label>
                        <input type="email" name="reporterEmail" required placeholder="jane@example.com">
                    </div>
                    <div class="outage-form-group">
                        <label>When did you experience the issue?</label>
                        <input type="datetime-local" name="incidentDateTime" required>
                    </div>
                    <div class="outage-form-group">
                        <label>What failed?</label>
                        <textarea name="description" required placeholder="Describe what you were trying to do and what error or issue you experienced..."></textarea>
                    </div>
                    <button type="submit" class="outage-submit-btn">Submit Report</button>
                    <p style="font-size:0.8rem;color:#9ca3af;text-align:center;margin-top:12px;">Reports are cross-referenced with our monitoring data before being added to the incident log.</p>
                </form>
            </div>
            <div id="outageSuccess" style="display:none;" class="outage-success">
                <h4>✓ Report Submitted</h4>
                <p>Thank you! We'll cross-reference this with our monitoring data and add it to the incident log if confirmed.</p>
                <button class="outage-submit-btn" onclick="closeOutageModal()" style="margin-top:20px;">Close</button>
            </div>
        </div>
    </div>
</div>
`;

function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function initReliabilityMonitor(toolSlug, toolName, containerId) {
    // Inject styles
    if (!document.getElementById('reliabilityStyles')) {
        const styleEl = document.createElement('div');
        styleEl.id = 'reliabilityStyles';
        styleEl.innerHTML = RELIABILITY_STYLES;
        document.head.appendChild(styleEl);
    }
    
    // Inject modal
    if (!document.getElementById('outageModal')) {
        const modalEl = document.createElement('div');
        modalEl.innerHTML = OUTAGE_MODAL_HTML;
        document.body.appendChild(modalEl.firstElementChild);
        document.getElementById('outageForm').onsubmit = submitOutageReport;
    }
    
    window.reliabilityToolSlug = toolSlug;
    window.reliabilityToolName = toolName;
    
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = '<div style="color:#9ca3af;padding:20px;text-align:center;">Loading reliability data...</div>';
    
    try {
        const res = await fetch(`${RELIABILITY_API}/reliability?toolSlug=${toolSlug}`);
        const data = await res.json();
        
        if (!data.hasData) {
            container.innerHTML = '<div style="color:#9ca3af;padding:20px;text-align:center;">Reliability monitoring not yet available for this tool.</div>';
            return;
        }
        
        const m = data.metrics;
        let html = '<div class="reliability-section">';
        
        // Metrics
        html += `
            <div class="reliability-metrics">
                <div class="reliability-metric">
                    <div class="value ${data.uptimeColor}">${m.uptime90d?.toFixed(2) || 0}%</div>
                    <div class="label">90-Day Uptime</div>
                    <div class="sublabel">Independent monitoring</div>
                </div>
                <div class="reliability-metric">
                    <div class="value">${m.avgResponseMs || 0}<span style="font-size:1rem;font-weight:400;">ms</span></div>
                    <div class="label">Avg Response Time</div>
                    <div class="sublabel">Last 30 days</div>
                </div>
                <div class="reliability-metric">
                    <div class="value ${m.outageCount90d > 0 ? 'yellow' : 'green'}">${m.outageCount90d || 0}</div>
                    <div class="label">Recorded Outages</div>
                    <div class="sublabel">Last 90 days</div>
                </div>
            </div>
        `;
        
        // Disclaimer
        html += `
            <div class="reliability-disclaimer">
                Uptime data is monitored independently by ToolIntel. This is not sourced from the vendor's own status page.
            </div>
        `;
        
        // Reliability History
        html += `
            <div class="reliability-history">
                <div class="reliability-history-header" onclick="toggleReliabilityHistory()">
                    <h4>📋 Reliability History</h4>
                    <span class="reliability-history-toggle" id="historyToggle">▼</span>
                </div>
                <div class="reliability-history-content" id="historyContent">
        `;
        
        if (data.incidents && data.incidents.length > 0) {
            html += `
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Incident Type</th>
                            <th>Duration</th>
                            <th>Vendor Response</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            
            for (const inc of data.incidents) {
                const typeClass = inc.incidentType === 'Outage' ? 'outage' : 
                                  inc.incidentType === 'Degraded Performance' ? 'degraded' : 'slow';
                html += `
                    <tr>
                        <td>${formatDate(inc.date)}</td>
                        <td><span class="incident-type ${typeClass}">${escapeHtml(inc.incidentType)}</span></td>
                        <td>${escapeHtml(inc.duration)}</td>
                        <td>${escapeHtml(inc.vendorResponseTime)}</td>
                    </tr>
                `;
            }
            
            html += '</tbody></table>';
        } else {
            html += '<div class="reliability-no-incidents">✓ No incidents recorded in the last 90 days</div>';
        }
        
        html += `
                </div>
            </div>
        `;
        
        // Report link
        html += `<a class="report-outage-link" onclick="openOutageModal()">🚨 Report an Outage</a>`;
        
        html += '</div>';
        container.innerHTML = html;
        
    } catch (e) {
        console.error('Failed to load reliability data:', e);
        container.innerHTML = '<div style="color:#9ca3af;padding:20px;text-align:center;">Unable to load reliability data.</div>';
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

function toggleReliabilityHistory() {
    const content = document.getElementById('historyContent');
    const toggle = document.getElementById('historyToggle');
    content.classList.toggle('open');
    toggle.classList.toggle('open');
}

function openOutageModal() {
    document.getElementById('outageToolSlug').value = window.reliabilityToolSlug || '';
    document.getElementById('outageToolName').value = window.reliabilityToolName || '';
    document.getElementById('outageModal').classList.add('active');
    document.getElementById('outageFormContainer').style.display = 'block';
    document.getElementById('outageSuccess').style.display = 'none';
    document.getElementById('outageError').style.display = 'none';
}

function closeOutageModal() {
    document.getElementById('outageModal').classList.remove('active');
}

async function submitOutageReport(e) {
    e.preventDefault();
    
    const form = e.target;
    const btn = form.querySelector('button[type="submit"]');
    const errorDiv = document.getElementById('outageError');
    
    btn.disabled = true;
    btn.textContent = 'Submitting...';
    errorDiv.style.display = 'none';
    
    try {
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());
        
        const res = await fetch(`${RELIABILITY_API}/reliability/report`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Submission failed');
        }
        
        document.getElementById('outageFormContainer').style.display = 'none';
        document.getElementById('outageSuccess').style.display = 'block';
        form.reset();
        
    } catch (err) {
        errorDiv.textContent = err.message;
        errorDiv.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Submit Report';
    }
}

// Close modal on overlay click
document.addEventListener('click', (e) => {
    if (e.target.id === 'outageModal') {
        closeOutageModal();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeOutageModal();
    }
});
