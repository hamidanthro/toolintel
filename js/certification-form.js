// Certification Submission Form Component
// Include this script on any tool page to enable certification submission

const CERT_API = 'https://v7086lxsji.execute-api.us-east-1.amazonaws.com';

const CERT_FORM_STYLES = `
<style>
.cert-submit-section {
    margin-top: 32px;
    padding: 24px;
    background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
    border: 1px solid #0ea5e9;
    border-radius: 12px;
}
.cert-submit-section h4 {
    font-family: 'Inter', sans-serif;
    font-size: 1.1rem;
    font-weight: 600;
    color: #0c4a6e;
    margin-bottom: 8px;
}
.cert-submit-section p {
    font-size: 0.9rem;
    color: #0369a1;
    margin-bottom: 16px;
}
.cert-submit-btn {
    background: #0f2744;
    color: white;
    border: none;
    padding: 12px 24px;
    border-radius: 6px;
    font-size: 0.95rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
}
.cert-submit-btn:hover {
    background: #1e3a5f;
}

.cert-modal-overlay {
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
.cert-modal-overlay.active {
    display: flex;
}
.cert-modal {
    background: white;
    border-radius: 12px;
    max-width: 600px;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 25px 50px rgba(0,0,0,0.25);
}
.cert-modal-header {
    padding: 20px 24px;
    border-bottom: 1px solid #e5e7eb;
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.cert-modal-header h3 {
    font-family: 'Inter', sans-serif;
    font-size: 1.25rem;
    font-weight: 600;
    color: #0f2744;
}
.cert-modal-close {
    background: none;
    border: none;
    font-size: 1.5rem;
    cursor: pointer;
    color: #9ca3af;
}
.cert-modal-close:hover {
    color: #4b5563;
}
.cert-modal-body {
    padding: 24px;
}
.cert-pricing-notice {
    background: #fef3c7;
    border: 1px solid #fcd34d;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 24px;
    font-size: 0.9rem;
    color: #92400e;
}
.cert-pricing-notice strong {
    display: block;
    margin-bottom: 4px;
}
.cert-form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 16px;
}
.cert-form-group {
    margin-bottom: 16px;
}
.cert-form-group label {
    display: block;
    font-size: 0.9rem;
    font-weight: 500;
    color: #4b5563;
    margin-bottom: 6px;
}
.cert-form-group input,
.cert-form-group select {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    font-size: 0.95rem;
    font-family: inherit;
}
.cert-form-group input:focus,
.cert-form-group select:focus {
    outline: none;
    border-color: #3b82f6;
}
.cert-file-input {
    border: 2px dashed #e5e7eb;
    border-radius: 8px;
    padding: 24px;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s;
}
.cert-file-input:hover {
    border-color: #3b82f6;
    background: #f9fafb;
}
.cert-file-input.has-file {
    border-color: #10b981;
    background: #d1fae5;
}
.cert-file-input input {
    display: none;
}
.cert-disclosure {
    padding: 16px;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    margin-bottom: 20px;
}
.cert-disclosure label {
    display: flex;
    align-items: start;
    gap: 12px;
    cursor: pointer;
    font-size: 0.85rem;
    color: #4b5563;
    line-height: 1.5;
}
.cert-disclosure input {
    margin-top: 3px;
    width: 18px;
    height: 18px;
    flex-shrink: 0;
}
.cert-submit-form-btn {
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
.cert-submit-form-btn:hover {
    background: #1e3a5f;
}
.cert-submit-form-btn:disabled {
    background: #9ca3af;
    cursor: not-allowed;
}
.cert-success {
    text-align: center;
    padding: 40px 24px;
}
.cert-success h4 {
    color: #065f46;
    margin-bottom: 12px;
}
.cert-success p {
    color: #4b5563;
    margin-bottom: 8px;
}
.cert-error {
    background: #fee2e2;
    color: #991b1b;
    padding: 12px;
    border-radius: 6px;
    margin-bottom: 16px;
    display: none;
}
@media (max-width: 600px) {
    .cert-form-row {
        grid-template-columns: 1fr;
    }
}
</style>
`;

