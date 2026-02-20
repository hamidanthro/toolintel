// Product Change History Component
// Include on tool pages to show changelog with score impact tracking

const CHANGELOG_API = 'https://v7086lxsji.execute-api.us-east-1.amazonaws.com';

const CHANGELOG_STYLES = `
<style>
.product-changelog-section {
    margin: 24px 0;
}

.changelog-status-line {
    font-size: 0.95rem;
    color: #4b5563;
    margin-bottom: 20px;
    padding: 12px 16px;
    background: #f9fafb;
    border-radius: 8px;
    border-left: 4px solid #3b82f6;
}
.changelog-status-line strong {
    color: #0f2744;
}

.watch-tool-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 18px;
    background: #0f2744;
    color: #fff;
    border: none;
    border-radius: 6px;
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    margin-bottom: 20px;
    transition: all 0.2s;
}
.watch-tool-btn:hover {
    background: #1e3a5f;
}
.watch-tool-btn.subscribed {
    background: #10b981;
}

.changelog-table-container {
    margin: 20px 0;
    overflow-x: auto;
}
.changelog-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
}
.changelog-table th,
.changelog-table td {
    text-align: left;
    padding: 12px 16px;
    border-bottom: 1px solid #e5e7eb;
}
.changelog-table th {
    background: #f9fafb;
    font-weight: 600;
    color: #0f2744;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.025em;
}
.changelog-table tr:hover {
    background: #f9fafb;
}
.changelog-table a {
    color: #3b82f6;
    text-decoration: none;
}
.changelog-table a:hover {
    text-decoration: underline;
}

.change-type-badge {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
    background: #e5e7eb;
    color: #374151;
}
.change-type-badge.new-feature { background: #d1fae5; color: #065f46; }
.change-type-badge.pricing-change { background: #fef3c7; color: #92400e; }
.change-type-badge.model-update { background: #dbeafe; color: #1e40af; }
.change-type-badge.api-change { background: #e0e7ff; color: #3730a3; }
.change-type-badge.security-update { background: #fee2e2; color: #991b1b; }
.change-type-badge.policy-change { background: #fce7f3; color: #9d174d; }
.change-type-badge.performance-change { background: #cffafe; color: #0e7490; }
.change-type-badge.discontinued-feature { background: #fecaca; color: #991b1b; }

.score-impact-badge {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
}
.score-impact-badge.positive { background: #d1fae5; color: #065f46; }
.score-impact-badge.negative { background: #fee2e2; color: #991b1b; }
.score-impact-badge.neutral { background: #f3f4f6; color: #6b7280; }
.score-impact-badge.under-review { background: #fef3c7; color: #92400e; }

.score-impact-log {
    margin: 24px 0;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    overflow: hidden;
}
.score-impact-header {
    background: #0f2744;
    color: #fff;
    padding: 12px 16px;
    font-weight: 600;
    font-size: 0.95rem;
}
.score-impact-content {
    padding: 0;
}
.score-impact-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
}
.score-impact-table th,
.score-impact-table td {
    text-align: left;
    padding: 12px 16px;
    border-bottom: 1px solid #e5e7eb;
}
.score-impact-table th {
    background: #f3f4f6;
    font-weight: 600;
    color: #374151;
    font-size: 0.8rem;
    text-transform: uppercase;
}
.score-impact-table tr:last-child td {
    border-bottom: none;
}
.score-change {
    font-weight: 600;
}
.score-change.up { color: #10b981; }
.score-change.down { color: #ef4444; }
.score-change.same { color: #6b7280; }

.changelog-permanent-note {
    font-size: 0.8rem;
    color: #9ca3af;
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid #e5e7eb;
}

.no-changelog {
    text-align: center;
    padding: 32px;
    color: #6b7280;
}

/* Subscribe Modal */
.subscribe-modal {
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
.subscribe-modal.open {
    display: flex;
}
.subscribe-modal-content {
    background: #fff;
    border-radius: 12px;
    padding: 32px;
    max-width: 400px;
    width: 90%;
}
.subscribe-modal-content h3 {
    font-family: 'Merriweather', serif;
    color: #0f2744;
    margin-bottom: 8px;
}
.subscribe-modal-content p {
    color: #6b7280;
    font-size: 0.9rem;
    margin-bottom: 20px;
}
.subscribe-form-group {
    margin-bottom: 16px;
}
.subscribe-form-group label {
    display: block;
    font-size: 0.9rem;
    font-weight: 500;
    color: #374151;
    margin-bottom: 6px;
}
.subscribe-form-group input {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    font-size: 0.95rem;
}
.subscribe-form-buttons {
    display: flex;
    gap: 12px;
    margin-top: 20px;
}
.subscribe-form-buttons button {
    padding: 10px 20px;
    border-radius: 6px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    flex: 1;
}
.subscribe-form-buttons .btn-subscribe {
    background: #0f2744;
    color: #fff;
}
.subscribe-form-buttons .btn-cancel {
    background: #f3f4f6;
    color: #4b5563;
    border: 1px solid #e5e7eb;
}
.subscribe-success {
    background: #d1fae5;
    color: #065f46;
    padding: 12px;
    border-radius: 6px;
    margin-bottom: 16px;
    display: none;
}
.subscribe-note {
    font-size: 0.8rem;
    color: #9ca3af;
    margin-top: 12px;
}

@media (max-width: 768px) {
    .changelog-table th:nth-child(5),
    .changelog-table td:nth-child(5) {
        display: none;
    }
    .score-impact-table th:nth-child(5),
    .score-impact-table td:nth-child(5) {
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

function formatMonthYear(dateStr) {
    if (!dateStr) return 'Unknown';
    return new Date(dateStr).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short'
    });
}

function getChangeTypeBadgeClass(type) {
    return (type || '').toLowerCase().replace(/\s+/g, '-');
}

class ProductChangelogWidget {
    constructor(containerId, toolSlug, toolName) {
        this.container = document.getElementById(containerId);
        this.toolSlug = toolSlug;
        this.toolName = toolName || toolSlug;
        
        if (!this.container) {
            console.error('Product changelog container not found:', containerId);
            return;
        }
        
        this.init();
    }
    
    async init() {
        if (!document.getElementById('product-changelog-styles')) {
            const styleEl = document.createElement('div');
            styleEl.id = 'product-changelog-styles';
            styleEl.innerHTML = CHANGELOG_STYLES;
            document.head.appendChild(styleEl.querySelector('style'));
        }
        
        await this.loadData();
    }
    
    async loadData() {
        try {
            const response = await fetch(`${CHANGELOG_API}/changelog?toolSlug=${this.toolSlug}`);
            const data = await response.json();
            this.render(data);
        } catch (error) {
            console.error('Failed to load changelog:', error);
            this.renderError();
        }
    }
    
    render(data) {
        const { entries, scoreImpactEntries, stats, hasEntries } = data;
        
        // Status line
        let statusText = 'No changes logged yet.';
        if (stats.count > 0) {
            statusText = `<strong>${stats.count} change${stats.count > 1 ? 's' : ''}</strong> logged since ${formatMonthYear(stats.firstDate)} — Last updated ${formatDate(stats.lastDate)}`;
        }
        
        let html = `
            <div class="product-changelog-section" id="changelog">
                <button class="watch-tool-btn" onclick="openSubscribeModal('${this.toolSlug}', '${escapeHtml(this.toolName)}')">
                    🔔 Watch This Tool
                </button>
                
                <div class="changelog-status-line">${statusText}</div>
        `;
        
        if (hasEntries && entries.length > 0) {
            html += `
                <div class="changelog-table-container">
                    <table class="changelog-table">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Change Type</th>
                                <th>Description</th>
                                <th>Score Impact</th>
                                <th>Source</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${entries.map(e => `
                                <tr>
                                    <td>${formatDate(e.date)}</td>
                                    <td><span class="change-type-badge ${getChangeTypeBadgeClass(e.changeType)}">${escapeHtml(e.changeType)}</span></td>
                                    <td>${escapeHtml(e.description)}</td>
                                    <td><span class="score-impact-badge ${(e.scoreImpact || '').toLowerCase().replace(' ', '-')}">${escapeHtml(e.scoreImpact)}</span></td>
                                    <td>${e.sourceLink 
                                        ? `<a href="${escapeHtml(e.sourceLink)}" target="_blank" rel="noopener">${escapeHtml(e.source || 'Source')}</a>` 
                                        : escapeHtml(e.source || '-')
                                    }</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
            
            // Score Impact Log
            if (scoreImpactEntries && scoreImpactEntries.length > 0) {
                html += `
                    <div class="score-impact-log">
                        <div class="score-impact-header">📊 Score Impact Log</div>
                        <div class="score-impact-content">
                            <table class="score-impact-table">
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Change</th>
                                        <th>Old Score</th>
                                        <th>New Score</th>
                                        <th>Category Affected</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${scoreImpactEntries.map(e => {
                                        const diff = e.newScore - e.oldScore;
                                        const diffClass = diff > 0 ? 'up' : diff < 0 ? 'down' : 'same';
                                        const diffSymbol = diff > 0 ? '+' : '';
                                        return `
                                            <tr>
                                                <td>${formatDate(e.date)}</td>
                                                <td>${escapeHtml(e.changeType)}</td>
                                                <td>${e.oldScore}</td>
                                                <td><span class="score-change ${diffClass}">${e.newScore} (${diffSymbol}${diff})</span></td>
                                                <td>${escapeHtml(e.categoryAffected || '-')}</td>
                                            </tr>
                                        `;
                                    }).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;
            }
        } else {
            html += `<div class="no-changelog">No product changes have been logged yet for ${escapeHtml(this.toolName)}.</div>`;
        }
        
        html += `
            <p class="changelog-permanent-note">
                Changelog entries are permanent and timestamped. Entries are never removed or backdated at vendor request.
            </p>
        </div>
        
        ${this.getSubscribeModalHtml()}
        `;
        
        this.container.innerHTML = html;
    }
    
    getSubscribeModalHtml() {
        return `
            <div class="subscribe-modal" id="subscribeModal">
                <div class="subscribe-modal-content">
                    <h3>Watch ${escapeHtml(this.toolName)}</h3>
                    <p>Get notified when changes are logged. One email per change. No marketing.</p>
                    
                    <div class="subscribe-success" id="subscribeSuccess">
                        ✓ Subscribed! You'll receive updates for ${escapeHtml(this.toolName)}.
                    </div>
                    
                    <form id="subscribeForm" onsubmit="submitSubscription(event, '${this.toolSlug}')">
                        <div class="subscribe-form-group">
                            <label>Email Address</label>
                            <input type="email" name="email" required placeholder="you@company.com">
                        </div>
                        <div class="subscribe-form-buttons">
                            <button type="button" class="btn-cancel" onclick="closeSubscribeModal()">Cancel</button>
                            <button type="submit" class="btn-subscribe">Subscribe</button>
                        </div>
                    </form>
                    <p class="subscribe-note">Unsubscribe anytime by replying "unsubscribe" to any notification.</p>
                </div>
            </div>
        `;
    }
    
    renderError() {
        this.container.innerHTML = `
            <div class="product-changelog-section">
                <div class="no-changelog">Unable to load changelog. Please try again later.</div>
            </div>
        `;
    }
}

