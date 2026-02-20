// Dynamic Verified Pricing Table Component v2
// Features: per-tier verification, 12-month history, volatility badge, free tier tracker, hidden costs, fairness trend, alerts

const PRICING_API = 'https://v7086lxsji.execute-api.us-east-1.amazonaws.com';

const PRICING_STYLES = `
<style>
.verified-pricing-section {
    margin: 24px 0;
}

/* Stale Warning */
.pricing-stale-warning {
    background: #fef3c7;
    border: 1px solid #f59e0b;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 20px;
    display: flex;
    align-items: center;
    gap: 12px;
}
.pricing-stale-warning .icon { font-size: 1.5rem; }
.pricing-stale-warning .text { flex: 1; font-size: 0.9rem; color: #92400e; }
.pricing-stale-warning a { color: #b45309; font-weight: 500; }

/* Volatility Badge */
.volatility-badge-container {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
    padding: 16px;
    background: #f9fafb;
    border-radius: 8px;
    border: 1px solid #e5e7eb;
}
.volatility-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 20px;
    font-size: 0.85rem;
    font-weight: 600;
    white-space: nowrap;
}
.volatility-badge.stable { background: #d1fae5; color: #065f46; }
.volatility-badge.moderate { background: #dbeafe; color: #1e40af; }
.volatility-badge.volatile { background: #fef3c7; color: #92400e; }
.volatility-badge.unpredictable { background: #fee2e2; color: #991b1b; }
.volatility-explanation {
    font-size: 0.9rem;
    color: #4b5563;
    line-height: 1.4;
}

/* Pricing Table */
.pricing-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 16px;
}
.pricing-table th,
.pricing-table td {
    text-align: left;
    padding: 14px 16px;
    border-bottom: 1px solid #e5e7eb;
}
.pricing-table th {
    background: #f9fafb;
    font-weight: 600;
    color: #4b5563;
    font-size: 0.85rem;
}
.pricing-table td { font-size: 0.95rem; }
.pricing-table .tier-name {
    font-weight: 600;
    color: #0f2744;
}
.pricing-table .tier-price {
    font-weight: 700;
    color: #0f2744;
    font-size: 1.1rem;
}
.pricing-table .price-history {
    display: block;
    font-size: 0.75rem;
    color: #9ca3af;
    font-weight: 400;
    margin-top: 4px;
}
.pricing-table .price-change {
    display: inline-block;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
    margin-left: 4px;
}
.pricing-table .price-change.up { background: #fee2e2; color: #991b1b; }
.pricing-table .price-change.down { background: #d1fae5; color: #065f46; }
.pricing-table .price-change.same { background: #f3f4f6; color: #6b7280; }
.pricing-table .tier-verified {
    display: block;
    font-size: 0.7rem;
    color: #9ca3af;
    margin-top: 4px;
}
.pricing-table .hidden-costs {
    color: #9ca3af;
    font-size: 0.85rem;
    font-style: italic;
}

/* Free Tier Tracker */
.free-tier-tracker {
    margin: 24px 0;
    padding: 20px;
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-radius: 8px;
}
.free-tier-tracker h4 {
    font-family: 'Inter', sans-serif;
    font-size: 0.95rem;
    font-weight: 600;
    color: #166534;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
}
.free-tier-timeline {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.free-tier-entry {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 0.9rem;
}
.free-tier-date {
    color: #6b7280;
    min-width: 100px;
    font-size: 0.85rem;
}
.free-tier-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 4px;
    font-weight: 500;
    font-size: 0.85rem;
}
.free-tier-status.full { background: #d1fae5; color: #065f46; }
.free-tier-status.limited { background: #fef3c7; color: #92400e; }
.free-tier-status.trial { background: #dbeafe; color: #1e40af; }
.free-tier-status.none { background: #fee2e2; color: #991b1b; }

/* Hidden Cost Log */
.hidden-cost-log {
    margin: 24px 0;
    padding: 20px;
    background: #fef3c7;
    border: 1px solid #fde68a;
    border-radius: 8px;
}
.hidden-cost-log h4 {
    font-family: 'Inter', sans-serif;
    font-size: 0.95rem;
    font-weight: 600;
    color: #92400e;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
}
.hidden-cost-entry {
    padding: 12px;
    background: rgba(255,255,255,0.7);
    border-radius: 6px;
    margin-bottom: 8px;
}
.hidden-cost-entry:last-child { margin-bottom: 0; }
.hidden-cost-description {
    font-weight: 500;
    color: #78350f;
    margin-bottom: 4px;
}
.hidden-cost-meta {
    font-size: 0.8rem;
    color: #92400e;
}
.hidden-cost-empty {
    color: #78350f;
    font-style: italic;
    font-size: 0.9rem;
}

/* Pricing Fairness Trend */
.fairness-trend {
    margin: 24px 0;
    padding: 20px;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
}
.fairness-trend h4 {
    font-family: 'Inter', sans-serif;
    font-size: 0.95rem;
    font-weight: 600;
    color: #0f2744;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
}
.fairness-trend-chart {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    height: 60px;
    padding: 8px 0;
}
.fairness-bar {
    flex: 1;
    max-width: 40px;
    background: #3b82f6;
    border-radius: 4px 4px 0 0;
    position: relative;
    transition: background 0.2s;
}
.fairness-bar:hover { background: #2563eb; }
.fairness-bar .tooltip {
    display: none;
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    background: #0f2744;
    color: white;
    padding: 6px 10px;
    border-radius: 4px;
    font-size: 0.75rem;
    white-space: nowrap;
    margin-bottom: 4px;
}
.fairness-bar:hover .tooltip { display: block; }
.fairness-legend {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: #9ca3af;
    margin-top: 8px;
}

/* Price Alert Subscription */
.price-alert-section {
    margin: 24px 0;
    padding: 20px;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 8px;
}
.price-alert-section h4 {
    font-family: 'Inter', sans-serif;
    font-size: 0.95rem;
    font-weight: 600;
    color: #1e40af;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
}
.price-alert-section p {
    font-size: 0.9rem;
    color: #3b82f6;
    margin-bottom: 12px;
}
.price-alert-form {
    display: flex;
    gap: 8px;
}
.price-alert-form input {
    flex: 1;
    padding: 10px 12px;
    border: 1px solid #bfdbfe;
    border-radius: 6px;
    font-size: 0.95rem;
}
.price-alert-form button {
    padding: 10px 16px;
    background: #1e40af;
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
}
.price-alert-form button:hover { background: #1e3a8a; }
.price-alert-form button:disabled { background: #9ca3af; cursor: not-allowed; }
.price-alert-success {
    color: #065f46;
    background: #d1fae5;
    padding: 10px 12px;
    border-radius: 6px;
    font-size: 0.9rem;
    display: none;
}
.price-alert-error {
    color: #991b1b;
    background: #fee2e2;
    padding: 10px 12px;
    border-radius: 6px;
    font-size: 0.9rem;
    display: none;
}

/* Pricing History Section */
.pricing-history {
    margin-top: 24px;
}
.pricing-history h4 {
    font-family: 'Inter', sans-serif;
    font-size: 1rem;
    font-weight: 600;
    color: #0f2744;
    margin-bottom: 12px;
}
.pricing-history table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
}
.pricing-history th,
.pricing-history td {
    text-align: left;
    padding: 10px 12px;
    border-bottom: 1px solid #e5e7eb;
}
.pricing-history th {
    background: #f9fafb;
    color: #6b7280;
    font-weight: 500;
    font-size: 0.8rem;
}
.pricing-history .change-up { color: #dc2626; font-weight: 500; }
.pricing-history .change-down { color: #059669; font-weight: 500; }

/* View Full History Link */
.view-full-history {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 16px;
    color: #3b82f6;
    font-size: 0.9rem;
    text-decoration: none;
    font-weight: 500;
}
.view-full-history:hover { text-decoration: underline; }

/* Report Pricing Link */
.report-pricing-link {
    display: inline-block;
    margin-top: 16px;
    color: #3b82f6;
    font-size: 0.9rem;
    cursor: pointer;
    text-decoration: none;
}
.report-pricing-link:hover { text-decoration: underline; }

/* Modal Styles */
.report-form-modal {
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
.report-form-modal.active { display: flex; }
.report-form-container {
    background: white;
    border-radius: 12px;
    max-width: 500px;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 25px 50px rgba(0,0,0,0.25);
}
.report-form-header {
    padding: 20px 24px;
    border-bottom: 1px solid #e5e7eb;
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.report-form-header h3 {
    font-family: 'Inter', sans-serif;
    font-size: 1.1rem;
    font-weight: 600;
    color: #0f2744;
}
.report-form-close {
    background: none;
    border: none;
    font-size: 1.5rem;
    cursor: pointer;
    color: #9ca3af;
}
.report-form-body { padding: 24px; }
.report-form-group { margin-bottom: 16px; }
.report-form-group label {
    display: block;
    font-size: 0.9rem;
    font-weight: 500;
    color: #4b5563;
    margin-bottom: 6px;
}
.report-form-group input {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    font-size: 0.95rem;
    font-family: inherit;
}
.report-submit-btn {
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
.report-submit-btn:hover { background: #1e3a5f; }
.report-success {
    text-align: center;
    padding: 40px 24px;
    color: #065f46;
}
.report-error {
    background: #fee2e2;
    color: #991b1b;
    padding: 12px;
    border-radius: 6px;
    margin-bottom: 16px;
    display: none;
}

@media (max-width: 640px) {
    .price-alert-form { flex-direction: column; }
    .volatility-badge-container { flex-direction: column; align-items: flex-start; }
    .pricing-table th, .pricing-table td { padding: 10px 8px; font-size: 0.85rem; }
}
</style>
`;

