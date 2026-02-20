// Security Incident History Component
// Include on tool pages to show data breach and incident history

const INCIDENTS_API = 'https://v7086lxsji.execute-api.us-east-1.amazonaws.com';

const INCIDENTS_STYLES = `
<style>
.security-incidents-section {
    margin: 24px 0;
}

.incident-status-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.95rem;
    margin-bottom: 8px;
}
.incident-status-badge.green {
    background: #d1fae5;
    color: #065f46;
    border: 1px solid #a7f3d0;
}
.incident-status-badge.yellow {
    background: #fef3c7;
    color: #92400e;
    border: 1px solid #fde68a;
}
.incident-status-badge.red {
    background: #fee2e2;
    color: #991b1b;
    border: 1px solid #fecaca;
}

.incident-subtitle {
    font-size: 0.85rem;
    color: #9ca3af;
    margin-bottom: 24px;
    line-height: 1.5;
}

.incident-table-container {
    margin: 20px 0;
    overflow-x: auto;
}
.incident-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
}
.incident-table th,
.incident-table td {
    text-align: left;
    padding: 12px 16px;
    border-bottom: 1px solid #e5e7eb;
}
.incident-table th {
    background: #f9fafb;
    font-weight: 600;
    color: #0f2744;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.025em;
}
.incident-table tr:hover {
    background: #f9fafb;
}
.incident-table a {
    color: #3b82f6;
    text-decoration: none;
}
.incident-table a:hover {
    text-decoration: underline;
}

.disclosure-quality {
    margin: 24px 0;
    padding: 16px 20px;
    background: #f9fafb;
    border-radius: 8px;
    border: 1px solid #e5e7eb;
}
.disclosure-quality-header {
    font-weight: 600;
    color: #0f2744;
    margin-bottom: 8px;
    font-size: 0.95rem;
}
.disclosure-badge {
    display: inline-block;
    padding: 6px 14px;
    border-radius: 6px;
    font-weight: 500;
    font-size: 0.9rem;
}
.disclosure-badge.proactive {
    background: #d1fae5;
    color: #065f46;
}
.disclosure-badge.reactive {
    background: #fef3c7;
    color: #92400e;
}
.disclosure-badge.undisclosed {
    background: #fee2e2;
    color: #991b1b;
}
.disclosure-description {
    font-size: 0.85rem;
    color: #6b7280;
    margin-top: 8px;
}

.report-incident-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 10px 16px;
    background: #f3f4f6;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    color: #4b5563;
    font-size: 0.9rem;
    text-decoration: none;
    margin: 16px 0;
    cursor: pointer;
    transition: all 0.2s;
}
.report-incident-link:hover {
    background: #e5e7eb;
    color: #1f2937;
}

.incident-permanent-note {
    font-size: 0.8rem;
    color: #9ca3af;
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid #e5e7eb;
}

.no-incidents {
    text-align: center;
    padding: 32px;
    color: #6b7280;
}

/* Report Form Modal */
.incident-report-modal {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.5);
    z-index: 1000;
    align-items: center;
    justify-content: center;
}
.incident-report-modal.open {
    display: flex;
}
.incident-report-form {
    background: #fff;
    border-radius: 12px;
    padding: 32px;
    max-width: 500px;
    width: 90%;
    max-height: 90vh;
    overflow-y: auto;
}
.incident-report-form h3 {
    font-family: 'Merriweather', serif;
    color: #0f2744;
    margin-bottom: 8px;
}
.incident-report-form .form-intro {
    color: #6b7280;
    font-size: 0.9rem;
    margin-bottom: 24px;
}
.incident-form-group {
    margin-bottom: 16px;
}
.incident-form-group label {
    display: block;
    font-size: 0.9rem;
    font-weight: 500;
    color: #374151;
    margin-bottom: 6px;
}
.incident-form-group input,
.incident-form-group select,
.incident-form-group textarea {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    font-size: 0.95rem;
}
.incident-form-group textarea {
    min-height: 100px;
    resize: vertical;
}
.incident-form-buttons {
    display: flex;
    gap: 12px;
    margin-top: 24px;
}
.incident-form-buttons button {
    padding: 10px 20px;
    border-radius: 6px;
    font-weight: 500;
    cursor: pointer;
    border: none;
}
.incident-form-buttons .btn-submit {
    background: #0f2744;
    color: #fff;
    flex: 1;
}
.incident-form-buttons .btn-cancel {
    background: #f3f4f6;
    color: #4b5563;
    border: 1px solid #e5e7eb;
}
.incident-form-success {
    background: #d1fae5;
    color: #065f46;
    padding: 12px;
    border-radius: 6px;
    margin-bottom: 16px;
    display: none;
}
.incident-form-error {
    background: #fee2e2;
    color: #991b1b;
    padding: 12px;
    border-radius: 6px;
    margin-bottom: 16px;
    display: none;
}

@media (max-width: 768px) {
    .incident-table th:nth-child(4),
    .incident-table td:nth-child(4) {
        display: none;
    }
}
</style>
`;

