// ToolIntel Team Size Recommender
// Feature 13: Interactive recommendation tool

const RECOMMENDER_API = 'https://v7086lxsji.execute-api.us-east-1.amazonaws.com/recommender';

// Default categories for drag-drop ranking
const DEFAULT_CATEGORIES = [
  { id: 'core_ai', name: 'Core AI Capability', icon: '🧠' },
  { id: 'privacy', name: 'Data Privacy', icon: '🔒' },
  { id: 'compliance', name: 'Regulatory Compliance', icon: '📋' },
  { id: 'pricing', name: 'Pricing Transparency', icon: '💰' },
  { id: 'integration', name: 'Integration & API', icon: '🔌' },
  { id: 'support', name: 'Vendor Support', icon: '🎧' },
  { id: 'reliability', name: 'Uptime & Reliability', icon: '⚡' },
  { id: 'safety', name: 'AI Safety', icon: '🛡️' },
  { id: 'transparency', name: 'Vendor Transparency', icon: '👁️' },
  { id: 'innovation', name: 'Innovation Pace', icon: '🚀' }
];

const INDUSTRIES = [
  'Healthcare', 'Financial Services', 'Legal', 'Government', 'Education',
  'Technology', 'Retail/E-commerce', 'Manufacturing', 'Media/Entertainment', 'General Enterprise'
];

