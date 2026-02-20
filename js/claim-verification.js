// Marketing Claim Verification Component
// Display verified claims, badge status, and submission forms

const CLAIMS_API = 'https://v7086lxsji.execute-api.us-east-1.amazonaws.com';

const CLAIM_STYLES = `
<style>
.claim-verification-section {
    margin: 32px 0;
}
.claim-verification-section h2 {
    font-family: 'Merriweather', Georgia, serif;
    font-size: 1.25rem;
    font-weight: 700;
    color: #0f2744;
    margin-bottom: 16px;
}

/* Badge */
.claim-badge-container {
    margin-bottom: 20px;
}
.claim-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.95rem;
}
.claim-badge.green { background: #d1fae5; color: #065f46; }
.claim-badge.yellow { background: #fef3c7; color: #92400e; }
.claim-badge.red { background: #fee2e2; color: #991b1b; }
.claim-badge.none { background: #f3f4f6; color: #6b7280; }
.claim-subtitle {
    font-size: 0.85rem;
    color: #9ca3af;
    margin-top: 8px;
    line-height: 1.5;
}

/* Claims Table */
.claims-table {
    width: 100%;
    border-collapse: collapse;
    margin: 20px 0;
    font-size: 0.9rem;
}
.claims-table th,
.claims-table td {
    text-align: left;
    padding: 12px;
    border-bottom: 1px solid #e5e7eb;
    vertical-align: top;
}
.claims-table th {
    background: #f9fafb;
    font-weight: 600;
    color: #4b5563;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}
.claims-table .claim-text {
    font-style: italic;
    color: #4b5563;
    max-width: 300px;
}
.claims-table .claim-type {
    font-size: 0.8rem;
    padding: 3px 8px;
    border-radius: 4px;
    background: #f3f4f6;
    color: #6b7280;
    display: inline-block;
}
.claims-table .verdict {
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 0.85rem;
    display: inline-block;
}
.claims-table .verdict.verified { background: #d1fae5; color: #065f46; }
.claims-table .verdict.partial { background: #fef3c7; color: #92400e; }
.claims-table .verdict.unverified { background: #dbeafe; color: #1e40af; }
.claims-table .verdict.false { background: #fee2e2; color: #991b1b; }
.claims-table .evidence-text {
    font-size: 0.85rem;
    color: #6b7280;
    line-height: 1.5;
}
.claims-table .date-tested {
    font-size: 0.8rem;
    color: #9ca3af;
    white-space: nowrap;
}
.claims-table .detail-link {
    font-size: 0.8rem;
    color: #3b82f6;
    text-decoration: none;
}
.claims-table .detail-link:hover { text-decoration: underline; }

/* Unverified Claims Callout */
.unverified-callout {
    background: #fef2f2;
    border: 2px solid #fecaca;
    border-radius: 8px;
    padding: 20px;
    margin: 24px 0;
}
.unverified-callout h4 {
    font-family: 'Inter', sans-serif;
    font-size: 1rem;
    font-weight: 600;
    color: #991b1b;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
}
.unverified-callout .disclaimer {
    font-size: 0.85rem;
    color: #7f1d1d;
    margin-bottom: 16px;
    line-height: 1.6;
}
.unverified-claim-item {
    background: rgba(255,255,255,0.7);
    padding: 12px 16px;
    border-radius: 6px;
    margin-bottom: 8px;
}
.unverified-claim-item:last-child { margin-bottom: 0; }
.unverified-claim-text {
    font-style: italic;
    color: #991b1b;
    margin-bottom: 8px;
}
.unverified-claim-actions {
    display: flex;
    gap: 12px;
    align-items: center;
}
.submit-evidence-btn {
    font-size: 0.8rem;
    color: #3b82f6;
    background: none;
    border: 1px solid #3b82f6;
    padding: 4px 10px;
    border-radius: 4px;
    cursor: pointer;
}
.submit-evidence-btn:hover { background: #eff6ff; }

/* Claim Change Tracker */
.claim-changes {
    margin: 24px 0;
    padding: 20px;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
}
.claim-changes h4 {
    font-family: 'Inter', sans-serif;
    font-size: 0.95rem;
    font-weight: 600;
    color: #0f2744;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
}
.change-log-item {
    padding: 12px;
    background: white;
    border-radius: 6px;
    margin-bottom: 8px;
    border-left: 3px solid #f59e0b;
}
.change-log-item.removed { border-left-color: #ef4444; }
.change-original {
    font-style: italic;
    color: #6b7280;
    margin-bottom: 8px;
}
.change-dates {
    font-size: 0.8rem;
    color: #9ca3af;
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
}

/* Submission Forms */
.claim-submission-section {
    margin: 24px 0;
    padding: 20px;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 8px;
}
.claim-submission-section h4 {
    font-family: 'Inter', sans-serif;
    font-size: 0.95rem;
    font-weight: 600;
    color: #1e40af;
    margin-bottom: 8px;
}
.claim-submission-section p {
    font-size: 0.9rem;
    color: #3b82f6;
    margin-bottom: 16px;
}
.claim-form-group {
    margin-bottom: 12px;
}
.claim-form-group label {
    display: block;
    font-size: 0.85rem;
    font-weight: 500;
    color: #4b5563;
    margin-bottom: 4px;
}
.claim-form-group input,
.claim-form-group textarea {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid #bfdbfe;
    border-radius: 6px;
    font-size: 0.9rem;
    font-family: inherit;
}
.claim-form-group textarea { min-height: 80px; resize: vertical; }
.claim-form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
}
.claim-submit-btn {
    background: #1e40af;
    color: white;
    border: none;
    padding: 10px 20px;
    border-radius: 6px;
    font-weight: 500;
    cursor: pointer;
}
.claim-submit-btn:hover { background: #1e3a8a; }
.claim-submit-btn:disabled { background: #9ca3af; cursor: not-allowed; }
.claim-form-success {
    background: #d1fae5;
    color: #065f46;
    padding: 12px;
    border-radius: 6px;
    margin-bottom: 12px;
    display: none;
}
.claim-form-error {
    background: #fee2e2;
    color: #991b1b;
    padding: 12px;
    border-radius: 6px;
    margin-bottom: 12px;
    display: none;
}

/* Permanent Note */
.claim-permanent-note {
    font-size: 0.8rem;
    color: #9ca3af;
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid #e5e7eb;
    line-height: 1.6;
}

/* Evidence Modal */
.evidence-modal {
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
.evidence-modal.active { display: flex; }
.evidence-modal-content {
    background: white;
    border-radius: 12px;
    max-width: 500px;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
}
.evidence-modal-header {
    padding: 20px 24px;
    border-bottom: 1px solid #e5e7eb;
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.evidence-modal-header h3 {
    font-family: 'Inter', sans-serif;
    font-size: 1rem;
    font-weight: 600;
    color: #0f2744;
}
.evidence-modal-close {
    background: none;
    border: none;
    font-size: 1.5rem;
    cursor: pointer;
    color: #9ca3af;
}
.evidence-modal-body { padding: 24px; }

@media (max-width: 768px) {
    .claims-table { font-size: 0.8rem; }
    .claims-table th, .claims-table td { padding: 8px; }
    .claim-form-row { grid-template-columns: 1fr; }
}
</style>
`;

