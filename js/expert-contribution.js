// ToolIntel Expert Contribution Component
// Feature 14: Display expert analysis on review pages

const EXPERTS_API = 'https://v7086lxsji.execute-api.us-east-1.amazonaws.com/experts';

async function initExpertContributions(toolSlug, toolName, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  try {
    const response = await fetch(`${EXPERTS_API}/contributions/${toolSlug}`);
    const data = await response.json();

    if (data.contributions && data.contributions.length > 0) {
      renderContributions(container, data.contributions, toolSlug, toolName);
    } else {
      renderRequestSection(container, toolSlug, toolName);
    }
  } catch (error) {
    console.error('Failed to load expert contributions:', error);
    renderRequestSection(container, toolSlug, toolName);
  }
}

function renderContributions(container, contributions, toolSlug, toolName) {
  container.innerHTML = `
    <div class="expert-contributions-section">
      <div class="expert-section-header">
        <h2>🎓 Expert Contributor Analysis</h2>
        <p class="expert-disclaimer">The following analysis was contributed by an independent domain expert. It represents their professional assessment and may differ from the editorial score. Expert contributions do not change the editorial score but are published in full alongside it.</p>
      </div>
      
      ${contributions.map(contrib => renderContribution(contrib)).join('')}
      
      <div class="expert-footer">
        <p class="unpaid-note">Expert contributors are unpaid volunteers who contribute to advance the quality of independent AI tool intelligence. ToolIntel does not compensate contributors financially. Contributors may not solicit business from vendors whose tools they have reviewed for a period of 12 months following publication.</p>
        <button class="request-expert-btn" onclick="showRequestForm('${toolSlug}', '${toolName}')">📝 Request Additional Expert Review</button>
      </div>
    </div>
  `;
  
  addExpertStyles();
}

function renderContribution(contrib) {
  const sections = contrib.sections;
  
  return `
    <div class="expert-contribution">
      <div class="expert-meta">
        <div class="expert-info">
          <div class="expert-avatar">${getInitials(contrib.expertName)}</div>
          <div>
            <div class="expert-name">${contrib.expertName}</div>
            <div class="expert-title">${contrib.expertTitle}</div>
            <div class="expertise-tag">${contrib.expertiseTag}</div>
          </div>
        </div>
        <div class="contrib-date">
          Submitted: ${formatDate(contrib.submittedAt)}<br>
          Approved: ${formatDate(contrib.approvedAt)}
        </div>
      </div>
      
      <div class="contribution-sections">
        <div class="contrib-section">
          <h4>🔬 What I Tested and How</h4>
          <p>${sections.methodology}</p>
        </div>
        
        <div class="contrib-section">
          <h4>📊 What I Found</h4>
          <p>${sections.findings}</p>
        </div>
        
        <div class="contrib-section agreement">
          <h4>✅ Where I Agree with the ToolIntel Editorial Score</h4>
          <p>${sections.agreementAreas}</p>
        </div>
        
        <div class="contrib-section disagreement">
          <h4>⚠️ Where I See It Differently</h4>
          <p>${sections.disagreementAreas}</p>
        </div>
        
        <div class="contrib-section domain-insight">
          <h4>💡 What Buyers in My Domain Should Know</h4>
          <p>${sections.domainInsights}</p>
        </div>
      </div>
      
      <div class="contrib-links">
        <a href="/expert-network.html">View all expert contributors →</a>
      </div>
    </div>
  `;
}

function renderRequestSection(container, toolSlug, toolName) {
  container.innerHTML = `
    <div class="expert-request-section">
      <div class="request-header">
        <h3>🎓 Request Expert Analysis</h3>
        <p>No expert contributions yet for ${toolName}. Request domain-specific analysis from our verified expert network.</p>
      </div>
      <button class="request-expert-btn primary" onclick="showRequestForm('${toolSlug}', '${toolName}')">Request Expert Review</button>
    </div>
  `;
  
  addExpertStyles();
}