const REPORT_FORM_HTML = `
<div class="report-form-modal" id="reportPricingModal">
    <div class="report-form-container">
        <div class="report-form-header">
            <h3>📊 Report a Pricing Change</h3>
            <button class="report-form-close" onclick="closeReportPricingModal()">×</button>
        </div>
        <div class="report-form-body">
            <div class="report-error" id="reportError"></div>
            <div id="reportFormContainer">
                <form id="reportPricingForm">
                    <input type="hidden" name="toolSlug" id="reportToolSlug">
                    <input type="hidden" name="toolName" id="reportToolName">
                    <div class="report-form-group">
                        <label>Your Name</label>
                        <input type="text" name="submitterName" required placeholder="Jane Smith">
                    </div>
                    <div class="report-form-group">
                        <label>Your Email</label>
                        <input type="email" name="submitterEmail" required placeholder="jane@example.com">
                    </div>
                    <div class="report-form-group">
                        <label>Tier Affected</label>
                        <input type="text" name="tierAffected" required placeholder="e.g., Pro Plan">
                    </div>
                    <div class="report-form-group">
                        <label>Old Price</label>
                        <input type="text" name="oldPrice" required placeholder="e.g., $20/month">
                    </div>
                    <div class="report-form-group">
                        <label>New Price</label>
                        <input type="text" name="newPrice" required placeholder="e.g., $25/month">
                    </div>
                    <div class="report-form-group">
                        <label>Link to Source</label>
                        <input type="url" name="sourceUrl" required placeholder="https://example.com/pricing">
                    </div>
                    <button type="submit" class="report-submit-btn">Submit Report</button>
                    <p style="font-size:0.8rem;color:#9ca3af;text-align:center;margin-top:12px;">Reports are reviewed before updating pricing.</p>
                </form>
            </div>
            <div id="reportSuccess" style="display:none;" class="report-success">
                <h4>✓ Report Submitted</h4>
                <p>Thank you! We'll review this pricing change and update our records if verified.</p>
                <button class="report-submit-btn" onclick="closeReportPricingModal()" style="margin-top:20px;">Close</button>
            </div>
        </div>
    </div>
</div>
`;