const CERT_FORM_HTML = `
<div class="cert-modal-overlay" id="certModalOverlay">
    <div class="cert-modal">
        <div class="cert-modal-header">
            <h3>🔐 Submit Certification for Verification</h3>
            <button class="cert-modal-close" onclick="closeCertModal()">×</button>
        </div>
        <div class="cert-modal-body">
            <div class="cert-pricing-notice">
                <strong>💰 Verification Fee: $199 per certificate</strong>
                You will be invoiced by email after submission is reviewed for completeness. Verification is completed within 10 business days. Payment does not guarantee approval — rejected submissions receive a 50% refund.
            </div>
            
            <div class="cert-error" id="certError"></div>
            
            <div id="certFormContainer">
                <form id="certForm">
                    <div class="cert-form-row">
                        <div class="cert-form-group">
                            <label>Company Name *</label>
                            <input type="text" name="companyName" required placeholder="Acme AI Inc.">
                        </div>
                        <div class="cert-form-group">
                            <label>Tool Name *</label>
                            <input type="text" name="toolName" required id="certToolName">
                        </div>
                    </div>
                    
                    <div class="cert-form-group">
                        <label>Certification Type *</label>
                        <select name="certType" required>
                            <option value="">Select certification...</option>
                            <option value="SOC 2 Type I">SOC 2 Type I</option>
                            <option value="SOC 2 Type II">SOC 2 Type II</option>
                            <option value="ISO 27001">ISO 27001</option>
                            <option value="HIPAA BAA">HIPAA BAA</option>
                            <option value="GDPR Compliance Documentation">GDPR Compliance Documentation</option>
                            <option value="EU AI Act Conformity Assessment">EU AI Act Conformity Assessment</option>
                            <option value="FedRAMP">FedRAMP</option>
                            <option value="HITRUST">HITRUST</option>
                            <option value="Other">Other</option>
                        </select>
                    </div>
                    
                    <div class="cert-form-group">
                        <label>Issuing Body Name *</label>
                        <input type="text" name="issuingBody" required placeholder="e.g., Schellman & Company">
                    </div>
                    
                    <div class="cert-form-row">
                        <div class="cert-form-group">
                            <label>Audit Date *</label>
                            <input type="date" name="auditDate" required>
                        </div>
                        <div class="cert-form-group">
                            <label>Expiration Date *</label>
                            <input type="date" name="expirationDate" required>
                        </div>
                    </div>
                    
                    <div class="cert-form-group">
                        <label>Certificate Document (PDF only, max 10MB) *</label>
                        <div class="cert-file-input" id="certFileInput">
                            <input type="file" id="certFile" accept=".pdf" required>
                            <div id="certFileLabel">📄 Click to upload PDF certificate</div>
                        </div>
                    </div>
                    
                    <div class="cert-form-group">
                        <label>Contact Email (for verification follow-up) *</label>
                        <input type="email" name="contactEmail" required placeholder="compliance@company.com">
                    </div>
                    
                    <div class="cert-disclosure">
                        <label>
                            <input type="checkbox" name="confirmation" required>
                            <span>I confirm this certification is current, was issued by the named body, and I am authorized to submit it on behalf of this company.</span>
                        </label>
                    </div>
                    
                    <button type="submit" class="cert-submit-form-btn" id="certSubmitBtn">Submit for Verification ($199)</button>
                </form>
            </div>
            
            <div id="certSuccess" style="display: none;" class="cert-success">
                <h4>✓ Submission Received</h4>
                <p>Your certification has been submitted for verification.</p>
                <p>Our team will review your submission and invoice you at the provided email within 2 business days.</p>
                <p>Verification is typically completed within 10 business days after payment.</p>
                <button class="cert-submit-form-btn" onclick="closeCertModal()" style="margin-top: 20px;">Close</button>
            </div>
        </div>
    </div>
</div>
`;

