// Policy Change History Component
// Include on tool pages to show ToS and Privacy Policy change tracking

const POLICIES_API = 'https://v7086lxsji.execute-api.us-east-1.amazonaws.com';

const POLICIES_STYLES = `
<style>
.policy-changes-section {
    margin: 24px 0;
}

.policy-status-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.95rem;
    margin-bottom: 8px;
}
.policy-status-badge.green {
    background: #d1fae5;
    color: #065f46;
    border: 1px solid #a7f3d0;
}
.policy-status-badge.yellow {
    background: #fef3c7;
    color: #92400e;
    border: 1px solid #fde68a;
}
.policy-status-badge.red {
    background: #fee2e2;
    color: #991b1b;
    border: 1px solid #fecaca;
}

.policy-subtitle {
    font-size: 0.85rem;
    color: #9ca3af;
    margin-bottom: 24px;
    line-height: 1.5;
}

.policy-table-container {
    margin: 20px 0;
    overflow-x: auto;
}
.policy-changes-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
}
.policy-changes-table th,
.policy-changes-table td {
    text-align: left;
    padding: 12px 16px;
    border-bottom: 1px solid #e5e7eb;
}
.policy-changes-table th {
    background: #f9fafb;
    font-weight: 600;
    color: #0f2744;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.025em;
}
.policy-changes-table tr:hover {
    background: #f9fafb;
}
.policy-changes-table a {
    color: #3b82f6;
    text-decoration: none;
}
.policy-changes-table a:hover {
    text-decoration: underline;
}

.buyer-impact {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
}
.buyer-impact.low {
    background: #d1fae5;
    color: #065f46;
}
.buyer-impact.medium {
    background: #fef3c7;
    color: #92400e;
}
.buyer-impact.high {
    background: #fee2e2;
    color: #991b1b;
}

.data-rights-alert {
    margin: 24px 0;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    overflow: hidden;
}
.data-rights-header {
    background: #0f2744;
    color: #fff;
    padding: 12px 16px;
    font-weight: 600;
    font-size: 0.95rem;
}
.data-rights-content {
    padding: 0;
}
.data-rights-row {
    display: grid;
    grid-template-columns: 200px 1fr 140px;
    gap: 16px;
    padding: 14px 16px;
    border-bottom: 1px solid #e5e7eb;
    align-items: center;
}
.data-rights-row:last-child {
    border-bottom: none;
}
.data-rights-label {
    font-weight: 500;
    color: #374151;
    font-size: 0.9rem;
}
.data-rights-status {
    color: #4b5563;
    font-size: 0.9rem;
}
.data-rights-date {
    font-size: 0.8rem;
    color: #9ca3af;
    text-align: right;
}
.data-rights-unknown {
    color: #9ca3af;
    font-style: italic;
}

.archived-versions-link {
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
.archived-versions-link:hover {
    background: #e5e7eb;
    color: #1f2937;
}

.policy-permanent-note {
    font-size: 0.8rem;
    color: #9ca3af;
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid #e5e7eb;
}

.no-policy-data {
    text-align: center;
    padding: 32px;
    color: #6b7280;
}

/* Archives Modal */
.archives-modal {
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
.archives-modal.open {
    display: flex;
}
.archives-modal-content {
    background: #fff;
    border-radius: 12px;
    padding: 32px;
    max-width: 600px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
}
.archives-modal-content h3 {
    font-family: 'Merriweather', serif;
    color: #0f2744;
    margin-bottom: 8px;
}
.archives-modal-content .close-btn {
    float: right;
    background: none;
    border: none;
    font-size: 1.5rem;
    cursor: pointer;
    color: #9ca3af;
}
.archives-list {
    margin-top: 16px;
}
.archive-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px;
    border-bottom: 1px solid #e5e7eb;
}
.archive-item:last-child {
    border-bottom: none;
}
.archive-item .doc-type {
    font-weight: 500;
    color: #0f2744;
}
.archive-item .doc-date {
    font-size: 0.85rem;
    color: #6b7280;
}
.archive-item a {
    color: #3b82f6;
    text-decoration: none;
    font-size: 0.9rem;
}

@media (max-width: 768px) {
    .data-rights-row {
        grid-template-columns: 1fr;
        gap: 4px;
    }
    .data-rights-date {
        text-align: left;
    }
    .policy-changes-table th:nth-child(4),
    .policy-changes-table td:nth-child(4) {
        display: none;
    }
}
</style>
`;

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateStr) {
    if (!dateStr) return 'Unknown';
    return new Date(dateStr).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
    });
}

class PolicyChangesWidget {
    constructor(containerId, toolSlug, toolName) {
        this.container = document.getElementById(containerId);
        this.toolSlug = toolSlug;
        this.toolName = toolName || toolSlug;
        
        if (!this.container) {
            console.error('Policy changes container not found:', containerId);
            return;
        }
        
        this.init();
    }
    
    async init() {
        if (!document.getElementById('policy-changes-styles')) {
            const styleEl = document.createElement('div');
            styleEl.id = 'policy-changes-styles';
            styleEl.innerHTML = POLICIES_STYLES;
            document.head.appendChild(styleEl.querySelector('style'));
        }
        
        await this.loadData();
    }
    
    async loadData() {
        try {
            const response = await fetch(`${POLICIES_API}/policies?toolSlug=${this.toolSlug}`);
            const data = await response.json();
            this.render(data);
        } catch (error) {
            console.error('Failed to load policy data:', error);
            this.renderError();
        }
    }
    