function showRequestForm(toolSlug, toolName) {
  // Check if modal already exists
  let modal = document.getElementById('expertRequestModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'expertRequestModal';
    modal.className = 'expert-modal';
    document.body.appendChild(modal);
  }
  
  modal.innerHTML = `
    <div class="expert-modal-content">
      <button class="modal-close" onclick="closeExpertModal()">×</button>
      <h3>Request Expert Review for ${toolName}</h3>
      <p class="modal-info">Specify what domain expertise you'd like applied to this review. When 3+ users request the same expertise, it becomes a priority in our expert assignment queue.</p>
      
      <form id="expertRequestForm" onsubmit="submitExpertRequest(event, '${toolSlug}')">
        <div class="form-group">
          <label>Domain Expertise Needed</label>
          <select id="expertiseRequest" required>
            <option value="">Select expertise area...</option>
            <option value="AI Security">AI Security</option>
            <option value="Healthcare AI">Healthcare AI</option>
            <option value="Legal AI">Legal AI</option>
            <option value="Financial AI">Financial AI</option>
            <option value="NLP and Language Models">NLP & Language Models</option>
            <option value="Computer Vision">Computer Vision</option>
            <option value="AI Ethics and Bias">AI Ethics & Bias</option>
            <option value="Regulatory Compliance">Regulatory Compliance</option>
            <option value="Enterprise Architecture">Enterprise Architecture</option>
            <option value="Developer Tools">Developer Tools</option>
            <option value="Data Privacy Law">Data Privacy Law</option>
          </select>
        </div>
        
        <div class="form-group">
          <label>What would you like the expert to analyze? (Optional)</label>
          <textarea id="requestReason" rows="3" placeholder="e.g., I would like a healthcare compliance expert to review this tool's HIPAA documentation."></textarea>
        </div>
        
        <button type="submit" class="submit-request-btn">Submit Request</button>
      </form>
    </div>
  `;
  
  modal.classList.add('active');
}

function closeExpertModal() {
  const modal = document.getElementById('expertRequestModal');
  if (modal) {
    modal.classList.remove('active');
  }
}