function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatShortDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

const FREE_TIER_LABELS = {
    full: { label: 'Full Free Tier', icon: '✓' },
    limited: { label: 'Limited Free Tier', icon: '◐' },
    trial: { label: 'Trial Only', icon: '⏱' },
    none: { label: 'No Free Tier', icon: '✗' }
};

async function initPricingTable(toolSlug, toolName, vendorUrl, containerId) {
    // Inject styles
    if (!document.getElementById('pricingStyles')) {
        const styleEl = document.createElement('div');
        styleEl.id = 'pricingStyles';
        styleEl.innerHTML = PRICING_STYLES;
        document.head.appendChild(styleEl);
    }
    
    // Inject modal
    if (!document.getElementById('reportPricingModal')) {
        const modalEl = document.createElement('div');
        modalEl.innerHTML = REPORT_FORM_HTML;
        document.body.appendChild(modalEl.firstElementChild);
        document.getElementById('reportPricingForm').onsubmit = submitPricingReport;
    }
    
    // Store for report form
    window.pricingToolSlug = toolSlug;
    window.pricingToolName = toolName;
    window.pricingVendorUrl = vendorUrl;
    
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = '<div style="color:#9ca3af;padding:20px;text-align:center;">Loading pricing...</div>';
    
    try {
        const res = await fetch(`${PRICING_API}/pricing?toolSlug=${toolSlug}`);
        const data = await res.json();
        
        if (!data.current) {
            container.innerHTML = '<div style="color:#9ca3af;padding:20px;text-align:center;">Pricing data not yet available.</div>';
            return;
        }
        
        let html = '<div class="verified-pricing-section">';
        
        // Stale warning
        if (data.isStale) {
            html += `
                <div class="pricing-stale-warning">
                    <span class="icon">⚠️</span>
                    <span class="text">
                        This pricing was last verified ${data.current.verifiedAt ? formatDate(data.current.verifiedAt) : 'over 90 days ago'}. 
                        Prices may have changed. <a href="${vendorUrl}" target="_blank" rel="nofollow">Verify directly at vendor site</a> before purchasing.
                    </span>
                </div>
            `;
        }
        
        // Volatility Badge
        if (data.volatility) {
            html += `
                <div class="volatility-badge-container">
                    <span class="volatility-badge ${data.volatility.rating}">
                        📊 Pricing Volatility: ${data.volatility.label}
                    </span>
                    <span class="volatility-explanation">${escapeHtml(data.volatilityExplanation)}</span>
                </div>
            `;
        }
        
        // Pricing table with per-row timestamps and 12-month history
        html += `
            <table class="pricing-table">
                <thead>
                    <tr>
                        <th>Tier</th>
                        <th>Price</th>
                        <th>What You Get</th>
                        <th>Hidden Costs?</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        for (const tier of data.current.tiers || []) {
            // Price change indicator
            let priceChangeHtml = '';
            if (tier.price12MonthsAgo && tier.percentageChange !== null) {
                const changeClass = tier.percentageChange > 0 ? 'up' : tier.percentageChange < 0 ? 'down' : 'same';
                const changeSymbol = tier.percentageChange > 0 ? '↑' : tier.percentageChange < 0 ? '↓' : '=';
                priceChangeHtml = `
                    <span class="price-history">
                        was ${escapeHtml(tier.price12MonthsAgo)} 12mo ago
                        <span class="price-change ${changeClass}">${changeSymbol}${Math.abs(tier.percentageChange)}%</span>
                    </span>
                `;
            }
            
            html += `
                <tr>
                    <td class="tier-name">
                        ${escapeHtml(tier.name)}
                        <span class="tier-verified">✓ Verified ${tier.verifiedAt ? formatDate(tier.verifiedAt) : 'N/A'}</span>
                    </td>
                    <td class="tier-price">
                        ${escapeHtml(tier.price)}
                        ${priceChangeHtml}
                    </td>
                    <td>${escapeHtml(tier.features)}</td>
                    <td class="hidden-costs">${escapeHtml(tier.hiddenCosts || 'None noted')}</td>
                </tr>
            `;
        }
        
        html += '</tbody></table>';
        
        // Free Tier Tracker
        if (data.freeTierHistory && data.freeTierHistory.length > 0) {
            html += `
                <div class="free-tier-tracker">
                    <h4>🆓 Free Tier Tracker</h4>
                    <div class="free-tier-timeline">
            `;
            
            for (const entry of data.freeTierHistory.slice(0, 5)) {
                const statusInfo = FREE_TIER_LABELS[entry.status] || { label: entry.status, icon: '?' };
                html += `
                    <div class="free-tier-entry">
                        <span class="free-tier-date">${formatDate(entry.date)}</span>
                        <span class="free-tier-status ${entry.status}">${statusInfo.icon} ${statusInfo.label}</span>
                        ${entry.notes ? `<span style="color:#6b7280;font-size:0.85rem;">— ${escapeHtml(entry.notes)}</span>` : ''}
                    </div>
                `;
            }
            
            html += `</div></div>`;
        }
        
        // Hidden Cost Log
        html += `
            <div class="hidden-cost-log">
                <h4>💰 Hidden Cost Log</h4>
        `;
        
        if (data.hiddenCosts && data.hiddenCosts.length > 0) {
            for (const cost of data.hiddenCosts) {
                html += `
                    <div class="hidden-cost-entry">
                        <div class="hidden-cost-description">${escapeHtml(cost.description)}</div>
                        <div class="hidden-cost-meta">
                            Discovered via ${escapeHtml(cost.howDiscovered)} • Verified ${formatDate(cost.verifiedAt)}
                        </div>
                    </div>
                `;
            }
        } else {
            html += `<p class="hidden-cost-empty">No hidden costs discovered yet. Know of one? Report it below.</p>`;
        }
        
        html += `</div>`;
        
        // Pricing Fairness Trend
        if (data.fairnessTrend && data.fairnessTrend.length > 1) {
            html += `
                <div class="fairness-trend">
                    <h4>📈 Pricing Fairness Trend</h4>
                    <div class="fairness-trend-chart">
            `;
            
            const maxScore = 100;
            const entries = data.fairnessTrend.slice(0, 10).reverse();
            
            for (const entry of entries) {
                const height = (entry.score / maxScore) * 100;
                html += `
                    <div class="fairness-bar" style="height: ${height}%">
                        <div class="tooltip">
                            ${formatShortDate(entry.date)}: ${entry.score}/100
                            ${entry.priceChangeDescription ? `<br>${escapeHtml(entry.priceChangeDescription)}` : ''}
                        </div>
                    </div>
                `;
            }
            
            html += `
                    </div>
                    <div class="fairness-legend">
                        <span>${entries.length > 0 ? formatShortDate(entries[0].date) : ''}</span>
                        <span>Pricing Fairness Score (higher = better value)</span>
                        <span>${entries.length > 0 ? formatShortDate(entries[entries.length-1].date) : ''}</span>
                    </div>
                </div>
            `;
        }
        
        // Price Alert Subscription
        html += `
            <div class="price-alert-section">
                <h4>🔔 Price Change Alerts</h4>
                <p>Get notified when ${escapeHtml(toolName)} changes their pricing. One email per change, no marketing.</p>
                <div class="price-alert-form" id="priceAlertForm">
                    <input type="email" id="alertEmail" placeholder="your@email.com" required>
                    <button type="button" onclick="subscribePriceAlert('${toolSlug}')">Subscribe</button>
                </div>
                <div class="price-alert-success" id="alertSuccess">✓ Check your email to confirm subscription</div>
                <div class="price-alert-error" id="alertError"></div>
            </div>
        `;
        
        // Pricing history (recent)
        if (data.history && data.history.length > 0) {
            html += `
                <div class="pricing-history">
                    <h4>📜 Recent Pricing Changes</h4>
                    <table>
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Tier</th>
                                <th>What Changed</th>
                                <th>Change</th>
                            </tr>
                        </thead>
                        <tbody>
            `;
            
            for (const h of data.history.slice(0, 5)) {
                const changeClass = h.percentageChange > 0 ? 'change-up' : h.percentageChange < 0 ? 'change-down' : '';
                const changeText = h.percentageChange !== null 
                    ? (h.percentageChange > 0 ? `+${h.percentageChange}%` : `${h.percentageChange}%`)
                    : '—';
                
                html += `
                    <tr>
                        <td>${formatDate(h.date)}</td>
                        <td>${escapeHtml(h.tierAffected || 'All')}</td>
                        <td>${escapeHtml(h.changeDescription)}</td>
                        <td class="${changeClass}">${changeText}</td>
                    </tr>
                `;
            }
            
            html += `</tbody></table>`;
            
            // Link to full history
            html += `
                <a class="view-full-history" href="/tools/${toolSlug}/pricing-history">
                    View full pricing history →
                </a>
            `;
            
            html += `</div>`;
        }
        
        // Report link
        html += `
            <a class="report-pricing-link" onclick="openReportPricingModal()">📝 Report a Pricing Change or Hidden Cost</a>
        `;
        
        html += '</div>';
        container.innerHTML = html;
        
    } catch (e) {
        console.error('Failed to load pricing:', e);
        container.innerHTML = '<div style="color:#9ca3af;padding:20px;text-align:center;">Unable to load pricing data.</div>';
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

function openReportPricingModal() {
    document.getElementById('reportToolSlug').value = window.pricingToolSlug || '';
    document.getElementById('reportToolName').value = window.pricingToolName || '';
    document.getElementById('reportPricingModal').classList.add('active');
    document.getElementById('reportFormContainer').style.display = 'block';
    document.getElementById('reportSuccess').style.display = 'none';
    document.getElementById('reportError').style.display = 'none';
}

function closeReportPricingModal() {
    document.getElementById('reportPricingModal').classList.remove('active');
}

async function submitPricingReport(e) {
    e.preventDefault();
    
    const form = e.target;
    const btn = form.querySelector('button[type="submit"]');
    const errorDiv = document.getElementById('reportError');
    
    btn.disabled = true;
    btn.textContent = 'Submitting...';
    errorDiv.style.display = 'none';
    
    try {
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());
        
        const res = await fetch(`${PRICING_API}/pricing/report`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Submission failed');
        }
        
        document.getElementById('reportFormContainer').style.display = 'none';
        document.getElementById('reportSuccess').style.display = 'block';
        form.reset();
        
    } catch (err) {
        errorDiv.textContent = err.message;
        errorDiv.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Submit Report';
    }
}

async function subscribePriceAlert(toolSlug) {
    const emailInput = document.getElementById('alertEmail');
    const successDiv = document.getElementById('alertSuccess');
    const errorDiv = document.getElementById('alertError');
    const btn = emailInput.nextElementSibling;
    
    const email = emailInput.value.trim();
    if (!email) {
        errorDiv.textContent = 'Please enter your email';
        errorDiv.style.display = 'block';
        return;
    }
    
    btn.disabled = true;
    btn.textContent = 'Subscribing...';
    errorDiv.style.display = 'none';
    successDiv.style.display = 'none';
    
    try {
        const res = await fetch(`${PRICING_API}/pricing/alerts/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ toolSlug, email })
        });
        
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Subscription failed');
        }
        
        successDiv.style.display = 'block';
        emailInput.value = '';
        
    } catch (err) {
        errorDiv.textContent = err.message;
        errorDiv.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Subscribe';
    }
}

// Close modal on overlay click
document.addEventListener('click', (e) => {
    if (e.target.id === 'reportPricingModal') {
        closeReportPricingModal();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeReportPricingModal();
    }
});