    render(data) {
        const { changes, dataRights, statusBadge, hasChanges } = data;
        
        let html = `
            <div class="policy-changes-section">
                <div class="policy-status-badge ${statusBadge?.color || 'green'}">
                    ${this.getStatusIcon(statusBadge?.color)} ${escapeHtml(statusBadge?.text || 'No Policy Changes in the Last 12 Months')}
                </div>
                <p class="policy-subtitle">
                    Frequent policy changes — especially to data rights and training clauses — are a yellow flag for enterprise buyers.
                </p>
        `;
        
        if (hasChanges && changes.length > 0) {
            html += `
                <div class="policy-table-container">
                    <table class="policy-changes-table">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Document Changed</th>
                                <th>What Changed</th>
                                <th>Buyer Impact</th>
                                <th>Source</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${changes.map(c => `
                                <tr>
                                    <td>${formatDate(c.date)}</td>
                                    <td>${escapeHtml(c.documentType)}</td>
                                    <td>${escapeHtml(c.whatChanged)}</td>
                                    <td><span class="buyer-impact ${(c.buyerImpact || '').toLowerCase()}">${escapeHtml(c.buyerImpact)}</span></td>
                                    <td>${c.sourceLink 
                                        ? `<a href="${escapeHtml(c.sourceLink)}" target="_blank" rel="noopener">${escapeHtml(c.sourceName || 'Source')}</a>` 
                                        : escapeHtml(c.sourceName || '-')
                                    }</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }
        
        // Data Rights Alert
        html += `
            <div class="data-rights-alert">
                <div class="data-rights-header">⚠️ Data Rights Alert</div>
                <div class="data-rights-content">
                    <div class="data-rights-row">
                        <span class="data-rights-label">Training Data Usage</span>
                        <span class="data-rights-status">${dataRights?.trainingData?.status 
                            ? escapeHtml(dataRights.trainingData.status) 
                            : '<span class="data-rights-unknown">Not yet verified</span>'
                        }</span>
                        <span class="data-rights-date">${dataRights?.trainingData?.lastChanged 
                            ? `Updated ${formatDate(dataRights.trainingData.lastChanged)}` 
                            : ''
                        }</span>
                    </div>
                    <div class="data-rights-row">
                        <span class="data-rights-label">IP Rights (inputs/outputs)</span>
                        <span class="data-rights-status">${dataRights?.ipRights?.status 
                            ? escapeHtml(dataRights.ipRights.status) 
                            : '<span class="data-rights-unknown">Not yet verified</span>'
                        }</span>
                        <span class="data-rights-date">${dataRights?.ipRights?.lastChanged 
                            ? `Updated ${formatDate(dataRights.ipRights.lastChanged)}` 
                            : ''
                        }</span>
                    </div>
                    <div class="data-rights-row">
                        <span class="data-rights-label">Arbitration Clause</span>
                        <span class="data-rights-status">${dataRights?.arbitration?.status 
                            ? escapeHtml(dataRights.arbitration.status) 
                            : '<span class="data-rights-unknown">Not yet verified</span>'
                        }</span>
                        <span class="data-rights-date">${dataRights?.arbitration?.lastChanged 
                            ? `Updated ${formatDate(dataRights.arbitration.lastChanged)}` 
                            : ''
                        }</span>
                    </div>
                </div>
            </div>
        `;
        
        html += `
            <a href="#" class="archived-versions-link" onclick="openArchivesModal('${this.toolSlug}', '${escapeHtml(this.toolName)}'); return false;">
                📁 View Archived Policy Versions
            </a>
            
            <p class="policy-permanent-note">
                Policy change records are permanent. ToolIntel does not remove or alter historical policy records at vendor request.
            </p>
        </div>
        
        ${this.getArchivesModalHtml()}
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
    
    getArchivesModalHtml() {
        return `
            <div class="archives-modal" id="archivesModal">
                <div class="archives-modal-content">
                    <button class="close-btn" onclick="closeArchivesModal()">×</button>
                    <h3>Archived Policy Versions</h3>
                    <p style="color: #6b7280; font-size: 0.9rem; margin-bottom: 16px;">
                        Timestamped copies of ${escapeHtml(this.toolName)}'s policy documents captured by ToolIntel.
                    </p>
                    <div class="archives-list" id="archivesList">
                        <div class="no-policy-data">Loading...</div>
                    </div>
                </div>
            </div>
        `;
    }
    
    renderError() {
        this.container.innerHTML = `
            <div class="policy-changes-section">
                <div class="no-policy-data">Unable to load policy data. Please try again later.</div>
            </div>
        `;
    }
}

// Global functions for modal handling
async function openArchivesModal(toolSlug, toolName) {
    const modal = document.getElementById('archivesModal');
    const list = document.getElementById('archivesList');
    if (modal) {
        modal.classList.add('open');
        list.innerHTML = '<div class="no-policy-data">Loading...</div>';
        
        try {
            const response = await fetch(`${POLICIES_API}/policies/archives?toolSlug=${toolSlug}`);
            const archives = await response.json();
            
            if (!archives.length) {
                list.innerHTML = '<div class="no-policy-data">No archived versions available yet.</div>';
                return;
            }
            
            list.innerHTML = archives.map(a => `
                <div class="archive-item">
                    <div>
                        <div class="doc-type">${escapeHtml(a.documentType)}</div>
                        <div class="doc-date">${formatDate(a.date)}</div>
                    </div>
                    <a href="${escapeHtml(a.url)}" target="_blank">View Archive →</a>
                </div>
            `).join('');
        } catch (e) {
            list.innerHTML = '<div class="no-policy-data">Failed to load archives.</div>';
        }
    }
}

function closeArchivesModal() {
    const modal = document.getElementById('archivesModal');
    if (modal) {
        modal.classList.remove('open');
    }
}

document.addEventListener('click', function(e) {
    const modal = document.getElementById('archivesModal');
    if (modal && e.target === modal) {
        closeArchivesModal();
    }
});

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PolicyChangesWidget };
}
