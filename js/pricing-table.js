// Dynamic Verified Pricing Table Component
// Include on tool pages to show verified pricing with history

const PRICING_API = 'https://v7086lxsji.execute-api.us-east-1.amazonaws.com';

const PRICING_STYLES = `
<style>
.verified-pricing-section {
    margin: 24px 0;
}
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
.pricing-stale-warning .icon {
    font-size: 1.5rem;
}
.pricing-stale-warning .text {
    flex: 1;
    font-size: 0.9rem;
    color: #92400e;
}
.pricing-stale-warning a {
    color: #b45309;
    font-weight: 500;
}

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
.pricing-table td {
    font-size: 0.95rem;
}
.pricing-table .tier-name {
    font-weight: 600;
    color: #0f2744;
}
.pricing-table .tier-price {
    font-weight: 700;
    color: #0f2744;
    font-size: 1.1rem;
}
.pricing-table .hidden-costs {
    color: #9ca3af;
    font-size: 0.85rem;
    font-style: italic;
}
.pricing-verified-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.75rem;
    color: #065f46;
    background: #d1fae5;
    padding: 4px 10px;
    border-radius: 4px;
    margin-left: 8px;
}
.pricing-verified-badge.stale {
    background: #fef3c7;
    color: #92400e;
}

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
.pricing-history .change-up {
    color: #dc2626;
    font-weight: 500;
}
.pricing-history .change-down {
    color: #059669;
    font-weight: 500;
}

.report-pricing-link {
    display: inline-block;
    margin-top: 16px;
    color: #3b82f6;
    font-size: 0.9rem;
    cursor: pointer;
    text-decoration: none;
}
.report-pricing-link:hover {
    text-decoration: underline;
}

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
.report-form-modal.active {
    display: flex;
}
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
.report-form-body {
    padding: 24px;
}
.report-form-group {
    margin-bottom: 16px;
}
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
.report-submit-btn:hover {
    background: #1e3a5f;
}
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
        
        // Setup form
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
        
        // Pricing table
        html += `
            <table class="pricing-table">
                <thead>
                    <tr>
                        <th>Tier</th>
                        <th>Price
                            <span class="pricing-verified-badge ${data.isStale ? 'stale' : ''}">
                                ${data.isStale ? '⚠️' : '✓'} Verified: ${data.current.verifiedAt ? formatDate(data.current.verifiedAt) : 'N/A'}
                            </span>
                        </th>
                        <th>What You Get</th>
                        <th>Hidden Costs?</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        for (const tier of data.current.tiers || []) {
            html += `
                <tr>
                    <td class="tier-name">${escapeHtml(tier.name)}</td>
                    <td class="tier-price">${escapeHtml(tier.price)}</td>
                    <td>${escapeHtml(tier.features)}</td>
                    <td class="hidden-costs">${escapeHtml(tier.hiddenCosts || 'None noted')}</td>
                </tr>
            `;
        }
        
        html += '</tbody></table>';
        
        // Pricing history
        if (data.history && data.history.length > 0) {
            html += `
                <div class="pricing-history">
                    <h4>📈 Pricing History</h4>
                    <table>
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>What Changed</th>
                                <th>Change</th>
                            </tr>
                        </thead>
                        <tbody>
            `;
            
            for (const h of data.history) {
                const changeClass = h.percentageChange > 0 ? 'change-up' : h.percentageChange < 0 ? 'change-down' : '';
                const changeText = h.percentageChange !== null 
                    ? (h.percentageChange > 0 ? `+${h.percentageChange}%` : `${h.percentageChange}%`)
                    : '—';
                
                html += `
                    <tr>
                        <td>${formatDate(h.date)}</td>
                        <td>${escapeHtml(h.changeDescription)}</td>
                        <td class="${changeClass}">${changeText}</td>
                    </tr>
                `;
            }
            
            html += '</tbody></table></div>';
        }
        
        // Report link
        html += `
            <a class="report-pricing-link" onclick="openReportPricingModal()">📝 Report a Pricing Change</a>
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