async function submitExpertRequest(event, toolSlug) {
  event.preventDefault();
  
  const expertise = document.getElementById('expertiseRequest').value;
  const reason = document.getElementById('requestReason').value;
  const userId = localStorage.getItem('toolintel_user') || 'anonymous';
  
  try {
    const response = await fetch(`${EXPERTS_API}/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolSlug,
        userId,
        expertiseRequested: expertise,
        reason
      })
    });
    
    if (response.ok) {
      const modal = document.getElementById('expertRequestModal');
      modal.querySelector('.expert-modal-content').innerHTML = `
        <div style="text-align: center; padding: 30px;">
          <div style="font-size: 3em; margin-bottom: 20px;">✓</div>
          <h3>Request Submitted</h3>
          <p style="color: #6b7280; margin: 15px 0;">Your request for ${expertise} analysis has been recorded. Requests are aggregated and prioritized based on demand.</p>
          <button onclick="closeExpertModal()" style="background: #0d9488; color: white; border: none; padding: 10px 24px; border-radius: 6px; cursor: pointer; margin-top: 10px;">Close</button>
        </div>
      `;
    } else {
      throw new Error('Failed to submit request');
    }
  } catch (error) {
    alert('Failed to submit request. Please try again.');
  }
}

function getInitials(name) {
  return name.split(' ').map(n => n[0]).join('').substring(0, 2);
}

function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function addExpertStyles() {
  if (document.getElementById('expert-contribution-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'expert-contribution-styles';
  style.textContent = `
    .expert-contributions-section {
      background: linear-gradient(135deg, #0f3d3d 0%, #0a2a2a 100%);
      border: 2px solid #0d9488;
      border-radius: 12px;
      padding: 30px;
      margin: 30px 0;
    }
    .expert-section-header h2 {
      color: #5eead4;
      font-size: 1.4rem;
      margin-bottom: 12px;
    }
    .expert-disclaimer {
      background: rgba(255,255,255,0.05);
      padding: 15px;
      border-radius: 8px;
      font-size: 0.9rem;
      color: #94a3b8;
      line-height: 1.6;
      margin-bottom: 25px;
    }
    
    .expert-contribution {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 10px;
      padding: 25px;
      margin-bottom: 20px;
    }
    
    .expert-meta {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 20px;
      padding-bottom: 15px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .expert-info {
      display: flex;
      gap: 15px;
      align-items: center;
    }
    .expert-avatar {
      width: 50px;
      height: 50px;
      background: linear-gradient(135deg, #0d9488, #14b8a6);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.1rem;
      font-weight: 600;
      color: white;
    }
    .expert-name {
      font-weight: 600;
      color: white;
      font-size: 1.1rem;
    }
    .expert-title {
      color: #94a3b8;
      font-size: 0.9rem;
    }
    .expertise-tag {
      display: inline-block;
      background: rgba(13, 148, 136, 0.3);
      color: #5eead4;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 0.8rem;
      margin-top: 5px;
    }
    .contrib-date {
      color: #6b7280;
      font-size: 0.85rem;
      text-align: right;
    }
    
    .contribution-sections {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .contrib-section {
      padding: 15px;
      background: rgba(255,255,255,0.02);
      border-radius: 8px;
    }
    .contrib-section h4 {
      color: #d1d5db;
      font-size: 0.95rem;
      margin-bottom: 10px;
    }
    .contrib-section p {
      color: #9ca3af;
      font-size: 0.95rem;
      line-height: 1.7;
    }
    .contrib-section.agreement {
      border-left: 3px solid #10b981;
    }
    .contrib-section.disagreement {
      border-left: 3px solid #f59e0b;
    }
    .contrib-section.domain-insight {
      border-left: 3px solid #3b82f6;
      background: rgba(59, 130, 246, 0.05);
    }
    
    .contrib-links {
      margin-top: 15px;
      padding-top: 15px;
      border-top: 1px solid rgba(255,255,255,0.1);
    }
    .contrib-links a {
      color: #5eead4;
      text-decoration: none;
      font-size: 0.9rem;
    }
    .contrib-links a:hover {
      text-decoration: underline;
    }
    
    .expert-footer {
      margin-top: 25px;
      padding-top: 20px;
      border-top: 1px solid rgba(255,255,255,0.1);
    }
    .unpaid-note {
      color: #6b7280;
      font-size: 0.85rem;
      font-style: italic;
      margin-bottom: 15px;
      line-height: 1.6;
    }
    
    .expert-request-section {
      background: #1f2937;
      border: 1px solid #374151;
      border-radius: 12px;
      padding: 25px;
      margin: 30px 0;
      text-align: center;
    }
    .request-header h3 {
      color: white;
      margin-bottom: 10px;
    }
    .request-header p {
      color: #9ca3af;
      margin-bottom: 20px;
    }
    
    .request-expert-btn {
      background: transparent;
      border: 1px solid #0d9488;
      color: #5eead4;
      padding: 10px 20px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.9rem;
      transition: all 0.2s;
    }
    .request-expert-btn:hover {
      background: rgba(13, 148, 136, 0.1);
    }
    .request-expert-btn.primary {
      background: #0d9488;
      color: white;
    }
    .request-expert-btn.primary:hover {
      background: #0f766e;
    }
    
    .expert-modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.8);
      z-index: 10000;
      align-items: center;
      justify-content: center;
    }
    .expert-modal.active {
      display: flex;
    }
    .expert-modal-content {
      background: #1f2937;
      border-radius: 12px;
      padding: 30px;
      max-width: 500px;
      width: 90%;
      position: relative;
    }
    .expert-modal-content h3 {
      color: white;
      margin-bottom: 10px;
    }
    .modal-info {
      color: #9ca3af;
      font-size: 0.9rem;
      margin-bottom: 20px;
    }
    .modal-close {
      position: absolute;
      top: 15px;
      right: 15px;
      background: none;
      border: none;
      color: #6b7280;
      font-size: 1.5rem;
      cursor: pointer;
    }
    .modal-close:hover { color: white; }
    
    .expert-modal-content .form-group {
      margin-bottom: 15px;
    }
    .expert-modal-content label {
      display: block;
      color: #d1d5db;
      margin-bottom: 6px;
      font-size: 0.9rem;
    }
    .expert-modal-content select,
    .expert-modal-content textarea {
      width: 100%;
      padding: 10px;
      background: #374151;
      border: 1px solid #4b5563;
      border-radius: 6px;
      color: white;
      font-size: 0.95rem;
    }
    .expert-modal-content select:focus,
    .expert-modal-content textarea:focus {
      outline: none;
      border-color: #0d9488;
    }
    .submit-request-btn {
      background: #0d9488;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 6px;
      cursor: pointer;
      width: 100%;
      font-size: 1rem;
      font-weight: 500;
      margin-top: 10px;
    }
    .submit-request-btn:hover {
      background: #0f766e;
    }
  `;
  document.head.appendChild(style);
}