function initTeamRecommender(containerId, category = 'default') {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div class="recommender-panel">
      <div class="recommender-header" onclick="toggleRecommender()">
        <div class="recommender-title">
          <span class="recommender-icon">🎯</span>
          <span>Find the Right Fit for Your Team</span>
        </div>
        <div class="recommender-subtitle">Get a personalized recommendation based on your situation</div>
        <span class="recommender-toggle" id="recommenderToggle">▼</span>
      </div>
      
      <div class="recommender-content" id="recommenderContent" style="display: none;">
        <div class="recommender-steps">
          <div class="step-indicator">
            <div class="step active" data-step="1">1</div>
            <div class="step-line"></div>
            <div class="step" data-step="2">2</div>
            <div class="step-line"></div>
            <div class="step" data-step="3">3</div>
          </div>
        </div>

        <!-- Step 1: Your Team -->
        <div class="recommender-step" id="step1">
          <h3>Step 1: Your Team</h3>
          
          <div class="form-group">
            <label>Team Size</label>
            <select id="teamSize" class="form-select">
              <option value="">Select team size...</option>
              <option value="solo">Solo user</option>
              <option value="small">Small team (2-10)</option>
              <option value="mid">Mid-size team (11-50)</option>
              <option value="large">Large team (51-200)</option>
              <option value="enterprise">Enterprise (200+)</option>
            </select>
          </div>

          <div class="form-group">
            <label>Primary Industry</label>
            <select id="industry" class="form-select">
              <option value="">Select industry...</option>
              ${INDUSTRIES.map(i => `<option value="${i}">${i}</option>`).join('')}
            </select>
          </div>

          <div class="form-group">
            <label>Budget per User/Month</label>
            <select id="budget" class="form-select">
              <option value="">Select budget range...</option>
              <option value="under10">Under $10</option>
              <option value="10to25">$10-25</option>
              <option value="25to50">$25-50</option>
              <option value="50to100">$50-100</option>
              <option value="over100">Over $100</option>
            </select>
          </div>

          <button class="btn-next" onclick="goToStep(2)">Next: Your Priorities →</button>
        </div>

        <!-- Step 2: Your Priorities -->
        <div class="recommender-step" id="step2" style="display: none;">
          <h3>Step 2: Your Priorities</h3>
          <p class="step-hint">Drag to rank what matters most to your team — you don't need to rank all ten.</p>
          
          <div class="priority-container">
            <div class="priority-list" id="priorityList">
              ${DEFAULT_CATEGORIES.map((cat, i) => `
                <div class="priority-item" draggable="true" data-id="${cat.id}">
                  <span class="priority-rank">${i + 1}</span>
                  <span class="priority-icon">${cat.icon}</span>
                  <span class="priority-name">${cat.name}</span>
                  <span class="drag-handle">⋮⋮</span>
                </div>
              `).join('')}
            </div>
            <div class="priority-hint">Your top 5 priorities will be weighted heavily</div>
          </div>

          <div class="toggle-questions">
            <div class="toggle-item">
              <label class="toggle-label">
                <input type="checkbox" id="sensitiveData">
                <span class="toggle-text">Does your team work with sensitive or regulated data?</span>
              </label>
            </div>
            <div class="toggle-item">
              <label class="toggle-label">
                <input type="checkbox" id="apiAccess">
                <span class="toggle-text">Do you need API access for developers?</span>
              </label>
            </div>
            <div class="toggle-item">
              <label class="toggle-label">
                <input type="checkbox" id="supportCritical">
                <span class="toggle-text">Is vendor support response time critical to your operations?</span>
              </label>
            </div>
          </div>

          <div class="step-buttons">
            <button class="btn-back" onclick="goToStep(1)">← Back</button>
            <button class="btn-next" onclick="goToStep(3)">Next: Use Case →</button>
          </div>
        </div>

        <!-- Step 3: Your Use Case -->
        <div class="recommender-step" id="step3" style="display: none;">
          <h3>Step 3: Your Use Case</h3>
          <p class="step-hint">Select up to 3 use cases that apply to your team.</p>
          
          <div class="use-case-grid" id="useCaseGrid">
            <!-- Populated dynamically based on category -->
          </div>

          <div class="step-buttons">
            <button class="btn-back" onclick="goToStep(2)">← Back</button>
            <button class="btn-submit" onclick="getRecommendation()">Get My Recommendation 🎯</button>
          </div>
        </div>

        <!-- Results -->
        <div class="recommender-results" id="recommenderResults" style="display: none;">
          <div id="resultsContent"></div>
        </div>
      </div>
    </div>
  `;

  // Add styles
  addRecommenderStyles();
  
  // Initialize drag and drop
  initDragDrop();
  
  // Load use cases for category
  loadUseCases(category);
  
  // Store category for later
  window.recommenderCategory = category;
}

function addRecommenderStyles() {
  if (document.getElementById('recommender-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'recommender-styles';
  style.textContent = `
    .recommender-panel {
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      border: 1px solid #0f3460;
      border-radius: 12px;
      margin: 20px 0;
      overflow: hidden;
    }
    .recommender-header {
      padding: 20px;
      cursor: pointer;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      transition: background 0.2s;
    }
    .recommender-header:hover {
      background: rgba(255,255,255,0.05);
    }
    .recommender-title {
      font-size: 1.2em;
      font-weight: 600;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .recommender-icon {
      font-size: 1.5em;
    }
    .recommender-subtitle {
      color: #94a3b8;
      font-size: 0.9em;
      flex: 1;
    }
    .recommender-toggle {
      color: #60a5fa;
      font-size: 1.2em;
      transition: transform 0.3s;
    }
    .recommender-toggle.open {
      transform: rotate(180deg);
    }
    .recommender-content {
      padding: 0 20px 20px;
    }
    .recommender-steps {
      margin-bottom: 20px;
    }
    .step-indicator {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 20px 0;
    }
    .step {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: #374151;
      color: #9ca3af;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      transition: all 0.3s;
    }
    .step.active {
      background: #3b82f6;
      color: white;
    }
    .step.completed {
      background: #10b981;
      color: white;
    }
    .step-line {
      width: 60px;
      height: 2px;
      background: #374151;
    }
    .recommender-step h3 {
      color: #fff;
      margin-bottom: 15px;
      font-size: 1.3em;
    }
    .step-hint {
      color: #94a3b8;
      font-size: 0.9em;
      margin-bottom: 15px;
    }
    .form-group {
      margin-bottom: 15px;
    }
    .form-group label {
      display: block;
      color: #d1d5db;
      margin-bottom: 5px;
      font-size: 0.9em;
    }
    .form-select {
      width: 100%;
      padding: 12px;
      background: #1f2937;
      border: 1px solid #374151;
      border-radius: 8px;
      color: #fff;
      font-size: 1em;
    }
    .form-select:focus {
      outline: none;
      border-color: #3b82f6;
    }
    .priority-container {
      margin-bottom: 20px;
    }
    .priority-list {
      background: #1f2937;
      border-radius: 8px;
      padding: 10px;
    }
    .priority-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px;
      background: #374151;
      border-radius: 6px;
      margin-bottom: 6px;
      cursor: grab;
      transition: all 0.2s;
    }
    .priority-item:hover {
      background: #4b5563;
    }
    .priority-item.dragging {
      opacity: 0.5;
      cursor: grabbing;
    }
    .priority-rank {
      width: 24px;
      height: 24px;
      background: #3b82f6;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.8em;
      font-weight: 600;
      color: white;
    }
    .priority-item:nth-child(n+6) .priority-rank {
      background: #6b7280;
    }
    .priority-icon {
      font-size: 1.2em;
    }
    .priority-name {
      flex: 1;
      color: #e5e7eb;
    }
    .drag-handle {
      color: #6b7280;
      cursor: grab;
    }
    .priority-hint {
      color: #6b7280;
      font-size: 0.85em;
      text-align: center;
      margin-top: 10px;
    }
    .toggle-questions {
      margin: 20px 0;
    }
    .toggle-item {
      margin-bottom: 12px;
    }
    .toggle-label {
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
      color: #d1d5db;
    }
    .toggle-label input[type="checkbox"] {
      width: 20px;
      height: 20px;
      accent-color: #3b82f6;
    }
    .use-case-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 10px;
      margin-bottom: 20px;
    }
    .use-case-item {
      padding: 12px;
      background: #374151;
      border: 2px solid transparent;
      border-radius: 8px;
      cursor: pointer;
      color: #d1d5db;
      transition: all 0.2s;
      text-align: center;
    }
    .use-case-item:hover {
      background: #4b5563;
    }
    .use-case-item.selected {
      border-color: #3b82f6;
      background: rgba(59, 130, 246, 0.2);
    }
    .use-case-item.disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .step-buttons {
      display: flex;
      gap: 10px;
      justify-content: space-between;
      margin-top: 20px;
    }
    .btn-back, .btn-next, .btn-submit {
      padding: 12px 24px;
      border: none;
      border-radius: 8px;
      font-size: 1em;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-back {
      background: #374151;
      color: #d1d5db;
    }
    .btn-next {
      background: #3b82f6;
      color: white;
      margin-left: auto;
    }
    .btn-submit {
      background: linear-gradient(135deg, #10b981, #059669);
      color: white;
      font-weight: 600;
    }
    .btn-back:hover { background: #4b5563; }
    .btn-next:hover { background: #2563eb; }
    .btn-submit:hover { background: linear-gradient(135deg, #059669, #047857); }

    /* Results styles */
    .results-header {
      text-align: center;
      margin-bottom: 20px;
    }
    .results-header h3 {
      color: #fff;
      font-size: 1.5em;
      margin-bottom: 10px;
    }
    .confidence-badge {
      display: inline-block;
      padding: 6px 16px;
      border-radius: 20px;
      font-size: 0.9em;
      font-weight: 600;
    }
    .confidence-high { background: #10b981; color: white; }
    .confidence-medium { background: #f59e0b; color: white; }
    .confidence-low { background: #ef4444; color: white; }
    
    .recommendation-card {
      background: linear-gradient(135deg, #1e3a5f 0%, #0f2744 100%);
      border: 2px solid #3b82f6;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 15px;
    }
    .recommendation-card.runner-up {
      border-color: #6b7280;
      background: #1f2937;
    }
    .recommendation-card.budget-alt {
      border-color: #10b981;
      background: linear-gradient(135deg, #064e3b 0%, #022c22 100%);
    }
    .rec-label {
      font-size: 0.8em;
      text-transform: uppercase;
      color: #60a5fa;
      margin-bottom: 5px;
    }
    .rec-tool-name {
      font-size: 1.4em;
      font-weight: 600;
      color: #fff;
      margin-bottom: 10px;
    }
    .rec-score {
      font-size: 2em;
      font-weight: 700;
      color: #10b981;
      margin-bottom: 10px;
    }
    .rec-explanation {
      color: #d1d5db;
      line-height: 1.6;
    }
    .rec-note {
      color: #9ca3af;
      font-size: 0.9em;
      font-style: italic;
    }
    
    .tradeoffs-section {
      background: #1f2937;
      border-radius: 8px;
      padding: 15px;
      margin-top: 15px;
    }
    .tradeoffs-title {
      color: #f59e0b;
      font-weight: 600;
      margin-bottom: 10px;
    }
    .tradeoff-item {
      color: #9ca3af;
      font-size: 0.9em;
      padding: 8px 0;
      border-bottom: 1px solid #374151;
    }
    .tradeoff-item:last-child { border-bottom: none; }
    
    .calculation-section {
      margin-top: 20px;
    }
    .calc-toggle {
      background: #374151;
      border: none;
      color: #60a5fa;
      padding: 10px 15px;
      border-radius: 6px;
      cursor: pointer;
      width: 100%;
      text-align: left;
      font-size: 0.9em;
    }
    .calc-toggle:hover { background: #4b5563; }
    .calc-content {
      background: #1f2937;
      border-radius: 8px;
      padding: 15px;
      margin-top: 10px;
      font-size: 0.85em;
      color: #9ca3af;
    }
    .calc-table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0;
    }
    .calc-table th, .calc-table td {
      padding: 8px;
      text-align: left;
      border-bottom: 1px solid #374151;
    }
    .calc-table th { color: #d1d5db; }
    
    .result-actions {
      display: flex;
      gap: 10px;
      margin-top: 20px;
      flex-wrap: wrap;
    }
    .result-btn {
      padding: 10px 20px;
      border: 1px solid #374151;
      background: transparent;
      color: #d1d5db;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.9em;
    }
    .result-btn:hover { background: #374151; }
    .result-btn.primary {
      background: #3b82f6;
      border-color: #3b82f6;
      color: white;
    }
  `;
  document.head.appendChild(style);
}

function toggleRecommender() {
  const content = document.getElementById('recommenderContent');
  const toggle = document.getElementById('recommenderToggle');
  
  if (content.style.display === 'none') {
    content.style.display = 'block';
    toggle.classList.add('open');
  } else {
    content.style.display = 'none';
    toggle.classList.remove('open');
  }
}

function goToStep(step) {
  // Update step indicators
  document.querySelectorAll('.step').forEach((el, i) => {
    el.classList.remove('active', 'completed');
    if (i + 1 < step) el.classList.add('completed');
    if (i + 1 === step) el.classList.add('active');
  });
  
  // Show/hide steps
  document.querySelectorAll('.recommender-step').forEach(el => el.style.display = 'none');
  document.getElementById(`step${step}`).style.display = 'block';
  
  // Hide results when going back
  document.getElementById('recommenderResults').style.display = 'none';
}

function initDragDrop() {
  const list = document.getElementById('priorityList');
  if (!list) return;
  
  let draggedItem = null;
  
  list.addEventListener('dragstart', (e) => {
    if (e.target.classList.contains('priority-item')) {
      draggedItem = e.target;
      e.target.classList.add('dragging');
    }
  });
  
  list.addEventListener('dragend', (e) => {
    if (e.target.classList.contains('priority-item')) {
      e.target.classList.remove('dragging');
      updatePriorityNumbers();
    }
  });
  
  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    const afterElement = getDragAfterElement(list, e.clientY);
    if (afterElement == null) {
      list.appendChild(draggedItem);
    } else {
      list.insertBefore(draggedItem, afterElement);
    }
  });
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.priority-item:not(.dragging)')];
  
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    }
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function updatePriorityNumbers() {
  document.querySelectorAll('.priority-item').forEach((item, i) => {
    item.querySelector('.priority-rank').textContent = i + 1;
  });
}

function loadUseCases(category) {
  const grid = document.getElementById('useCaseGrid');
  if (!grid) return;
  
  const useCases = {
    'ai-coding': ['Daily code completion', 'Code review and quality', 'Documentation generation', 'Security scanning', 'Full application building', 'Legacy code modernization'],
    'foundation-models': ['Complex reasoning tasks', 'Content generation', 'Data analysis', 'Customer support automation', 'Research assistance', 'Multi-modal applications'],
    'chatbots': ['Customer service automation', 'Internal knowledge base', 'Lead qualification', 'Appointment scheduling', 'FAQ automation', 'Sales assistance'],
    'writing': ['Marketing copy', 'Technical documentation', 'Email drafting', 'Content repurposing', 'SEO optimization', 'Social media content'],
    'image-gen': ['Marketing visuals', 'Product mockups', 'Social media graphics', 'Concept art', 'Photo editing/enhancement', 'Brand asset creation'],
    'default': ['General productivity', 'Team collaboration', 'Process automation', 'Data analysis', 'Content creation', 'Research']
  };
  
  const cases = useCases[category] || useCases['default'];
  
  grid.innerHTML = cases.map(uc => `
    <div class="use-case-item" onclick="toggleUseCase(this)">${uc}</div>
  `).join('');
}

function toggleUseCase(el) {
  const selected = document.querySelectorAll('.use-case-item.selected');
  
  if (el.classList.contains('selected')) {
    el.classList.remove('selected');
  } else if (selected.length < 3) {
    el.classList.add('selected');
  }
  
  // Update disabled state
  const count = document.querySelectorAll('.use-case-item.selected').length;
  document.querySelectorAll('.use-case-item').forEach(item => {
    if (!item.classList.contains('selected')) {
      item.classList.toggle('disabled', count >= 3);
    }
  });
}

async function getRecommendation() {
  const inputs = collectInputs();
  
  if (!inputs.teamSize) {
    alert('Please select your team size');
    goToStep(1);
    return;
  }
  
  // Show loading
  const results = document.getElementById('recommenderResults');
  const content = document.getElementById('resultsContent');
  results.style.display = 'block';
  content.innerHTML = '<div style="text-align: center; padding: 40px; color: #60a5fa;">🔄 Generating your personalized recommendation...</div>';
  
  // Hide step 3
  document.getElementById('step3').style.display = 'none';
  
  try {
    const response = await fetch(`${RECOMMENDER_API}/recommend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inputs)
    });
    
    const data = await response.json();
    displayResults(data, inputs);
    
  } catch (error) {
    console.error('Recommendation error:', error);
    content.innerHTML = `<div style="text-align: center; padding: 40px; color: #ef4444;">❌ Error generating recommendation. Please try again.</div>`;
  }
}

function collectInputs() {
  const priorities = [...document.querySelectorAll('.priority-item')].map(el => el.dataset.id);
  const useCases = [...document.querySelectorAll('.use-case-item.selected')].map(el => el.textContent);
  
  return {
    teamSize: document.getElementById('teamSize').value,
    industry: document.getElementById('industry').value,
    budget: document.getElementById('budget').value,
    priorities: priorities.slice(0, 5), // Top 5 priorities
    sensitiveData: document.getElementById('sensitiveData').checked,
    apiAccess: document.getElementById('apiAccess').checked,
    supportCritical: document.getElementById('supportCritical').checked,
    useCases,
    category: window.recommenderCategory || 'default'
  };
}

function displayResults(data, inputs) {
  const content = document.getElementById('resultsContent');
  
  if (data.confidence === 'low') {
    content.innerHTML = `
      <div class="results-header">
        <h3>Your Personalized Recommendation</h3>
        <div class="confidence-badge confidence-low">Low Confidence</div>
      </div>
      <div class="recommendation-card">
        <p class="rec-explanation">${data.message}</p>
      </div>
      <div class="result-actions">
        <button class="result-btn" onclick="goToStep(1)">← Adjust Criteria</button>
      </div>
    `;
    return;
  }
  
  const top = data.topRecommendation;
  const runner = data.runnerUp;
  const budget = data.budgetAlternative;
  
  content.innerHTML = `
    <div class="results-header">
      <h3>Your Personalized Recommendation</h3>
      <div class="confidence-badge confidence-${data.confidence}">${data.confidence === 'high' ? '✓ High' : '⚠ Medium'} Confidence</div>
    </div>
    
    ${top ? `
    <div class="recommendation-card">
      <div class="rec-label">🏆 Top Recommendation</div>
      <div class="rec-tool-name">${top.tool.name}</div>
      <div class="rec-score">${Math.round(top.score)} Match Score</div>
      <p class="rec-explanation">${top.explanation}</p>
    </div>
    ` : ''}
    
    ${runner ? `
    <div class="recommendation-card runner-up">
      <div class="rec-label">🥈 Runner Up</div>
      <div class="rec-tool-name">${runner.tool.name}</div>
      <p class="rec-note">${runner.note}</p>
    </div>
    ` : ''}
    
    ${budget ? `
    <div class="recommendation-card budget-alt">
      <div class="rec-label">💰 Budget Alternative</div>
      <div class="rec-tool-name">${budget.tool.name}</div>
      <p class="rec-note">${budget.note}</p>
    </div>
    ` : ''}
    
    ${data.tradeoffs && data.tradeoffs.length > 0 ? `
    <div class="tradeoffs-section">
      <div class="tradeoffs-title">⚖️ What You'd Be Giving Up</div>
      ${data.tradeoffs.map(t => `<div class="tradeoff-item">${t.tradeoff}</div>`).join('')}
    </div>
    ` : ''}
    
    <div class="calculation-section">
      <button class="calc-toggle" onclick="toggleCalculation()">📊 Full recommendation logic — no black box ▼</button>
      <div class="calc-content" id="calcContent" style="display: none;">
        <h4 style="color: #d1d5db; margin-bottom: 10px;">How We Calculated This</h4>
        
        <p><strong>Your Inputs:</strong></p>
        <ul style="margin: 10px 0;">
          <li>Team: ${inputs.teamSize}</li>
          <li>Industry: ${inputs.industry || 'Not specified'}</li>
          <li>Budget: ${inputs.budget || 'Not specified'}</li>
          <li>Sensitive Data: ${inputs.sensitiveData ? 'Yes' : 'No'}</li>
          <li>API Access: ${inputs.apiAccess ? 'Yes' : 'No'}</li>
          <li>Support Critical: ${inputs.supportCritical ? 'Yes' : 'No'}</li>
        </ul>
        
        <p><strong>Priority Weights:</strong></p>
        <table class="calc-table">
          <tr><th>Priority</th><th>Category</th><th>Weight</th></tr>
          ${inputs.priorities.map((p, i) => `
            <tr><td>#${i+1}</td><td>${DEFAULT_CATEGORIES.find(c => c.id === p)?.name || p}</td><td>${[25,20,15,10,5][i]}%</td></tr>
          `).join('')}
        </table>
        
        ${data.calculation ? `
        <p><strong>Evaluation Process:</strong></p>
        <ul>
          ${data.calculation.eliminationSteps?.map(s => `<li>${s.description}</li>`).join('') || ''}
        </ul>
        ` : ''}
      </div>
    </div>
    
    <div class="result-actions">
      <button class="result-btn" onclick="goToStep(1)">← Adjust Criteria</button>
      <button class="result-btn" onclick="shareRecommendation()">🔗 Share</button>
      <button class="result-btn primary" onclick="saveProfile()">💾 Save Profile</button>
    </div>
  `;
}

function toggleCalculation() {
  const calc = document.getElementById('calcContent');
  calc.style.display = calc.style.display === 'none' ? 'block' : 'none';
}

async function shareRecommendation() {
  const inputs = collectInputs();
  
  try {
    const response = await fetch(`${RECOMMENDER_API}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs, recommendation: {} })
    });
    
    const data = await response.json();
    
    if (data.shareUrl) {
      await navigator.clipboard.writeText(data.shareUrl);
      alert('Share link copied to clipboard!\n\n' + data.shareUrl);
    }
  } catch (error) {
    alert('Could not generate share link. Please try again.');
  }
}

function saveProfile() {
  const user = localStorage.getItem('toolintel_user');
  if (!user) {
    alert('Please log in to save your profile. Your recommendation will update automatically when new tools are reviewed.');
    return;
  }
  
  const name = prompt('Name this profile (e.g., "Healthcare Team Q1"):');
  if (!name) return;
  
  const inputs = collectInputs();
  
  fetch(`${RECOMMENDER_API}/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: user, profileName: name, inputs })
  })
  .then(r => r.json())
  .then(data => {
    alert('✓ Profile saved! You\'ll be notified when your recommendation changes.');
  })
  .catch(() => alert('Could not save profile. Please try again.'));
}