const DISCLOSURE_DESCRIPTIONS = {
    'Proactive': 'Vendor disclosed before external discovery',
    'Reactive': 'Vendor disclosed after external discovery',
    'Undisclosed': 'Incident confirmed through third party with no vendor acknowledgment'
};

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
    });
}

class SecurityIncidentsWidget {
    constructor(containerId, toolSlug, toolName) {
        this.container = document.getElementById(containerId);
        this.toolSlug = toolSlug;
        this.toolName = toolName || toolSlug;
        
        if (!this.container) {
            console.error('Security incidents container not found:', containerId);
            return;
        }
        
        this.init();
    }
    
    async init() {
        // Inject styles
        if (!document.getElementById('security-incidents-styles')) {
            const styleEl = document.createElement('div');
            styleEl.id = 'security-incidents-styles';
            styleEl.innerHTML = INCIDENTS_STYLES;
            document.head.appendChild(styleEl.querySelector('style'));
        }
        
        await this.loadData();
    }
    
    async loadData() {
        try {
            const response = await fetch(`${INCIDENTS_API}/incidents?toolSlug=${this.toolSlug}`);
            const data = await response.json();
            this.render(data);
        } catch (error) {
            console.error('Failed to load security incidents:', error);
            this.renderError();
        }
    }
    
    render(data) {
        const { incidents, statusBadge, disclosureQuality, hasIncidents } = data;
        
        let html = `
            <div class="security-incidents-section">
                <div class="incident-status-badge ${statusBadge?.color || 'green'}">
                    ${this.getStatusIcon(statusBadge?.color)} ${escapeHtml(statusBadge?.text || 'No Verified Incidents in the Last 24 Months')}
                </div>
                <p class="incident-subtitle">
                    A clean record is a positive signal. Transparency about past incidents is also a positive signal. Absence of disclosure is a yellow flag.
                </p>
        `;
        
        if (hasIncidents && incidents.length > 0) {
            html += `
                <div class="incident-table-container">
                    <table class="incident-table">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Incident Type</th>
                                <th>Scope</th>
                                <th>Vendor Response</th>
                                <th>Source</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${incidents.map(inc => `
                                <tr>
                                    <td>${formatDate(inc.date)}</td>
                                    <td>${escapeHtml(inc.incidentType)}</td>
                                    <td>${escapeHtml(inc.scope || 'Unknown')}</td>
                                    <td>${escapeHtml(inc.vendorResponse || 'No public response')}</td>
                                    <td>${inc.sourceLink 
                                        ? `<a href="${escapeHtml(inc.sourceLink)}" target="_blank" rel="noopener">${escapeHtml(inc.sourceName || 'Source')}</a>` 
                                        : escapeHtml(inc.sourceName || '-')
                                    }</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
            
            if (disclosureQuality) {
                html += `
                    <div class="disclosure-quality">
                        <div class="disclosure-quality-header">Vendor Disclosure Quality</div>
                        <span class="disclosure-badge ${disclosureQuality.toLowerCase()}">${escapeHtml(disclosureQuality)}</span>
                        <p class="disclosure-description">${DISCLOSURE_DESCRIPTIONS[disclosureQuality] || ''}</p>
                    </div>
                `;
            }
        }
        
        html += `
            <a href="#" class="report-incident-link" onclick="openIncidentReportModal('${this.toolSlug}', '${escapeHtml(this.toolName)}'); return false;">
                🚨 Report a Security Incident
            </a>
            
            <p class="incident-permanent-note">
                ToolIntel does not remove incident records at vendor request. Historical accuracy is a non-negotiable platform commitment.
            </p>
        </div>
        
        ${this.getReportModalHtml()}
        `;
        
        this.container.innerHTML = html;
    }
    