const VERDICT_LABELS = {
    verified: { label: 'Verified', icon: '✓' },
    partial: { label: 'Partially True', icon: '◐' },
    unverified: { label: 'Unverified', icon: '?' },
    false: { label: 'False', icon: '✗' }
};

const TYPE_LABELS = {
    performance: 'Performance',
    accuracy: 'Accuracy',
    speed: 'Speed',
    cost: 'Cost Savings',
    integration: 'Integration',
    security: 'Security',
    compliance: 'Compliance'
};

function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

async function initClaimVerification(toolSlug, toolName, containerId) {
    // Inject styles
    if (!document.getElementById('claimStyles')) {
        const styleEl = document.createElement('div');
        styleEl.id = 'claimStyles';
        styleEl.innerHTML = CLAIM_STYLES;
        document.head.appendChild(styleEl);
    }
    
    // Store for forms
    window.claimToolSlug = toolSlug;
    window.claimToolName = toolName;
    
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = '<div style="color:#9ca3af;padding:20px;text-align:center;">Loading claim verification...</div>';
    
    try {
        const res = await fetch(`${CLAIMS_API}/claims?toolSlug=${toolSlug}`);
        const data = await res.json();
        
        let html = '<div class="claim-verification-section">';
        html += '<h2>Marketing Claim Verification</h2>';
        
        // Badge
        html += '<div class="claim-badge-container">';
        if (data.claims && data.claims.length > 0) {
            html += `<span class="claim-badge ${data.badge.status}">${data.badge.label}</span>`;
        } else {
            html += `<span class="claim-badge none">No Claims Tested Yet</span>`;
        }
        html += `<p class="claim-subtitle">We identify specific measurable claims made on the vendor's marketing page and test them independently. Results are published regardless of outcome.</p>`;
        html += '</div>';
        
        // Claims Table
        if (data.claims && data.claims.length > 0) {
            html += `
                <table class="claims-table">
                    <thead>
                        <tr>
                            <th>The Claim</th>
                            <th>Type</th>
                            <th>Our Verdict</th>
                            <th>Evidence</th>
                            <th>Tested</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            
            for (const claim of data.claims) {
                const verdictInfo = VERDICT_LABELS[claim.verdict] || { label: claim.verdict, icon: '?' };
                const typeLabel = TYPE_LABELS[claim.claimType] || claim.claimType;
                
                html += `
                    <tr>
                        <td class="claim-text">"${escapeHtml(claim.claimText)}"</td>
                        <td><span class="claim-type">${typeLabel}</span></td>
                        <td><span class="verdict ${claim.verdict}">${verdictInfo.icon} ${verdictInfo.label}</span></td>
                        <td class="evidence-text">
                            ${escapeHtml(claim.evidence || 'Details pending')}
                            ${claim.methodology ? `<br><a href="#" class="detail-link" onclick="showMethodology('${claim.claimId}', '${toolSlug}'); return false;">View full test methodology →</a>` : ''}
                        </td>
                        <td class="date-tested">${formatDate(claim.testedAt)}</td>
                    </tr>
                `;
            }
            
            html += '</tbody></table>';
        }
        
        // Unverified/False Claims Callout
        if (data.unverifiedOrFalse && data.unverifiedOrFalse.length > 0) {
            html += `
                <div class="unverified-callout">
                    <h4>⚠️ Claims We Could Not Verify</h4>
                    <p class="disclaimer">The following claims appear on this vendor's marketing materials. Our independent testing was unable to verify them. This does not necessarily mean the claims are false — it means we could not confirm them using our methodology. Vendors may submit evidence to support their claims through our verification portal.</p>
            `;
            
            for (const claim of data.unverifiedOrFalse) {
                html += `
                    <div class="unverified-claim-item">
                        <div class="unverified-claim-text">"${escapeHtml(claim.claimText)}"</div>
                        <div class="unverified-claim-actions">
                            <span class="verdict ${claim.verdict}">${VERDICT_LABELS[claim.verdict]?.icon || '?'} ${VERDICT_LABELS[claim.verdict]?.label || claim.verdict}</span>
                            <button class="submit-evidence-btn" onclick="openEvidenceModal('${claim.claimId}', '${escapeHtml(claim.claimText).replace(/'/g, "\\'")}')">Submit Evidence</button>
                        </div>
                    </div>
                `;
            }
            
            html += '</div>';
        }
        
        // Claim Change Tracker
        if (data.changes && data.changes.length > 0) {
            html += `
                <div class="claim-changes">
                    <h4>🔄 Claim Change Tracker</h4>
                    <p style="font-size:0.85rem;color:#6b7280;margin-bottom:12px;">Claims that were modified or removed after our verdict was published.</p>
            `;
            
            for (const change of data.changes) {
                html += `
                    <div class="change-log-item ${change.changeType}">
                        <div class="change-original">"${escapeHtml(change.originalClaim)}"</div>
                        <div class="change-dates">
                            <span>📝 Claim published: ${formatDate(change.claimPublishedDate)}</span>
                            <span>⚖️ Our verdict: ${formatDate(change.verdictPublishedDate)}</span>
                            <span>🔄 ${change.changeType === 'removed' ? 'Removed' : 'Modified'}: ${formatDate(change.detectedAt)}</span>
                        </div>
                    </div>
                `;
            }
            
            html += '</div>';
        }
        
        // Community Claim Submission
        html += `
            <div class="claim-submission-section">
                <h4>🚩 Flag a Marketing Claim</h4>
                <p>Believe a marketing claim is inaccurate or misleading? Submit it for editor review. Include the specific claim and your evidence.</p>
                <div class="claim-form-success" id="claimFormSuccess">✓ Thank you! Your submission has been received and will be reviewed.</div>
                <div class="claim-form-error" id="claimFormError"></div>
                <form id="claimSubmitForm" onsubmit="submitClaim(event)">
                    <div class="claim-form-group">
                        <label>The Specific Claim *</label>
                        <textarea name="claimText" required placeholder='Copy the exact text from the vendor\'s marketing page, e.g., "Our AI achieves 99% accuracy on standard benchmarks"'></textarea>
                    </div>
                    <div class="claim-form-group">
                        <label>Link to Where It Appears</label>
                        <input type="url" name="claimUrl" placeholder="https://vendor.com/pricing">
                    </div>
                    <div class="claim-form-group">
                        <label>Your Evidence or Reasoning *</label>
                        <textarea name="reasoning" required placeholder="Explain why you believe this claim may be inaccurate, including any evidence you have"></textarea>
                    </div>
                    <div class="claim-form-row">
                        <div class="claim-form-group">
                            <label>Your Name *</label>
                            <input type="text" name="submitterName" required placeholder="Jane Smith">
                        </div>
                        <div class="claim-form-group">
                            <label>Professional Email *</label>
                            <input type="email" name="submitterEmail" required placeholder="jane@company.com">
                        </div>
                    </div>
                    <button type="submit" class="claim-submit-btn">Submit for Review</button>
                </form>
            </div>
        `;
        
        // Permanent Note
        html += `
            <p class="claim-permanent-note">
                <strong>Claim verification records are permanent.</strong> ToolIntel does not remove verified, partially verified, or false verdicts at vendor request. 
                Vendors may submit evidence to request a re-evaluation — they may not request removal.
            </p>
        `;
        
        html += '</div>';
        
        // Evidence Modal
        html += `
            <div class="evidence-modal" id="evidenceModal">
                <div class="evidence-modal-content">
                    <div class="evidence-modal-header">
                        <h3>📄 Submit Vendor Evidence</h3>
                        <button class="evidence-modal-close" onclick="closeEvidenceModal()">×</button>
                    </div>
                    <div class="evidence-modal-body">
                        <p style="font-size:0.9rem;color:#6b7280;margin-bottom:16px;">
                            Submit documentation, third-party test results, or methodology explanations to support this claim. 
                            All submissions are reviewed by editors and decisions are logged publicly.
                        </p>
                        <div class="claim-form-success" id="evidenceFormSuccess">✓ Evidence submitted. We will review and respond.</div>
                        <div class="claim-form-error" id="evidenceFormError"></div>
                        <form id="evidenceSubmitForm" onsubmit="submitEvidence(event)">
                            <input type="hidden" name="claimId" id="evidenceClaimId">
                            <div class="claim-form-group">
                                <label>Claim Being Contested</label>
                                <div id="evidenceClaimText" style="font-style:italic;color:#6b7280;padding:8px;background:#f9fafb;border-radius:4px;"></div>
                            </div>
                            <div class="claim-form-group">
                                <label>Evidence Type</label>
                                <select name="evidenceType">
                                    <option value="documentation">Internal Documentation</option>
                                    <option value="third-party">Third-Party Test Results</option>
                                    <option value="methodology">Methodology Explanation</option>
                                    <option value="benchmark">Benchmark Data</option>
                                    <option value="other">Other</option>
                                </select>
                            </div>
                            <div class="claim-form-group">
                                <label>Evidence Description *</label>
                                <textarea name="evidenceDescription" required placeholder="Describe your evidence and how it supports the claim"></textarea>
                            </div>
                            <div class="claim-form-group">
                                <label>Link to Evidence (if available)</label>
                                <input type="url" name="evidenceUrl" placeholder="https://...">
                            </div>
                            <div class="claim-form-row">
                                <div class="claim-form-group">
                                    <label>Your Name *</label>
                                    <input type="text" name="vendorName" required placeholder="Company Representative">
                                </div>
                                <div class="claim-form-group">
                                    <label>Vendor Email *</label>
                                    <input type="email" name="vendorEmail" required placeholder="contact@vendor.com">
                                </div>
                            </div>
                            <button type="submit" class="claim-submit-btn">Submit Evidence</button>
                        </form>
                    </div>
                </div>
            </div>
        `;
        
        container.innerHTML = html;
        
    } catch (e) {
        console.error('Failed to load claim verification:', e);
        container.innerHTML = '<div style="color:#9ca3af;padding:20px;text-align:center;">Unable to load claim verification data.</div>';
    }
}

async function submitClaim(e) {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button[type="submit"]');
    const successDiv = document.getElementById('claimFormSuccess');
    const errorDiv = document.getElementById('claimFormError');
    
    btn.disabled = true;
    btn.textContent = 'Submitting...';
    successDiv.style.display = 'none';
    errorDiv.style.display = 'none';
    
    try {
        const formData = new FormData(form);
        const data = {
            toolSlug: window.claimToolSlug,
            toolName: window.claimToolName,
            ...Object.fromEntries(formData.entries())
        };
        
        const res = await fetch(`${CLAIMS_API}/claims/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Submission failed');
        }
        
        successDiv.style.display = 'block';
        form.reset();
        
    } catch (err) {
        errorDiv.textContent = err.message;
        errorDiv.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Submit for Review';
    }
}