function initCertificationForm(toolSlug, toolName) {
    // Inject styles and modal HTML
    if (!document.getElementById('certFormStyles')) {
        const styleEl = document.createElement('div');
        styleEl.id = 'certFormStyles';
        styleEl.innerHTML = CERT_FORM_STYLES;
        document.head.appendChild(styleEl);
    }
    
    if (!document.getElementById('certModalOverlay')) {
        const modalEl = document.createElement('div');
        modalEl.innerHTML = CERT_FORM_HTML;
        document.body.appendChild(modalEl.firstElementChild);
    }
    
    // Store tool info
    window.certToolSlug = toolSlug;
    window.certToolName = toolName;
    
    // Setup file input
    const fileInput = document.getElementById('certFile');
    const fileLabel = document.getElementById('certFileLabel');
    const fileContainer = document.getElementById('certFileInput');
    
    fileContainer.onclick = () => fileInput.click();
    fileInput.onchange = () => {
        if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            if (file.size > 10 * 1024 * 1024) {
                alert('File too large. Maximum size is 10MB.');
                fileInput.value = '';
                return;
            }
            fileLabel.textContent = '✓ ' + file.name;
            fileContainer.classList.add('has-file');
        }
    };
    
    // Setup form submission
    document.getElementById('certForm').onsubmit = submitCertification;
}

function openCertModal() {
    document.getElementById('certToolName').value = window.certToolName || '';
    document.getElementById('certModalOverlay').classList.add('active');
    document.getElementById('certFormContainer').style.display = 'block';
    document.getElementById('certSuccess').style.display = 'none';
    document.getElementById('certError').style.display = 'none';
}

function closeCertModal() {
    document.getElementById('certModalOverlay').classList.remove('active');
}

async function submitCertification(e) {
    e.preventDefault();
    
    const form = e.target;
    const btn = document.getElementById('certSubmitBtn');
    const errorDiv = document.getElementById('certError');
    
    btn.disabled = true;
    btn.textContent = 'Uploading...';
    errorDiv.style.display = 'none';
    
    try {
        // Get presigned URL for PDF upload
        const file = document.getElementById('certFile').files[0];
        const urlRes = await fetch(`${CERT_API}/certifications/upload-url?filename=${encodeURIComponent(file.name)}`);
        const { uploadUrl, key } = await urlRes.json();
        
        // Upload PDF to S3
        btn.textContent = 'Uploading certificate...';
        const uploadRes = await fetch(uploadUrl, {
            method: 'PUT',
            body: file,
            headers: { 'Content-Type': 'application/pdf' }
        });
        
        if (!uploadRes.ok) throw new Error('Failed to upload certificate');
        
        // Submit certification data
        btn.textContent = 'Submitting...';
        const formData = new FormData(form);
        const data = {
            toolSlug: window.certToolSlug,
            companyName: formData.get('companyName'),
            toolName: formData.get('toolName'),
            certType: formData.get('certType'),
            issuingBody: formData.get('issuingBody'),
            auditDate: formData.get('auditDate'),
            expirationDate: formData.get('expirationDate'),
            pdfKey: key,
            contactEmail: formData.get('contactEmail'),
            confirmation: formData.get('confirmation') === 'on'
        };
        
        const res = await fetch(`${CERT_API}/certifications`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Submission failed');
        }
        
        // Show success
        document.getElementById('certFormContainer').style.display = 'none';
        document.getElementById('certSuccess').style.display = 'block';
        form.reset();
        document.getElementById('certFileLabel').textContent = '📄 Click to upload PDF certificate';
        document.getElementById('certFileInput').classList.remove('has-file');
        
    } catch (err) {
        errorDiv.textContent = err.message;
        errorDiv.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Submit for Verification ($199)';
    }
}

// Close modal on overlay click
document.addEventListener('click', (e) => {
    if (e.target.id === 'certModalOverlay') {
        closeCertModal();
    }
});

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeCertModal();
    }
});