    getStatusIcon(color) {
        switch(color) {
            case 'green': return '✓';
            case 'yellow': return '⚠';
            case 'red': return '🚨';
            default: return '✓';
        }
    }
    
    getReportModalHtml() {
        return `
            <div class="incident-report-modal" id="incidentReportModal">
                <div class="incident-report-form">
                    <h3>Report a Security Incident</h3>
                    <p class="form-intro">All submissions are verified against public sources before publication. Unverified reports are never published.</p>
                    
                    <div class="incident-form-success" id="incidentFormSuccess">
                        Thank you! Your report has been submitted and will be reviewed within 24 hours.
                    </div>
                    <div class="incident-form-error" id="incidentFormError"></div>
                    
                    <form id="incidentReportForm" onsubmit="submitIncidentReport(event)">
                        <input type="hidden" name="toolSlug" value="${this.toolSlug}">
                        <input type="hidden" name="toolName" value="${escapeHtml(this.toolName)}">
                        
                        <div class="incident-form-group">
                            <label>Your Name *</label>
                            <input type="text" name="submitterName" required placeholder="Jane Smith">
                        </div>
                        
                        <div class="incident-form-group">
                            <label>Your Email *</label>
                            <input type="email" name="submitterEmail" required placeholder="jane@company.com">
                        </div>
                        
                        <div class="incident-form-group">
                            <label>Incident Date *</label>
                            <input type="date" name="incidentDate" required>
                        </div>
                        
                        <div class="incident-form-group">
                            <label>Incident Type</label>
                            <select name="incidentType">
                                <option value="">Select type...</option>
                                <option value="Data Breach">Data Breach</option>
                                <option value="Service Compromise">Service Compromise</option>
                                <option value="Unauthorized Access">Unauthorized Access</option>
                                <option value="Data Exposure">Data Exposure</option>
                                <option value="Other">Other</option>
                            </select>
                        </div>
                        
                        <div class="incident-form-group">
                            <label>Description *</label>
                            <textarea name="description" required placeholder="Describe the incident and how you became aware of it..."></textarea>
                        </div>
                        
                        <div class="incident-form-group">
                            <label>Source Link (if available)</label>
                            <input type="url" name="sourceLink" placeholder="https://...">
                        </div>
                        
                        <div class="incident-form-buttons">
                            <button type="button" class="btn-cancel" onclick="closeIncidentReportModal()">Cancel</button>
                            <button type="submit" class="btn-submit">Submit Report</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
    }
    
    renderError() {
        this.container.innerHTML = `
            <div class="security-incidents-section">
                <div class="no-incidents">Unable to load security incident data. Please try again later.</div>
            </div>
        `;
    }
}

// Global functions for modal handling
function openIncidentReportModal(toolSlug, toolName) {
    const modal = document.getElementById('incidentReportModal');
    if (modal) {
        modal.classList.add('open');
        document.getElementById('incidentFormSuccess').style.display = 'none';
        document.getElementById('incidentFormError').style.display = 'none';
    }
}

function closeIncidentReportModal() {
    const modal = document.getElementById('incidentReportModal');
    if (modal) {
        modal.classList.remove('open');
    }
}

async function submitIncidentReport(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    
    const data = {
        toolSlug: formData.get('toolSlug'),
        toolName: formData.get('toolName'),
        submitterName: formData.get('submitterName'),
        submitterEmail: formData.get('submitterEmail'),
        incidentDate: formData.get('incidentDate'),
        incidentType: formData.get('incidentType'),
        description: formData.get('description'),
        sourceLink: formData.get('sourceLink')
    };
    
    try {
        const response = await fetch(`${INCIDENTS_API}/incidents/report`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            document.getElementById('incidentFormSuccess').style.display = 'block';
            document.getElementById('incidentFormError').style.display = 'none';
            form.reset();
            setTimeout(() => closeIncidentReportModal(), 3000);
        } else {
            const err = await response.json();
            throw new Error(err.error || 'Submission failed');
        }
    } catch (error) {
        document.getElementById('incidentFormError').textContent = error.message;
        document.getElementById('incidentFormError').style.display = 'block';
        document.getElementById('incidentFormSuccess').style.display = 'none';
    }
}

// Close modal on outside click
document.addEventListener('click', function(e) {
    const modal = document.getElementById('incidentReportModal');
    if (modal && e.target === modal) {
        closeIncidentReportModal();
    }
});

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SecurityIncidentsWidget };
}