function openEvidenceModal(claimId, claimText) {
    document.getElementById('evidenceClaimId').value = claimId;
    document.getElementById('evidenceClaimText').textContent = '"' + claimText + '"';
    document.getElementById('evidenceModal').classList.add('active');
    document.getElementById('evidenceFormSuccess').style.display = 'none';
    document.getElementById('evidenceFormError').style.display = 'none';
}

function closeEvidenceModal() {
    document.getElementById('evidenceModal').classList.remove('active');
    document.getElementById('evidenceSubmitForm').reset();
}

async function submitEvidence(e) {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button[type="submit"]');
    const successDiv = document.getElementById('evidenceFormSuccess');
    const errorDiv = document.getElementById('evidenceFormError');
    
    btn.disabled = true;
    btn.textContent = 'Submitting...';
    successDiv.style.display = 'none';
    errorDiv.style.display = 'none';
    
    try {
        const formData = new FormData(form);
        const data = {
            toolSlug: window.claimToolSlug,
            ...Object.fromEntries(formData.entries())
        };
        
        const res = await fetch(`${CLAIMS_API}/claims/evidence`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Submission failed');
        }
        
        successDiv.style.display = 'block';
        form.reset();
        setTimeout(closeEvidenceModal, 2000);
        
    } catch (err) {
        errorDiv.textContent = err.message;
        errorDiv.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Submit Evidence';
    }
}

async function showMethodology(claimId, toolSlug) {
    try {
        const res = await fetch(`${CLAIMS_API}/claims/detail?claimId=${claimId}&toolSlug=${toolSlug}`);
        const data = await res.json();
        
        if (data.claim && data.claim.methodology) {
            alert('Test Methodology:\n\n' + data.claim.methodology);
        } else {
            alert('Detailed methodology not available for this claim.');
        }
    } catch (e) {
        alert('Unable to load methodology details.');
    }
}

// Close modal handlers
document.addEventListener('click', (e) => {
    if (e.target.id === 'evidenceModal') closeEvidenceModal();
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeEvidenceModal();
});