// Global functions for modal and subscription
function openSubscribeModal(toolSlug, toolName) {
    const modal = document.getElementById('subscribeModal');
    if (modal) {
        modal.classList.add('open');
        document.getElementById('subscribeSuccess').style.display = 'none';
    }
}

function closeSubscribeModal() {
    const modal = document.getElementById('subscribeModal');
    if (modal) {
        modal.classList.remove('open');
    }
}

async function submitSubscription(event, toolSlug) {
    event.preventDefault();
    const form = event.target;
    const email = form.email.value;
    
    try {
        const response = await fetch(`${CHANGELOG_API}/changelog/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, toolSlug, subscriptionType: 'tool' })
        });
        
        if (response.ok) {
            document.getElementById('subscribeSuccess').style.display = 'block';
            form.style.display = 'none';
            
            // Update button
            const btn = document.querySelector('.watch-tool-btn');
            if (btn) {
                btn.classList.add('subscribed');
                btn.innerHTML = '✓ Watching';
            }
            
            setTimeout(() => closeSubscribeModal(), 2000);
        } else {
            const err = await response.json();
            alert('Error: ' + (err.error || 'Subscription failed'));
        }
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

document.addEventListener('click', function(e) {
    const modal = document.getElementById('subscribeModal');
    if (modal && e.target === modal) {
        closeSubscribeModal();
    }
});

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ProductChangelogWidget };
}
